import { BOARDS, GPIO_HIGH_VOLTS, GPIO_OUT_OHMS, GPIO_PULL_OHMS, isBoardType, pinRole } from '../model/boards';
import { buildNets, pinKey, type NetList } from '../model/connectivity';
import { param } from '../model/params';
import { PART_DEFS } from '../model/parts';
import {
  BUCK_DROPOUT_VOLTS,
  METER_AMMETER_OHMS,
  METER_VOLTMETER_OHMS,
  MOS_FULLY_ON_VGS,
  RELAY_CONTACT_OHMS,
  RELAY_DROP_OUT,
  RELAY_PULL_IN,
} from '../model/ratings';
import type { Part, Wire } from '../model/types';
import { solveDC, type Element, type ElementResult, type SolveResult } from './mna';

const SWITCH_CLOSED_OHMS = 0.02;
const FUSE_OHMS = 0.1;
const POT_MIN_OHMS = 1;

const LED_N = 2;
const DIODE_IS = 5e-14;

const BJT_IS = 1e-14;
const BJT_REVERSE_BETA = 2;

const SERVO_REF_VOLTS = 5;
const SENSOR_REF_VOLTS = 3.3;
const LCD_REF_VOLTS = 5;
const I2C_PULLUP_OHMS = 10000;
const ESC_BEC_VOLTS = 5;
const ESC_BEC_MIN_INPUT_VOLTS = 6;
const ESC_BEC_MAX_INPUT_VOLTS = 25.2;

const BUCK_OUT_OHMS = 0.05;
const BUCK_GROUND_TIE_OHMS = 1e-3;
const MAX_PASSES = 40;

const USB_SOURCE_OHMS = 0.15; // USB cable + polyfuse
const LDO_OHMS = 0.5;
const LDO_REGULATED_VOLTS = 3.3;
const LDO_MIN_INPUT_VOLTS = 4.3;

/** `internal` elements belong to a device model (junctions, ground ties) and are hidden from tables and rating checks. */
export type ElementRole = 'load' | 'supply' | 'gpio' | 'rail3v3' | 'rail5v' | 'internal';

export interface ElementMeta {
  partId: string;
  partName: string;
  partType: Part['type'];
  label: string;
  role: ElementRole;
  /** Names of the pins at terminals a and b of the element. */
  pinA: string;
  pinB: string;
  /** Net indices of terminals a and b. */
  netA: number;
  netB: number;
}

export interface SimResult {
  converged: boolean;
  iterations: number;
  nets: NetList;
  groundNet: number;
  hasGround: boolean;
  netVoltages: number[];
  elements: Array<ElementResult & ElementMeta>;
  warnings: string[];
  /** ESP32 boards whose regulator is running. */
  poweredBoards: Set<string>;
  /** Relays whose coil is energised. */
  relays: Set<string>;
  /** ESCs with a valid 2S-6S supply and an active 5 V BEC output. */
  poweredEscs: Set<string>;
  /** Output voltage and input current of each buck converter. */
  bucks: Map<string, { vout: number; iin: number }>;
}

/** Replaces a part by a plain resistor between its first two pins, used to probe the rest of the circuit. */
export interface Probe {
  partId: string;
  ohms: number;
}

interface State {
  powered: Set<string>;
  relays: Set<string>;
  poweredEscs: Set<string>;
  bucks: Map<string, { vout: number; iin: number }>;
}

interface Build {
  elements: Element[];
  meta: Map<string, ElementMeta>;
  warnings: string[];
  groundCandidates: number[];
}

function build(parts: Part[], nets: NetList, state: State, probe?: Probe): Build {
  const net = (part: Part, pin: string) => nets.netOf.get(pinKey({ partId: part.id, pin }))!;
  const elements: Element[] = [];
  const meta = new Map<string, ElementMeta>();
  const warnings: string[] = [];
  const groundCandidates: number[] = [];

  const describe = (part: Part, id: string, label: string, role: ElementRole, pinA: string, pinB: string) =>
    meta.set(id, { partId: part.id, partName: part.name, partType: part.type, label, role, pinA, pinB, netA: net(part, pinA), netB: net(part, pinB) });

  const add = (
    part: Part,
    suffix: string,
    label: string,
    role: ElementRole,
    pinA: string,
    pinB: string,
    make: (a: number, b: number, id: string) => Element,
  ) => {
    const id = `${part.id}:${suffix}`;
    elements.push(make(net(part, pinA), net(part, pinB), id));
    describe(part, id, label, role, pinA, pinB);
  };
  const resistor = (part: Part, suffix: string, a: string, b: string, ohms: number, label = 'resistance') =>
    add(part, suffix, label, 'load', a, b, (na, nb, id) => ({ kind: 'R', id, a: na, b: nb, r: Math.max(ohms, 1e-3) }));

  const buildBoard = (part: Part) => {
    const def = BOARDS[part.type as keyof typeof BOARDS];
    const pins = PART_DEFS[part.type].pins.map((p) => p.name);
    const gnd = pins.find((p) => pinRole(def, p).kind === 'gnd')!;
    const rail3v3 = pins.find((p) => pinRole(def, p).kind === '3v3')!;
    const usb = param(part, 'usb') === 1;

    if (usb) {
      groundCandidates.push(net(part, gnd));
      add(part, '5V', 'USB 5 V rail', 'rail5v', def.vinPin, gnd, (a, b, id) => ({ kind: 'V', id, a, b, v: 5, r: USB_SOURCE_OHMS }));
    }
    if (!usb && !state.powered.has(part.id)) return;

    add(part, '3V3', '3.3 V regulator', 'rail3v3', rail3v3, gnd, (a, b, id) => ({ kind: 'V', id, a, b, v: LDO_REGULATED_VOLTS, r: LDO_OHMS }));
    for (const pin of pins) {
      const role = pinRole(def, pin);
      if (role.kind !== 'gpio') continue;
      const mode = part.pinModes?.[pin];
      if (mode === 'pullup' || mode === 'pulldown') {
        const v = mode === 'pullup' ? GPIO_HIGH_VOLTS : 0;
        add(part, `G:${pin}`, `GPIO${role.gpio} ${mode}`, 'gpio', pin, gnd, (a, b, id) => ({ kind: 'V', id, a, b, v, r: GPIO_PULL_OHMS }));
        continue;
      }
      if (mode !== 'high' && mode !== 'low') continue;
      // PWM pins are solved at their ON level, the worst case for current and rating checks.
      const duty = part.pinDuty?.[pin];
      const v = mode === 'high' ? GPIO_HIGH_VOLTS : 0;
      const what = duty === undefined ? mode.toUpperCase() : `PWM ${Math.round(duty * 100)}% (shown at ON level)`;
      add(part, `G:${pin}`, `GPIO${role.gpio} output ${what}`, 'gpio', pin, gnd, (a, b, id) => ({
        kind: 'V',
        id,
        a,
        b,
        v,
        r: GPIO_OUT_OHMS,
      }));
    }
  };

  for (const part of parts) {
    if (probe?.partId === part.id) {
      const [first, second] = PART_DEFS[part.type].pins;
      resistor(part, 'P', first.name, second.name, probe.ohms, 'probe');
      continue;
    }
    switch (part.type) {
      case 'resistor':
        resistor(part, 'R', 'A', 'B', param(part, 'ohms'));
        break;
      case 'motor':
        resistor(part, 'R', 'M+', 'M-', param(part, 'ohms'), 'winding');
        break;
      case 'fuse':
        resistor(part, 'R', 'A', 'B', FUSE_OHMS, 'fuse');
        break;
      case 'button':
        if (param(part, 'pressed')) resistor(part, 'R', '1', '2', SWITCH_CLOSED_OHMS, 'contact');
        break;
      case 'switch':
        if (param(part, 'closed')) resistor(part, 'R', '1', '2', SWITCH_CLOSED_OHMS, 'contact');
        break;
      case 'potentiometer': {
        const total = param(part, 'ohms');
        const pos = Math.min(1, Math.max(0, param(part, 'position')));
        resistor(part, 'R1', '1', 'W', Math.max(POT_MIN_OHMS, total * pos), 'upper half');
        resistor(part, 'R2', 'W', '2', Math.max(POT_MIN_OHMS, total * (1 - pos)), 'lower half');
        break;
      }
      case 'led': {
        const vf = param(part, 'vf');
        const is = 0.02 / Math.exp(vf / (LED_N * 0.025852));
        add(part, 'D', 'diode', 'load', 'A', 'K', (a, b, id) => ({ kind: 'D', id, a, b, is, n: LED_N }));
        break;
      }
      case 'diode':
        add(part, 'D', 'diode', 'load', 'A', 'K', (a, b, id) => ({ kind: 'D', id, a, b, is: DIODE_IS, n: 1 }));
        break;
      case 'zener':
        add(part, 'D', 'zener', 'load', 'A', 'K', (a, b, id) => ({ kind: 'D', id, a, b, is: DIODE_IS, n: 1, vz: param(part, 'vz') }));
        break;
      case 'battery':
        add(part, 'V', 'source', 'supply', '+', '-', (a, b, id) => ({ kind: 'V', id, a, b, v: param(part, 'voltage'), r: Math.max(param(part, 'rint'), 1e-3) }));
        groundCandidates.push(net(part, '-'));
        break;
      case 'usb5v':
        add(part, 'V', 'source', 'supply', '5V', 'GND', (a, b, id) => ({ kind: 'V', id, a, b, v: param(part, 'voltage'), r: 0.1 }));
        groundCandidates.push(net(part, 'GND'));
        break;
      case 'capacitor':
        break; // open circuit at DC
      case 'npn': {
        const id = `${part.id}:Q`;
        elements.push({ kind: 'Q', id, c: net(part, 'C'), b: net(part, 'B'), e: net(part, 'E'), is: BJT_IS, bf: param(part, 'beta'), br: BJT_REVERSE_BETA });
        describe(part, `${id}:CE`, 'collector-emitter', 'load', 'C', 'E');
        describe(part, `${id}:BE`, 'base-emitter', 'internal', 'B', 'E');
        describe(part, `${id}:BC`, 'base-collector', 'internal', 'B', 'C');
        break;
      }
      case 'nmos': {
        const vth = param(part, 'vth');
        const k = 1 / (param(part, 'rds') * Math.max(MOS_FULLY_ON_VGS - vth, 0.5));
        const id = `${part.id}:M`;
        elements.push({ kind: 'M', id, g: net(part, 'G'), d: net(part, 'D'), s: net(part, 'S'), k, vth });
        describe(part, `${id}:DS`, 'drain-source', 'load', 'D', 'S');
        add(part, 'BD', 'body diode', 'internal', 'S', 'D', (a, b, did) => ({ kind: 'D', id: did, a, b, is: DIODE_IS, n: 1 }));
        break;
      }
      case 'relay': {
        resistor(part, 'COIL', 'COIL+', 'COIL-', param(part, 'coilOhms'), 'coil');
        const closed = state.relays.has(part.id) ? 'NO' : 'NC';
        resistor(part, 'CONTACT', 'COM', closed, RELAY_CONTACT_OHMS, 'contact');
        break;
      }
      case 'servo':
        resistor(part, 'R', 'V+', 'GND', SERVO_REF_VOLTS / (param(part, 'runMa') / 1000), 'motor and electronics');
        break;
      case 'esc':
        resistor(part, 'GND', 'BAT-', 'GND', BUCK_GROUND_TIE_OHMS, 'battery/receiver ground');
        if (state.poweredEscs.has(part.id)) {
          add(part, 'BEC', '5 V BEC output', 'supply', '+5V', 'GND', (a, b, id) => ({
            kind: 'V',
            id,
            a,
            b,
            v: ESC_BEC_VOLTS,
            r: BUCK_OUT_OHMS,
          }));
        }
        break;
      case 'i2c-sensor':
        resistor(part, 'R', 'VCC', 'GND', SENSOR_REF_VOLTS / (param(part, 'ma') / 1000), 'supply');
        if (param(part, 'pullups')) {
          resistor(part, 'PU-SDA', 'VCC', 'SDA', I2C_PULLUP_OHMS, 'SDA pull-up');
          resistor(part, 'PU-SCL', 'VCC', 'SCL', I2C_PULLUP_OHMS, 'SCL pull-up');
        }
        break;
      case 'lcd1602':
        resistor(part, 'R', 'VCC', 'GND', LCD_REF_VOLTS / (param(part, 'ma') / 1000), 'supply');
        if (param(part, 'pullups')) {
          resistor(part, 'PU-SDA', 'VCC', 'SDA', I2C_PULLUP_OHMS, 'SDA pull-up');
          resistor(part, 'PU-SCL', 'VCC', 'SCL', I2C_PULLUP_OHMS, 'SCL pull-up');
        }
        break;
      case 'multimeter':
        resistor(part, 'R', 'V/A', 'COM', param(part, 'ammeter') ? METER_AMMETER_OHMS : METER_VOLTMETER_OHMS, 'meter');
        break;
      case 'buck': {
        const st = state.bucks.get(part.id) ?? { vout: param(part, 'vout'), iin: 0 };
        add(part, 'GND', 'common ground', 'internal', 'IN-', 'OUT-', (a, b, id) => ({ kind: 'R', id, a, b, r: BUCK_GROUND_TIE_OHMS }));
        if (st.vout > 0.05) {
          add(part, 'OUT', 'output', 'supply', 'OUT+', 'OUT-', (a, b, id) => ({ kind: 'V', id, a, b, v: st.vout, r: BUCK_OUT_OHMS }));
        }
        add(part, 'IN', 'input draw', 'load', 'IN+', 'IN-', (a, b, id) => ({ kind: 'I', id, a, b, i: st.iin }));
        break;
      }
      default:
        if (isBoardType(part.type)) buildBoard(part);
    }
  }

  return { elements, meta, warnings, groundCandidates };
}

const BUCK_VOUT_TOLERANCE = 2e-3;
const BUCK_IIN_TOLERANCE = 2e-4;

function nextState(parts: Part[], nets: NetList, sol: SolveResult, state: State): State {
  const volts = (part: Part, pin: string) => sol.voltages[nets.netOf.get(pinKey({ partId: part.id, pin }))!];

  const powered = new Set<string>();
  for (const part of parts) {
    if (!isBoardType(part.type) || param(part, 'usb') === 1) continue;
    const def = BOARDS[part.type as keyof typeof BOARDS];
    if (volts(part, def.vinPin) >= LDO_MIN_INPUT_VOLTS) powered.add(part.id);
  }

  const relays = new Set<string>();
  const poweredEscs = new Set<string>();
  const bucks = new Map<string, { vout: number; iin: number }>();
  for (const part of parts) {
    if (part.type === 'relay') {
      const coilV = param(part, 'coilV');
      const v = Math.abs(volts(part, 'COIL+') - volts(part, 'COIL-'));
      if (v >= RELAY_PULL_IN * coilV || (v > RELAY_DROP_OUT * coilV && state.relays.has(part.id))) relays.add(part.id);
    } else if (part.type === 'esc') {
      const vin = volts(part, 'BAT+') - volts(part, 'BAT-');
      if (vin >= ESC_BEC_MIN_INPUT_VOLTS && vin <= ESC_BEC_MAX_INPUT_VOLTS) poweredEscs.add(part.id);
    } else if (part.type === 'buck') {
      const old = state.bucks.get(part.id) ?? { vout: param(part, 'vout'), iin: 0 };
      const vin = volts(part, 'IN+') - volts(part, 'IN-');
      const vout = vin < 2 ? 0 : Math.max(0, Math.min(param(part, 'vout'), vin - BUCK_DROPOUT_VOLTS));
      const out = sol.elements.get(`${part.id}:OUT`);
      const iout = out ? Math.max(0, -out.current) : 0;
      const iin = (vout * iout) / (param(part, 'eff') * Math.max(vin, 1));
      // Damping keeps the converter's output and input current from oscillating between passes.
      bucks.set(part.id, { vout: (old.vout + vout) / 2, iin: (old.iin + iin) / 2 });
    }
  }
  return { powered, relays, poweredEscs, bucks };
}

function sameState(a: State, b: State): boolean {
  const same = (x: Set<string>, y: Set<string>) => x.size === y.size && [...x].every((k) => y.has(k));
  if (!same(a.powered, b.powered) || !same(a.relays, b.relays) || !same(a.poweredEscs, b.poweredEscs)) return false;
  for (const [id, now] of b.bucks) {
    const before = a.bucks.get(id);
    if (!before || Math.abs(before.vout - now.vout) > BUCK_VOUT_TOLERANCE || Math.abs(before.iin - now.iin) > BUCK_IIN_TOLERANCE) return false;
  }
  return true;
}

export function simulate(parts: Part[], wires: Wire[], probe?: Probe): SimResult {
  const nets = buildNets(parts, wires);
  let state: State = { powered: new Set(), relays: new Set(), poweredEscs: new Set(), bucks: new Map() };
  let b!: Build;
  let sol!: SolveResult;
  let settled = false;

  // Relays, converters and externally powered boards depend on the solution itself, so repeat until they stop changing.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    b = build(parts, nets, state, probe);
    sol = solveDC(b.elements, nets.nets.length, b.groundCandidates[0] ?? 0);
    const next = nextState(parts, nets, sol, state);
    if (sameState(state, next)) {
      settled = true;
      break;
    }
    state = next;
  }

  const warnings = [...b.warnings];
  if (!settled) warnings.push('A relay or converter keeps changing state (for example a relay switching its own coil), so the result may not be steady.');
  for (const part of parts) {
    if (isBoardType(part.type) && param(part, 'usb') !== 1 && !state.powered.has(part.id)) {
      const def = BOARDS[part.type as keyof typeof BOARDS];
      warnings.push(`${part.name} is not powered: feed at least ${LDO_MIN_INPUT_VOLTS} V to ${def.vinPin} and connect GND.`);
    }
  }

  const hasGround = b.groundCandidates.length > 0;
  const groundNet = hasGround ? b.groundCandidates[0] : 0;
  if (!hasGround && b.elements.length > 0) warnings.push('No ground reference: connect a battery "-", USB GND, or power a board.');
  if (!sol.converged) warnings.push('The solver did not converge; results may be inaccurate.');

  const elements = [...sol.elements.values()].map((r) => ({ ...r, ...b.meta.get(r.id)! }));
  const usbBoards = parts.filter((p) => isBoardType(p.type) && param(p, 'usb') === 1).map((p) => p.id);
  return {
    converged: sol.converged,
    iterations: sol.iterations,
    nets,
    groundNet,
    hasGround,
    netVoltages: sol.voltages,
    elements,
    warnings,
    poweredBoards: new Set([...state.powered, ...usbBoards]),
    relays: state.relays,
    poweredEscs: state.poweredEscs,
    bucks: state.bucks,
  };
}

export function pinVoltage(sim: SimResult, partId: string, pin: string): number | undefined {
  const n = sim.nets.netOf.get(`${partId}:${pin}`);
  return n === undefined ? undefined : sim.netVoltages[n];
}
