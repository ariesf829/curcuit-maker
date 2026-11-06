import { describe, expect, it } from 'vitest';
import type { PinMode } from '../model/boards';
import type { PartType } from '../model/parts';
import type { Part, Wire } from '../model/types';
import { checkCircuit } from './checks';
import { pinVoltage, simulate } from './simulate';

let n = 0;
const mk = (type: PartType, params: Record<string, number> = {}, pinModes?: Record<string, PinMode>): Part => ({
  id: `${type}${n++}`,
  type,
  name: type,
  x: n * 3000,
  y: 0,
  rot: 0,
  params,
  pinModes,
});
const wire = (a: Part, pa: string, b: Part, pb: string): Wire => ({
  id: `w${n++}`,
  from: { partId: a.id, pin: pa },
  to: { partId: b.id, pin: pb },
});
const run = (parts: Part[], wires: Wire[]) => {
  const sim = simulate(parts, wires);
  return { sim, issues: checkCircuit(parts, sim) };
};
const has = (issues: ReturnType<typeof checkCircuit>, text: string) => issues.some((i) => i.title.includes(text));

describe('ESP32 power', () => {
  it('USB-powered board provides 3.3 V and 5 V', () => {
    const esp = mk('esp32-devkit-v1');
    const { sim } = run([esp], []);
    expect(pinVoltage(sim, esp.id, '3V3')).toBeCloseTo(3.3, 1);
    expect(pinVoltage(sim, esp.id, 'VIN')).toBeCloseTo(5, 1);
    expect(pinVoltage(sim, esp.id, 'GND')).toBe(0);
    expect(pinVoltage(sim, esp.id, 'GND2')).toBe(0);
  });

  it('board fed through VIN only regulates when the input is high enough', () => {
    const esp = mk('esp32-devkit-v1', { usb: 0 });
    const bat = mk('battery', { voltage: 5, rint: 0.1 });
    const w = [wire(bat, '+', esp, 'VIN'), wire(bat, '-', esp, 'GND')];
    const on = run([esp, bat], w);
    expect(pinVoltage(on.sim, esp.id, '3V3')).toBeCloseTo(3.3, 1);

    const weak = mk('battery', { voltage: 3, rint: 0.1 });
    const off = run([esp, weak], [wire(weak, '+', esp, 'VIN'), wire(weak, '-', esp, 'GND')]);
    expect(pinVoltage(off.sim, esp.id, '3V3')).toBeLessThan(0.5);
    expect(off.sim.warnings.some((x) => x.includes('not powered'))).toBe(true);
  });

  it('flags an overloaded 3.3 V regulator', () => {
    const esp = mk('esp32-devkit-v1');
    const r = mk('resistor', { ohms: 3 });
    const { issues } = run([esp, r], [wire(esp, '3V3', r, 'A'), wire(r, 'B', esp, 'GND')]);
    expect(has(issues, '3.3 V regulator overloaded')).toBe(true);
  });

  it('flags a 3V3-to-GND short', () => {
    const esp = mk('esp32-devkit-v1');
    const { issues } = run([esp], [wire(esp, '3V3', esp, 'GND')]);
    expect(has(issues, 'Short circuit')).toBe(true);
  });

  it('flags drawing too much from USB', () => {
    const esp = mk('esp32-s3');
    const r = mk('resistor', { ohms: 8 });
    const { issues } = run([esp, r], [wire(esp, '5V', r, 'A'), wire(r, 'B', esp, 'GND')]);
    expect(has(issues, 'USB power budget')).toBe(true);
  });
});

describe('GPIO', () => {
  it('output HIGH drives an LED through a resistor within limits', () => {
    const esp = mk('esp32-devkit-v1', {}, { D4: 'high' });
    const r = mk('resistor', { ohms: 220 });
    const led = mk('led');
    const { sim, issues } = run(
      [esp, r, led],
      [wire(esp, 'D4', r, 'A'), wire(r, 'B', led, 'A'), wire(led, 'K', esp, 'GND')],
    );
    const ledEl = sim.elements.find((e) => e.partId === led.id)!;
    expect(ledEl.current).toBeGreaterThan(0.003);
    expect(ledEl.current).toBeLessThan(0.008);
    expect(issues).toEqual([]);
  });

  it('flags an LED without a resistor on a GPIO', () => {
    const esp = mk('esp32-devkit-v1', {}, { D4: 'high' });
    const led = mk('led');
    const { issues } = run([esp, led], [wire(esp, 'D4', led, 'A'), wire(led, 'K', esp, 'GND')]);
    expect(has(issues, 'GPIO4: overloaded')).toBe(true);
    expect(has(issues, 'current too high')).toBe(true);
  });

  it('flags a GPIO set LOW that sinks too much current from 3V3', () => {
    const esp = mk('esp32-c3', {}, { D4: 'low' });
    const r = mk('resistor', { ohms: 50 });
    const { issues } = run([esp, r], [wire(esp, '3V3', r, 'A'), wire(r, 'B', esp, 'D4')]);
    expect(has(issues, 'GPIO4: overloaded')).toBe(true);
  });

  it('flags 5 V on a 3.3 V GPIO', () => {
    const esp = mk('esp32-devkit-v1');
    const { issues } = run([esp], [wire(esp, 'VIN', esp, 'D4')]);
    expect(has(issues, 'on a 3.3 V pin')).toBe(true);
  });

  it('flags output contention', () => {
    const esp = mk('esp32-devkit-v1', {}, { D4: 'high', D5: 'low' });
    const { issues } = run([esp], [wire(esp, 'D4', esp, 'D5')]);
    expect(has(issues, 'Output contention')).toBe(true);
  });

  it('flags outputs on input-only pins', () => {
    const esp = mk('esp32-devkit-v1', {}, { D34: 'high' });
    const { issues } = run([esp], []);
    expect(has(issues, 'input-only')).toBe(true);
  });

  it('allows outputs on every pin of the S3', () => {
    const s3 = mk('esp32-s3', {}, { D35: 'high' });
    expect(has(run([s3], []).issues, 'input-only')).toBe(false);
  });

  it('flags ADC2 reads while Wi-Fi is on, but not ADC1', () => {
    const bad = mk('esp32-devkit-v1', { wifi: 1 }, { D4: 'adc' });
    const good = mk('esp32-devkit-v1', { wifi: 1 }, { D32: 'adc' });
    const off = mk('esp32-devkit-v1', { wifi: 0 }, { D4: 'adc' });
    expect(has(run([bad], []).issues, 'ADC2')).toBe(true);
    expect(has(run([good], []).issues, 'ADC2')).toBe(false);
    expect(has(run([off], []).issues, 'ADC2')).toBe(false);
  });

  it('warns about strapping pins in use and errors when GPIO12 is held high', () => {
    const esp = mk('esp32-devkit-v1');
    const r = mk('resistor');
    const used = run([esp, r], [wire(esp, 'D12', r, 'A')]);
    expect(has(used.issues, 'strapping pin')).toBe(true);
    expect(used.issues.find((i) => i.title.includes('strapping'))!.severity).toBe('warning');

    const held = run([esp], [wire(esp, '3V3', esp, 'D12')]);
    expect(held.issues.find((i) => i.title.includes('strapping'))!.severity).toBe('error');

    expect(has(run([esp], []).issues, 'strapping')).toBe(false);
  });
});

describe('component ratings', () => {
  it('flags a resistor over its power rating', () => {
    const bat = mk('battery', { voltage: 12, rint: 0.1 });
    const r = mk('resistor', { ohms: 100 });
    const { issues } = run([bat, r], [wire(bat, '+', r, 'A'), wire(r, 'B', bat, '-')]);
    expect(has(issues, 'power rating')).toBe(true);
  });

  it('flags a blown fuse', () => {
    const bat = mk('battery', { voltage: 5, rint: 0.1 });
    const f = mk('fuse', { ratedA: 0.1 });
    const r = mk('resistor', { ohms: 10 });
    const { issues } = run([bat, f, r], [wire(bat, '+', f, 'A'), wire(f, 'B', r, 'A'), wire(r, 'B', bat, '-')]);
    expect(has(issues, 'fuse would blow')).toBe(true);
  });

  it('flags a battery short circuit', () => {
    const bat = mk('battery', { voltage: 9, rint: 0.5 });
    const { issues } = run([bat], [wire(bat, '+', bat, '-')]);
    expect(has(issues, 'Short circuit')).toBe(true);
  });

  it('reports nothing for a healthy LED circuit', () => {
    const bat = mk('battery', { voltage: 5, rint: 0.1 });
    const r = mk('resistor', { ohms: 220 });
    const led = mk('led');
    const { issues } = run([bat, r, led], [wire(bat, '+', r, 'A'), wire(r, 'B', led, 'A'), wire(led, 'K', bat, '-')]);
    expect(issues).toEqual([]);
  });
});
