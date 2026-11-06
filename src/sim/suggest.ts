import { GPIO_HIGH_VOLTS, GPIO_OUT_OHMS, MAX_PIN_VOLTS } from '../model/boards';
import { e12Down, e12Up, e6Up, formatFarads, formatOhms } from '../model/eseries';
import { param } from '../model/params';
import { RATINGS } from '../model/ratings';
import type { Part, Wire } from '../model/types';
import type { Issue } from './checks';
import type { Fix } from './fix';
import { VT } from './mna';
import { pinVoltage, simulate, type SimResult } from './simulate';

const LED_N = 2;
const LED_REF_AMPS = 0.02;
const LOW_VOLTAGE_LED_TARGET_AMPS = 0.01;
const HIGH_VOLTAGE_LED_TARGET_AMPS = 0.015;
const GPIO_TARGET_AMPS = 0.01;
const HEAVY_LOAD_AMPS = 0.08;
const NPN_FORCED_BETA = 20;
const NPN_VBE = 0.7;
const MAX_BASE_AMPS = 0.01;
const POWER_DERATING = 0.8;
const RESISTOR_WATT_STEPS = [0.5, 1, 2, 5];
const DIVIDER_BOTTOM_OHMS = 10000;
const DIVIDER_TARGET_VOLTS = 3.2;
const I2C_SINK_AMPS = 0.003;
const I2C_LOW_LEVEL_VOLTS = 0.4;
const I2C_RISE_SECONDS = 1e-6;
const I2C_BUS_FARADS = 100e-12;
const I2C_COMMON_PULLUP_OHMS = 4700;
const BULK_CAP_SURGE_FACTOR = 2;
const BULK_CAP_SURGE_SECONDS = 0.5e-3;
const BULK_CAP_DROOP_VOLTS = 0.25;
const CAP_VOLTAGE_STEPS = [6.3, 10, 16, 25, 35, 50];

const fmtMa = (amps: number) => `${(amps * 1000).toFixed(amps < 0.01 ? 1 : 0)} mA`;

interface Ctx {
  parts: Part[];
  wires: Wire[];
  sim: SimResult;
}

/** Fills in calculated advice for every issue that carries a fix descriptor. */
export function addSuggestions(issues: Issue[], parts: Part[], wires: Wire[], sim: SimResult): Issue[] {
  const ctx = { parts, wires, sim };
  return issues.map((i) => {
    const suggestion = i.fix ? resolve(i.fix, ctx) : undefined;
    return suggestion ? { ...i, suggestion } : i;
  });
}

function resolve(fix: Fix, ctx: Ctx): string | undefined {
  switch (fix.kind) {
    case 'led-resistor':
      return ledResistor(fix.partId, ctx);
    case 'resistor-power': {
      const max = RATINGS.resistor?.maxWatts ?? 0.25;
      const minOhms = fix.volts ** 2 / (POWER_DERATING * max);
      const bigger = RESISTOR_WATT_STEPS.find((w) => POWER_DERATING * w >= fix.watts);
      return `If the voltage across it stays at ${fix.volts.toFixed(1)} V, use at least ${formatOhms(e12Up(minOhms))} (V² ÷ ${(POWER_DERATING * max).toFixed(2)} W = ${formatOhms(minOhms)})${
        bigger ? `, or keep the value and use a ${bigger} W resistor (it dissipates ${(fix.watts * 1000).toFixed(0)} mW)` : ''
      }.`;
    }
    case 'gpio-load':
      return gpioLoad(fix, ctx);
    case 'divider': {
      const r1 = DIVIDER_BOTTOM_OHMS * (fix.volts / DIVIDER_TARGET_VOLTS - 1);
      if (r1 <= 0) return undefined;
      const top = e12Up(r1);
      const out = (fix.volts * DIVIDER_BOTTOM_OHMS) / (top + DIVIDER_BOTTOM_OHMS);
      return `For an input signal, use a divider: ${formatOhms(top)} from the ${fix.volts.toFixed(1)} V signal to the pin and ${formatOhms(DIVIDER_BOTTOM_OHMS)} from the pin to GND. The pin then sees ${out.toFixed(2)} V (limit ${MAX_PIN_VOLTS} V). For a signal the ESP32 must drive back, use a level shifter instead.`;
    }
    case 'flyback': {
      const diode = fix.amps <= 0.2 ? '1N4148 (200 mA)' : fix.amps <= 1 ? '1N4001 (1 A)' : '1N5822 Schottky (3 A)';
      return `Add a ${diode} diode across it: cathode (striped end) to the more positive side, anode to the other side. It carries the running current (${fmtMa(fix.amps)}) for a moment when the load switches off.`;
    }
    case 'bulk-cap': {
      const farads = (BULK_CAP_SURGE_FACTOR * fix.amps * BULK_CAP_SURGE_SECONDS) / BULK_CAP_DROOP_VOLTS;
      const value = e6Up(farads);
      const rating = CAP_VOLTAGE_STEPS.find((v) => v >= 1.5 * Math.max(fix.volts, 1)) ?? 63;
      return `Place a ${formatFarads(value)} electrolytic capacitor rated ${rating} V or more across the servo's V+ and GND. C = I × t ÷ ΔV = ${BULK_CAP_SURGE_FACTOR} × ${fmtMa(fix.amps)} × ${BULK_CAP_SURGE_SECONDS * 1000} ms ÷ ${BULK_CAP_DROOP_VOLTS} V = ${formatFarads(farads)}. Add a 100 nF ceramic capacitor beside it.`;
    }
    case 'i2c-pullup': {
      const min = (fix.volts - I2C_LOW_LEVEL_VOLTS) / I2C_SINK_AMPS;
      const max = I2C_RISE_SECONDS / (0.8473 * I2C_BUS_FARADS);
      const pick = I2C_COMMON_PULLUP_OHMS >= min && I2C_COMMON_PULLUP_OHMS <= max ? I2C_COMMON_PULLUP_OHMS : e12Up(min);
      return `Connect a ${formatOhms(pick)} resistor from this line to the sensor's supply (${fix.volts.toFixed(1)} V). Allowed range for standard-mode I2C: ${formatOhms(min)} (so the line can be pulled low with ${I2C_SINK_AMPS * 1000} mA) to ${formatOhms(max)} (fast enough edges with ${I2C_BUS_FARADS * 1e12} pF of wiring).`;
    }
    case 'mosfet-gate':
      return `This MOSFET needs about ${(Math.max(4.5, fix.vth + 2.5)).toFixed(1)} V on the gate to be fully on. Drive the gate from 5 V through an NPN level shifter, or choose a logic-level MOSFET with a threshold under 2 V. Put a 100 Ω resistor in series with the gate and a 10 kΩ pull-down to GND so it stays off during boot.`;
  }
}

function ledResistor(partId: string, { parts, wires }: Ctx): string | undefined {
  const part = parts.find((p) => p.id === partId);
  if (!part) return undefined;
  const across = (ohms: number) => {
    const s = simulate(parts, wires, { partId, ohms });
    return (pinVoltage(s, partId, 'A') ?? 0) - (pinVoltage(s, partId, 'K') ?? 0);
  };
  // Thevenin equivalent of everything except the LED: open-circuit voltage and source resistance.
  const testOhms = 1000;
  const voc = across(1e9);
  const vTest = across(testOhms);
  if (voc < 0.5) return undefined;
  const rth = vTest > 1e-6 ? testOhms * (voc / vTest - 1) : Infinity;

  const target = voc <= 3.6 ? LOW_VOLTAGE_LED_TARGET_AMPS : HIGH_VOLTAGE_LED_TARGET_AMPS;
  const vf = param(part, 'vf') + LED_N * VT * Math.log(target / LED_REF_AMPS);
  if (voc <= vf + 0.1) return `Only ${voc.toFixed(1)} V is available for an LED that needs about ${vf.toFixed(1)} V, so no resistor can give it a safe current. Use a higher supply voltage.`;

  const total = (voc - vf) / target;
  if (rth >= total * 0.98) return undefined;
  const add = e12Up(total - rth);
  const estimate = (voc - vf) / (rth + add);
  return `Add a ${formatOhms(add)} resistor in series with the LED. R = (${voc.toFixed(2)} V − ${vf.toFixed(2)} V) ÷ ${fmtMa(target)} = ${formatOhms(total)} in total, and the circuit already has about ${formatOhms(rth)}. That gives roughly ${fmtMa(estimate)}.`;
}

function gpioLoad(fix: Extract<Fix, { kind: 'gpio-load' }>, { sim }: Ctx): string | undefined {
  const mosfet = 'or a logic-level N-MOSFET with a 100 Ω gate resistor and a 10 kΩ pull-down to GND';
  if (fix.amps >= HEAVY_LOAD_AMPS) {
    const ib = fix.amps / NPN_FORCED_BETA;
    if (ib > MAX_BASE_AMPS) {
      return `${fmtMa(fix.amps)} is far more than a pin can supply. Switch the load with a logic-level N-MOSFET (100 Ω gate resistor, 10 kΩ pull-down to GND) powered from its own supply.`;
    }
    const rb = e12Down((GPIO_HIGH_VOLTS - NPN_VBE) / ib);
    return `Switch the load with an NPN transistor: base current = ${fmtMa(fix.amps)} ÷ ${NPN_FORCED_BETA} = ${fmtMa(ib)}, so the base resistor is (${GPIO_HIGH_VOLTS} V − ${NPN_VBE} V) ÷ ${fmtMa(ib)} = ${formatOhms(rb)}. Or use ${mosfet}.`;
  }
  if (!fix.sourcing) return `Add a series resistor so the pin sinks no more than ${fmtMa(GPIO_TARGET_AMPS)}: R = (supply voltage − load voltage) ÷ ${fmtMa(GPIO_TARGET_AMPS)} − ${GPIO_OUT_OHMS} Ω, or switch the load with a transistor.`;

  const vPin = pinVoltage(sim, fix.boardId, fix.pin) ?? 0;
  // A load that holds a fixed voltage (like an LED) and a plain resistor need different values; take the safer one.
  const constantVoltage = (GPIO_HIGH_VOLTS - vPin) / GPIO_TARGET_AMPS - GPIO_OUT_OHMS;
  const resistive = GPIO_HIGH_VOLTS / GPIO_TARGET_AMPS - GPIO_OUT_OHMS - vPin / fix.amps;
  const add = vPin >= 0.5 ? constantVoltage : resistive;
  if (add <= 0) return undefined;
  return `Add about ${formatOhms(e12Up(add))} in series with the load to hold the pin near ${fmtMa(GPIO_TARGET_AMPS)} (R = (${GPIO_HIGH_VOLTS} V − ${vPin.toFixed(1)} V) ÷ ${fmtMa(GPIO_TARGET_AMPS)} − ${GPIO_OUT_OHMS} Ω pin resistance), or ${mosfet}.`;
}
