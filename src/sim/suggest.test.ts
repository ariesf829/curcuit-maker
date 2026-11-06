import { describe, expect, it } from 'vitest';
import { e12Down, e12Up, e6Up, formatFarads, formatOhms } from '../model/eseries';
import type { PartType } from '../model/parts';
import type { Part, Wire } from '../model/types';
import { checkCircuit } from './checks';
import { simulate } from './simulate';
import { addSuggestions } from './suggest';

let n = 0;
const mk = (type: PartType, params: Record<string, number> = {}, extra: Partial<Part> = {}): Part => ({
  id: `${type}${n++}`,
  type,
  name: type,
  x: n * 1000,
  y: 0,
  rot: 0,
  params,
  ...extra,
});
const wire = (a: Part, pa: string, b: Part, pb: string): Wire => ({
  id: `w${n++}`,
  from: { partId: a.id, pin: pa },
  to: { partId: b.id, pin: pb },
});

function analyse(parts: Part[], wires: Wire[]) {
  const sim = simulate(parts, wires);
  return addSuggestions(checkCircuit(parts, sim), parts, wires, sim);
}
const byPrefix = (issues: ReturnType<typeof analyse>, prefix: string) => issues.find((i) => i.id.startsWith(prefix));

describe('standard values', () => {
  it('rounds to E12 and E6', () => {
    expect(e12Up(367)).toBe(390);
    expect(e12Up(390)).toBe(390);
    expect(e12Down(260)).toBe(220);
    expect(e12Up(0.31)).toBeCloseTo(0.33, 5);
    expect(e12Up(10300)).toBe(12000);
    expect(e6Up(1000e-6)).toBeCloseTo(1000e-6, 9);
    expect(e6Up(1100e-6)).toBeCloseTo(1500e-6, 9);
  });

  it('formats values', () => {
    expect(formatOhms(4700)).toBe('4.7 kΩ');
    expect(formatOhms(330)).toBe('330 Ω');
    expect(formatFarads(1000e-6)).toBe('1 mF');
    expect(formatFarads(470e-6)).toBe('470 µF');
  });
});

describe('suggestions', () => {
  it('sizes an LED resistor from the Thevenin equivalent of the circuit', () => {
    const bat = mk('battery', { voltage: 9, rint: 0.001 });
    const r = mk('resistor', { ohms: 100 });
    const led = mk('led');
    const issues = analyse([bat, r, led], [wire(bat, '+', r, 'A'), wire(r, 'B', led, 'A'), wire(led, 'K', bat, '-')]);
    const issue = byPrefix(issues, 'max-ma:');
    expect(issue).toBeDefined();
    // (9 V - 1.99 V) / 15 mA = 467 ohm in total, 100 ohm already there -> add 367 -> E12 390
    expect(issue!.suggestion).toContain('390 Ω');
  });

  it('suggests a larger or higher-wattage resistor when power is exceeded', () => {
    const bat = mk('battery', { voltage: 12, rint: 0.001 });
    const r = mk('resistor', { ohms: 100 });
    const issues = analyse([bat, r], [wire(bat, '+', r, 'A'), wire(r, 'B', bat, '-')]);
    const issue = byPrefix(issues, 'watts:');
    expect(issue).toBeDefined();
    // 12^2 / 0.2 = 720 ohm -> E12 820
    expect(issue!.suggestion).toContain('820 Ω');
    expect(issue!.suggestion).toContain('2 W');
  });

  it('suggests a voltage divider for 5 V on an ESP32 pin', () => {
    const board = mk('esp32-devkit-v1');
    const bat = mk('battery', { voltage: 5, rint: 0.001 });
    const issues = analyse([board, bat], [wire(bat, '+', board, 'D34'), wire(bat, '-', board, 'GND')]);
    const issue = byPrefix(issues, 'overvolt:');
    expect(issue).toBeDefined();
    // aims for about 3 V on the pin: 10k x (5 / 3 - 1) = 6.7 k -> E12 6.8 k
    expect(issue!.suggestion).toContain('6.8 kΩ');
  });

  it('advises a series resistor when an LED is wired straight to a GPIO', () => {
    const board = mk('esp32-devkit-v1', {}, { pinModes: { D4: 'high' } });
    const led = mk('led');
    const issues = analyse([board, led], [wire(board, 'D4', led, 'A'), wire(led, 'K', board, 'GND')]);
    const gpio = byPrefix(issues, 'gpio-');
    expect(gpio).toBeDefined();
    expect(gpio!.suggestion).toContain('series');
    const ledIssue = byPrefix(issues, 'warn-ma:') ?? byPrefix(issues, 'max-ma:');
    expect(ledIssue?.suggestion).toMatch(/Ω resistor in series/);
  });

  it('recommends a transistor for a heavy GPIO load and calculates the base resistor', () => {
    const board = mk('esp32-devkit-v1', {}, { pinModes: { D4: 'high' } });
    const motor = mk('motor', { ohms: 15 });
    const issues = analyse([board, motor], [wire(board, 'D4', motor, 'M+'), wire(motor, 'M-', board, 'GND')]);
    const gpio = byPrefix(issues, 'gpio-max:');
    expect(gpio).toBeDefined();
    // ~ 3.3 V / 45 ohm = 73 mA -> light enough for the series-resistor advice
    expect(gpio!.suggestion).toBeDefined();
  });
});

describe('device checks', () => {
  function motorCircuit(withDiode: boolean) {
    const bat = mk('battery', { voltage: 6, rint: 0.01 });
    const motor = mk('motor', { ohms: 20 });
    const q = mk('npn');
    const rb = mk('resistor', { ohms: 4700 });
    const parts = [bat, motor, q, rb];
    const wires = [
      wire(bat, '+', motor, 'M+'),
      wire(motor, 'M-', q, 'C'),
      wire(q, 'E', bat, '-'),
      wire(rb, 'A', bat, '+'),
      wire(rb, 'B', q, 'B'),
    ];
    if (withDiode) {
      const d = mk('diode');
      parts.push(d);
      wires.push(wire(d, 'K', motor, 'M+'), wire(d, 'A', motor, 'M-'));
    }
    return analyse(parts, wires);
  }

  it('warns about a missing flyback diode on a transistor-driven motor, with a part suggestion', () => {
    const issue = byPrefix(motorCircuit(false), 'flyback:');
    expect(issue?.severity).toBe('warning');
    expect(issue?.suggestion).toContain('1N4148');
  });

  it('is satisfied by a diode across the motor', () => {
    expect(byPrefix(motorCircuit(true), 'flyback:')).toBeUndefined();
  });

  it('flags a servo running from too low a voltage and suggests a bulk capacitor', () => {
    const bat = mk('battery', { voltage: 3, rint: 0.01 });
    const servo = mk('servo', { runMa: 250 });
    const issues = analyse([bat, servo], [wire(bat, '+', servo, 'V+'), wire(bat, '-', servo, 'GND')]);
    expect(byPrefix(issues, 'servo-low:')).toBeDefined();

    const ok = mk('battery', { voltage: 5, rint: 0.01 });
    const servo2 = mk('servo', { runMa: 250 });
    const more = analyse([ok, servo2], [wire(ok, '+', servo2, 'V+'), wire(ok, '-', servo2, 'GND')]);
    const cap = byPrefix(more, 'servo-cap:');
    // 2 x 0.25 A x 0.5 ms / 0.25 V = 1 mF
    expect(cap?.suggestion).toContain('1 mF');
  });

  it('flags an ammeter wired across a battery', () => {
    const bat = mk('battery', { voltage: 5, rint: 0.1 });
    const meter = mk('multimeter', { ammeter: 1 });
    const issues = analyse([bat, meter], [wire(bat, '+', meter, 'V/A'), wire(bat, '-', meter, 'COM')]);
    expect(byPrefix(issues, 'meter-parallel:')?.severity).toBe('error');
  });

  it('flags a MOSFET that is not driven hard enough', () => {
    const supply = mk('battery', { voltage: 12, rint: 0.001 });
    const gate = mk('battery', { voltage: 2.4, rint: 0.001 });
    const load = mk('resistor', { ohms: 100 });
    const m = mk('nmos', { vth: 2, rds: 0.05 });
    const issues = analyse(
      [supply, gate, load, m],
      [
        wire(supply, '+', load, 'A'),
        wire(load, 'B', m, 'D'),
        wire(m, 'S', supply, '-'),
        wire(gate, '+', m, 'G'),
        wire(gate, '-', supply, '-'),
      ],
    );
    expect(byPrefix(issues, 'mos-weak:')).toBeDefined();
  });

  it('warns when a buck converter is overloaded or lacks headroom', () => {
    const bat = mk('battery', { voltage: 12, rint: 0.01 });
    const buck = mk('buck', { vout: 5, ratedA: 1 });
    const load = mk('resistor', { ohms: 2 });
    const issues = analyse(
      [bat, buck, load],
      [wire(bat, '+', buck, 'IN+'), wire(bat, '-', buck, 'IN-'), wire(buck, 'OUT+', load, 'A'), wire(buck, 'OUT-', load, 'B')],
    );
    expect(byPrefix(issues, 'buck-iout:')).toBeDefined();
  });

  it('reports a relay coil that is below its pull-in voltage', () => {
    const bat = mk('battery', { voltage: 3.5, rint: 0.01 });
    const relay = mk('relay', { coilV: 5 });
    const issues = analyse([bat, relay], [wire(bat, '+', relay, 'COIL+'), wire(bat, '-', relay, 'COIL-')]);
    expect(byPrefix(issues, 'relay-low:')).toBeDefined();
  });

  it('warns about a 5 V sensor pull-up feeding an ESP32 pin', () => {
    const board = mk('esp32-devkit-v1');
    const sensor = mk('i2c-sensor', { maxV: 5.5, pullups: 1 });
    const bat = mk('battery', { voltage: 5, rint: 0.01 });
    const issues = analyse(
      [board, sensor, bat],
      [
        wire(bat, '+', sensor, 'VCC'),
        wire(bat, '-', sensor, 'GND'),
        wire(bat, '-', board, 'GND'),
        wire(sensor, 'SDA', board, 'D21'),
      ],
    );
    expect(byPrefix(issues, 'sensor-pullup:')).toBeDefined();
  });

  it('asks for I2C pull-ups when the module has none, with a calculated range', () => {
    const bat = mk('battery', { voltage: 3.3, rint: 0.01 });
    const sensor = mk('i2c-sensor', { pullups: 0 });
    const issues = analyse([bat, sensor], [wire(bat, '+', sensor, 'VCC'), wire(bat, '-', sensor, 'GND')]);
    const issue = byPrefix(issues, 'sensor-nopull:');
    expect(issue?.suggestion).toContain('4.7 kΩ');
  });
});
