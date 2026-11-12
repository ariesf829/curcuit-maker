import { isBoardType } from '../model/boards';
import { pinKey } from '../model/connectivity';
import { param } from '../model/params';
import {
  BJT_MAX_VCE,
  BJT_MAX_WATTS,
  BUCK_DROPOUT_VOLTS,
  BUCK_MAX_VOUT,
  BUCK_MAX_VIN,
  BUCK_MIN_VIN,
  BUCK_MIN_VOUT,
  MOS_FULLY_ON_VGS,
  MOS_MAX_VDS,
  MOS_MAX_VGS,
  MOS_MAX_WATTS,
  RELAY_DROP_OUT,
  RELAY_PULL_IN,
  SERVO_MAX_VOLTS,
  SERVO_MIN_VOLTS,
} from '../model/ratings';
import type { Part } from '../model/types';
import type { Issue } from './checks';
import { pinVoltage, type SimResult } from './simulate';

const fmtMa = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} A` : `${x.toFixed(x < 10 ? 1 : 0)} mA`);
const MIN_ACTIVE_VOLTS = 0.5;
const MOS_ON_CURRENT_AMPS = 0.05;
const BULK_CAP_MIN_AMPS = 0.1;
const I2C_MAX_SAFE_VOLTS = 3.6;
const LCD_MIN_VOLTS = 4.5;
const LCD_MAX_VOLTS = 5.5;

/** Checks for the transistor, relay, servo, converter, sensor, solenoid and meter models. */
export function checkDevices(parts: Part[], sim: SimResult): Issue[] {
  const issues: Issue[] = [];
  const push = (i: Issue) => issues.push(i);

  const el = (part: Part, label: string) => sim.elements.find((e) => e.partId === part.id && e.label === label);
  const netOf = (part: Part, pin: string) => sim.nets.netOf.get(pinKey({ partId: part.id, pin }))!;
  const volts = (part: Part, pin: string) => pinVoltage(sim, part.id, pin) ?? 0;
  const partsOnNet = (net: number) =>
    (sim.nets.nets[net] ?? []).map((k) => parts.find((p) => p.id === k.slice(0, k.indexOf(':')))).filter((p): p is Part => !!p);
  const hasPart = (net: number, pred: (p: Part) => boolean) => partsOnNet(net).some(pred);
  const across = (type: Part['type'], x: number, y: number, pinA: string, pinB: string) =>
    parts.some((p) => {
      if (p.type !== type) return false;
      const a = netOf(p, pinA);
      const b = netOf(p, pinB);
      return (a === x && b === y) || (a === y && b === x);
    });
  const driven = (net: number) =>
    hasPart(net, (p) => isBoardType(p.type) || p.type === 'npn' || p.type === 'nmos' || p.type === 'relay' || p.type === 'switch' || p.type === 'button');

  for (const part of parts) {
    switch (part.type) {
      case 'npn': {
        const ce = el(part, 'collector-emitter');
        const be = el(part, 'base-emitter');
        const bc = el(part, 'base-collector');
        if (!ce || !be || !bc) break;
        const ic = Math.abs(ce.current - bc.current);
        const power = Math.abs(ce.voltage * ce.current);
        const base = { partIds: [part.id], nets: [ce.netA, ce.netB] };
        const maxMa = param(part, 'maxMa');
        if (ic * 1000 > maxMa) {
          push({
            ...base,
            id: `bjt-ic:${part.id}`,
            severity: 'error',
            title: `${part.name}: collector current too high`,
            detail: `${fmtMa(ic * 1000)} flows but this transistor handles ${fmtMa(maxMa)}. Use a larger transistor or a logic-level MOSFET.`,
          });
        }
        if (power > BJT_MAX_WATTS) {
          push({
            ...base,
            id: `bjt-p:${part.id}`,
            severity: 'error',
            title: `${part.name}: overheating`,
            detail: `It dissipates ${(power * 1000).toFixed(0)} mW (${ce.voltage.toFixed(1)} V across it at ${fmtMa(ic * 1000)}) but a small transistor handles about ${BJT_MAX_WATTS * 1000} mW. Drive the base harder so it saturates, or use a bigger part.`,
          });
        }
        if (ce.voltage > BJT_MAX_VCE) {
          push({
            ...base,
            id: `bjt-v:${part.id}`,
            severity: 'error',
            title: `${part.name}: collector-emitter voltage too high`,
            detail: `${ce.voltage.toFixed(1)} V exceeds the ${BJT_MAX_VCE} V limit of a small NPN transistor.`,
          });
        }
        break;
      }

      case 'nmos': {
        const ds = el(part, 'drain-source');
        if (!ds) break;
        const id = Math.abs(ds.current);
        const vgs = volts(part, 'G') - volts(part, 'S');
        const vth = param(part, 'vth');
        const fullyOnVgs = param(part, 'logicLevel') === 1 ? 3.0 : MOS_FULLY_ON_VGS;
        const power = Math.abs(ds.current * ds.voltage);
        const base = { partIds: [part.id], nets: [ds.netA, ds.netB] };
        if (id > param(part, 'maxA')) {
          push({
            ...base,
            id: `mos-id:${part.id}`,
            severity: 'error',
            title: `${part.name}: drain current too high`,
            detail: `${id.toFixed(2)} A exceeds the ${param(part, 'maxA')} A rating of this MOSFET.`,
          });
        }
        if (Math.abs(ds.voltage) > MOS_MAX_VDS) {
          push({
            ...base,
            id: `mos-vds:${part.id}`,
            severity: 'error',
            title: `${part.name}: drain-source voltage too high`,
            detail: `${Math.abs(ds.voltage).toFixed(1)} V exceeds the ${MOS_MAX_VDS} V limit.`,
          });
        }
        if (Math.abs(vgs) > MOS_MAX_VGS) {
          push({
            ...base,
            id: `mos-vgs:${part.id}`,
            severity: 'error',
            title: `${part.name}: gate voltage too high`,
            detail: `${vgs.toFixed(1)} V on the gate exceeds the ±${MOS_MAX_VGS} V limit and would destroy the gate oxide.`,
          });
        }
        if (power > MOS_MAX_WATTS) {
          push({
            ...base,
            id: `mos-p:${part.id}`,
            severity: 'warning',
            title: `${part.name}: needs a heatsink`,
            detail: `It dissipates ${power.toFixed(2)} W. Without a heatsink a TO-220 MOSFET handles about ${MOS_MAX_WATTS} W. Drive the gate harder or choose a lower-resistance part.`,
          });
        } else if (vgs < fullyOnVgs && id > MOS_ON_CURRENT_AMPS && vgs > vth - 0.5) {
          const effective = Math.abs(ds.voltage / ds.current);
          push({
            ...base,
            id: `mos-weak:${part.id}`,
            severity: 'warning',
            title: `${part.name}: not fully turned on`,
            detail: `The gate is only ${vgs.toFixed(1)} V above the source, below the ${fullyOnVgs.toFixed(1)} V ${param(part, 'logicLevel') === 1 ? 'logic-level target' : 'fully-on target'}, so the channel measures about ${effective.toFixed(2)} Ω and wastes ${(power * 1000).toFixed(0)} mW.`,
            fix: { kind: 'mosfet-gate', vth },
          });
        }
        break;
      }

      case 'relay': {
        const coil = el(part, 'coil');
        const contact = el(part, 'contact');
        if (!coil || !contact) break;
        const coilV = param(part, 'coilV');
        const v = Math.abs(coil.voltage);
        const on = sim.relays.has(part.id);
        const base = { partIds: [part.id], nets: [coil.netA, coil.netB] };
        if (v > 1.3 * coilV) {
          push({
            ...base,
            id: `relay-over:${part.id}`,
            severity: 'error',
            title: `${part.name}: coil voltage too high`,
            detail: `${v.toFixed(1)} V across a ${coilV} V coil overheats it. Use a ${coilV} V supply or a relay with a higher coil rating.`,
          });
        } else if (!on && v > MIN_ACTIVE_VOLTS && v > RELAY_DROP_OUT * coilV) {
          push({
            ...base,
            id: `relay-low:${part.id}`,
            severity: 'warning',
            title: `${part.name}: coil voltage too low`,
            detail: `${v.toFixed(1)} V is below the ~${(RELAY_PULL_IN * coilV).toFixed(1)} V needed to pull in a ${coilV} V relay. The contacts will not switch reliably.`,
          });
        }
        const amps = Math.abs(contact.current);
        if (amps > param(part, 'contactA')) {
          push({
            partIds: [part.id],
            nets: [contact.netA, contact.netB],
            id: `relay-contact:${part.id}`,
            severity: 'error',
            title: `${part.name}: contact overloaded`,
            detail: `${amps.toFixed(1)} A through the contacts exceeds their ${param(part, 'contactA')} A rating; they would weld or burn.`,
          });
        }
        flyback(part, coil, `${part.name} coil`);
        break;
      }

      case 'motor': {
        const winding = el(part, 'winding');
        if (winding) flyback(part, winding, part.name);
        break;
      }

      case 'servo': {
        const load = el(part, 'motor and electronics');
        if (!load) break;
        const v = load.voltage;
        const base = { partIds: [part.id], nets: [load.netA, load.netB] };
        if (v > SERVO_MAX_VOLTS) {
          push({
            ...base,
            id: `servo-over:${part.id}`,
            severity: 'error',
            title: `${part.name}: supply voltage too high`,
            detail: `${v.toFixed(1)} V exceeds the ${SERVO_MAX_VOLTS} V a hobby servo tolerates. Use a 5 V supply or a buck converter.`,
          });
        } else if (v > MIN_ACTIVE_VOLTS && v < SERVO_MIN_VOLTS) {
          push({
            ...base,
            id: `servo-low:${part.id}`,
            severity: 'warning',
            title: `${part.name}: supply voltage too low`,
            detail: `${v.toFixed(1)} V is under the ${SERVO_MIN_VOLTS} V a servo needs, so it will jitter or stall.`,
          });
        }
        const amps = Math.abs(load.current);
        if (amps >= BULK_CAP_MIN_AMPS && !across('capacitor', load.netA, load.netB, '+', '-')) {
          push({
            ...base,
            id: `servo-cap:${part.id}`,
            severity: 'info',
            title: `${part.name}: add a bulk capacitor`,
            detail: `A servo draws short current surges that pull the supply down and can reset the ESP32.`,
            fix: { kind: 'bulk-cap', amps, volts: v },
          });
        }
        break;
      }

      case 'motion-sensor': {
        const supply = el(part, 'sensor supply');
        if (!supply) break;
        const vcc = supply.voltage;
        const base = { partIds: [part.id], nets: [supply.netA, supply.netB] };
        if (vcc > 0 && vcc < 4.5) {
          push({
            ...base,
            id: `pir-low:${part.id}`,
            severity: 'warning',
            title: `${part.name}: supply voltage too low`,
            detail: `${vcc.toFixed(1)} V is below the HC-SR501's 4.5 V minimum; its motion output is disabled.`,
          });
        } else if (vcc > 20) {
          push({
            ...base,
            id: `pir-over:${part.id}`,
            severity: 'error',
            title: `${part.name}: supply voltage too high`,
            detail: `${vcc.toFixed(1)} V exceeds the HC-SR501's 20 V maximum.`,
          });
        }
        break;
      }

      case 'solenoid-lock': {
        const coil = el(part, 'coil');
        if (!coil) break;
        const ratedVoltage = param(part, 'voltage');
        const voltage = Math.abs(coil.voltage);
        const base = { partIds: [part.id], nets: [coil.netA, coil.netB] };
        if (voltage > ratedVoltage * 1.2) {
          push({
            ...base,
            id: `solenoid-over:${part.id}`,
            severity: 'error',
            title: `${part.name}: coil voltage too high`,
            detail: `${voltage.toFixed(1)} V exceeds the ${ratedVoltage} V solenoid's safe operating range.`,
          });
        } else if (voltage > MIN_ACTIVE_VOLTS && voltage < ratedVoltage * 0.75) {
          push({
            ...base,
            id: `solenoid-low:${part.id}`,
            severity: 'warning',
            title: `${part.name}: coil voltage too low`,
            detail: `${voltage.toFixed(1)} V is too low to reliably operate this ${ratedVoltage} V solenoid lock.`,
          });
        }
        flyback(part, coil, `${part.name} coil`);
        break;
      }

      case 'buck': {
        const vin = volts(part, 'IN+') - volts(part, 'IN-');
        const vset = Math.max(BUCK_MIN_VOUT, Math.min(BUCK_MAX_VOUT, param(part, 'vout')));
        const out = el(part, 'output');
        const input = el(part, 'input draw');
        const nets = input ? [input.netA, input.netB] : [];
        const base = { partIds: [part.id], nets };
        if (vin < BUCK_MIN_VIN && vin > 0) {
          push({
            ...base,
            id: `buck-vin-low:${part.id}`,
            severity: 'error',
            title: `${part.name}: input voltage too low`,
            detail: `${vin.toFixed(1)} V is below the ${BUCK_MIN_VIN} V minimum input voltage.`,
          });
        } else if (vin > BUCK_MAX_VIN) {
          push({
            ...base,
            id: `buck-vin:${part.id}`,
            severity: 'error',
            title: `${part.name}: input voltage too high`,
            detail: `${vin.toFixed(1)} V exceeds the ${BUCK_MAX_VIN} V input limit.`,
          });
        } else if (vin >= BUCK_MIN_VIN && vin <= BUCK_MAX_VIN && vin < vset + BUCK_DROPOUT_VOLTS) {
          push({
            ...base,
            id: `buck-low:${part.id}`,
            severity: 'warning',
            title: `${part.name}: input too low to regulate`,
            detail: `A buck converter needs about ${BUCK_DROPOUT_VOLTS} V of headroom: ${vin.toFixed(1)} V in cannot give a steady ${vset} V, so the output sags to ${sim.bucks.get(part.id)?.vout.toFixed(1) ?? '?'} V.`,
          });
        }
        if (out) {
          const amps = Math.max(0, -out.current);
          if (amps > param(part, 'ratedA')) {
            push({
              ...base,
              id: `buck-iout:${part.id}`,
              severity: 'error',
              title: `${part.name}: output overloaded`,
              detail: `${fmtMa(amps * 1000)} drawn from a converter rated for ${fmtMa(param(part, 'ratedA') * 1000)}. Reduce the load or use a bigger converter.`,
            });
          }
        }
        break;
      }

      case 'i2c-sensor':
      case 'lcd1602': {
        const isLcd = part.type === 'lcd1602';
        const supply = el(part, 'supply');
        if (!supply) break;
        const vcc = supply.voltage;
        const maxV = isLcd ? LCD_MAX_VOLTS : param(part, 'maxV');
        const base = { partIds: [part.id], nets: [supply.netA, supply.netB] };
        if (vcc > maxV) {
          push({
            ...base,
            id: `sensor-over:${part.id}`,
            severity: 'error',
            title: `${part.name}: supply voltage too high`,
            detail: `${vcc.toFixed(1)} V exceeds the ${maxV} V this ${isLcd ? 'display' : 'sensor'} accepts. Power it from ${isLcd ? '5 V' : '3.3 V'}.`,
          });
        }
        if (isLcd && vcc > MIN_ACTIVE_VOLTS && vcc < LCD_MIN_VOLTS) {
          push({
            ...base,
            id: `lcd-under:${part.id}`,
            severity: 'warning',
            title: `${part.name}: supply voltage too low`,
            detail: `${vcc.toFixed(1)} V is below the ${LCD_MIN_VOLTS} V this display needs, so it will stay blank or show garbage. Power VCC from the 5 V (VIN) pin.`,
          });
        }
        const lines = ['SDA', 'SCL'] as const;
        if (param(part, 'pullups') === 1 && vcc > I2C_MAX_SAFE_VOLTS && lines.some((l) => hasPart(netOf(part, l), (p) => isBoardType(p.type)))) {
          push({
            ...base,
            id: `sensor-pullup:${part.id}`,
            severity: 'warning',
            title: `${part.name}: I2C lines pulled up to ${vcc.toFixed(1)} V`,
            detail: isLcd
              ? 'The LCD backpack’s pull-up resistors tie SDA/SCL to its 5 V supply, which pushes 5 V into the ESP32 pins (rated 3.3 V). Use a level shifter, or remove the backpack’s pull-up resistors and pull up to 3.3 V instead.'
              : 'The sensor’s pull-up resistors tie SDA/SCL to its supply, which pushes that voltage into the ESP32 pins. Power the sensor from 3.3 V or use a level shifter.',
          });
        }
        if (param(part, 'pullups') !== 1) {
          for (const line of lines) {
            const net = netOf(part, line);
            const vccNet = netOf(part, 'VCC');
            const isRail = (n: number) => n === vccNet || (sim.nets.nets[n] ?? []).some((k) => /:3V3b?$/.test(k));
            const pulled = sim.elements.some((e) => e.partType === 'resistor' && ((e.netA === net && isRail(e.netB)) || (e.netB === net && isRail(e.netA))));
            if (!pulled) {
              push({
                partIds: [part.id],
                nets: [net],
                id: `sensor-nopull:${part.id}:${line}`,
                severity: 'warning',
                title: `${part.name}: ${line} has no pull-up`,
                detail: 'I2C lines are open-drain and need a resistor to the supply on each line.',
                fix: { kind: 'i2c-pullup', volts: Math.max(vcc, 1.8) },
              });
            }
          }
        }
        break;
      }

      case 'multimeter': {
        const meter = el(part, 'meter');
        if (!meter) break;
        if (param(part, 'ammeter') === 1 && Math.abs(meter.voltage) > MIN_ACTIVE_VOLTS) {
          push({
            partIds: [part.id],
            nets: [meter.netA, meter.netB],
            id: `meter-parallel:${part.id}`,
            severity: 'error',
            title: `${part.name}: ammeter connected across a voltage`,
            detail: `An ammeter has almost no resistance, so ${Math.abs(meter.voltage).toFixed(1)} V across it drives ${fmtMa(Math.abs(meter.current) * 1000)} through it. Put it in series with the load, or switch to voltmeter mode.`,
          });
        }
        break;
      }
    }
  }

  /** Motors and relay coils kick back a voltage spike when switched off, which a diode across them absorbs. */
  function flyback(part: Part, winding: { netA: number; netB: number; current: number }, name: string) {
    if (across('diode', winding.netA, winding.netB, 'A', 'K')) return;
    const electronic = driven(winding.netA) || driven(winding.netB);
    push({
      partIds: [part.id],
      nets: [winding.netA, winding.netB],
      id: `flyback:${part.id}`,
      severity: electronic ? 'warning' : 'info',
      title: `${name}: no flyback diode`,
      detail: `When it is switched off, the coil's magnetic field produces a voltage spike that can destroy ${electronic ? 'the transistor or ESP32 pin driving it' : 'whatever switches it'}.`,
      fix: { kind: 'flyback', amps: Math.abs(winding.current) },
    });
  }

  return issues;
}
