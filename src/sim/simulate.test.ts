import { describe, expect, it } from 'vitest';
import type { PartType } from '../model/parts';
import type { Part, Wire } from '../model/types';
import { pinVoltage, simulate } from './simulate';

// Parts are placed far apart so only explicit wires connect them.
let n = 0;
const mk = (type: PartType, params: Record<string, number> = {}): Part => ({
  id: `${type}${n++}`,
  type,
  name: type,
  x: n * 1000,
  y: 0,
  rot: 0,
  params,
});
const wire = (a: Part, pa: string, b: Part, pb: string): Wire => ({
  id: `w${n++}`,
  from: { partId: a.id, pin: pa },
  to: { partId: b.id, pin: pb },
});
const el = (sim: ReturnType<typeof simulate>, part: Part) => sim.elements.find((e) => e.partId === part.id)!;

describe('linear circuits', () => {
  it('battery + resistor obeys Ohm law including internal resistance', () => {
    const bat = mk('battery', { voltage: 9, rint: 0.5 });
    const r = mk('resistor', { ohms: 1000 });
    const sim = simulate([bat, r], [wire(bat, '+', r, 'A'), wire(r, 'B', bat, '-')]);
    expect(sim.converged).toBe(true);
    expect(el(sim, r).current).toBeCloseTo(9 / 1000.5, 6);
    expect(el(sim, bat).current).toBeCloseTo(-9 / 1000.5, 6);
  });

  it('voltage divider', () => {
    const bat = mk('battery', { voltage: 10, rint: 0.001 });
    const r1 = mk('resistor', { ohms: 1000 });
    const r2 = mk('resistor', { ohms: 3000 });
    const sim = simulate(
      [bat, r1, r2],
      [wire(bat, '+', r1, 'A'), wire(r1, 'B', r2, 'A'), wire(r2, 'B', bat, '-')],
    );
    expect(pinVoltage(sim, r1.id, 'B')).toBeCloseTo(7.5, 2);
    expect(pinVoltage(sim, bat.id, '-')).toBe(0);
  });

  it('potentiometer wiper follows its position', () => {
    const bat = mk('battery', { voltage: 5, rint: 0.001 });
    const pot = mk('potentiometer', { ohms: 10000, position: 0.25 });
    const sim = simulate([bat, pot], [wire(bat, '+', pot, '1'), wire(pot, '2', bat, '-')]);
    // upper half = 25% of the track, so the wiper sits at 75% of the supply
    expect(pinVoltage(sim, pot.id, 'W')).toBeCloseTo(3.75, 2);
  });

  it('open switch carries no current and closed switch does', () => {
    const bat = mk('battery', { voltage: 5, rint: 0.1 });
    const sw = mk('switch', { closed: 0 });
    const r = mk('resistor', { ohms: 100 });
    const w = [wire(bat, '+', sw, '1'), wire(sw, '2', r, 'A'), wire(r, 'B', bat, '-')];
    expect(el(simulate([bat, sw, r], w), r).current).toBeCloseTo(0, 9);
    sw.params = { closed: 1 };
    expect(el(simulate([bat, sw, r], w), r).current).toBeCloseTo(5 / 100.12, 4);
  });

  it('capacitor blocks DC', () => {
    const bat = mk('battery');
    const c = mk('capacitor');
    const r = mk('resistor');
    const sim = simulate([bat, c, r], [wire(bat, '+', c, '+'), wire(c, '-', r, 'A'), wire(r, 'B', bat, '-')]);
    expect(el(sim, r).current).toBeCloseTo(0, 9);
  });

  it('short circuit gives a large finite current', () => {
    const bat = mk('battery', { voltage: 9, rint: 0.5 });
    const sim = simulate([bat], [wire(bat, '+', bat, '-')]);
    expect(sim.converged).toBe(true);
    expect(Math.abs(el(sim, bat).current)).toBeCloseTo(18, 3);
  });

  it('warns when there is no ground reference', () => {
    const r = mk('resistor');
    const sim = simulate([r], []);
    expect(sim.hasGround).toBe(false);
  });
});

describe('non-linear circuits', () => {
  it('LED with a series resistor settles near its forward voltage', () => {
    const bat = mk('battery', { voltage: 5, rint: 0.1 });
    const r = mk('resistor', { ohms: 220 });
    const led = mk('led', { vf: 2 });
    const sim = simulate([bat, r, led], [wire(bat, '+', r, 'A'), wire(r, 'B', led, 'A'), wire(led, 'K', bat, '-')]);
    expect(sim.converged).toBe(true);
    const vLed = el(sim, led).voltage;
    expect(vLed).toBeGreaterThan(1.8);
    expect(vLed).toBeLessThan(2.0);
    expect(el(sim, led).current).toBeCloseTo(el(sim, r).current, 6);
    expect(el(sim, r).current).toBeGreaterThan(0.012);
    expect(el(sim, r).current).toBeLessThan(0.016);
  });

  it('LED without a resistor draws a dangerously high current', () => {
    const bat = mk('battery', { voltage: 5, rint: 0.1 });
    const led = mk('led', { vf: 2 });
    const sim = simulate([bat, led], [wire(bat, '+', led, 'A'), wire(led, 'K', bat, '-')]);
    expect(sim.converged).toBe(true);
    expect(el(sim, led).current).toBeGreaterThan(1);
  });

  it('reverse-biased LED blocks current', () => {
    const bat = mk('battery', { voltage: 5, rint: 0.1 });
    const r = mk('resistor', { ohms: 220 });
    const led = mk('led');
    const sim = simulate([bat, r, led], [wire(bat, '+', r, 'A'), wire(r, 'B', led, 'K'), wire(led, 'A', bat, '-')]);
    expect(sim.converged).toBe(true);
    expect(Math.abs(el(sim, led).current)).toBeLessThan(1e-6);
  });

  it('silicon diode drops about 0.65 V', () => {
    const bat = mk('battery', { voltage: 5, rint: 0.1 });
    const r = mk('resistor', { ohms: 1000 });
    const d = mk('diode');
    const sim = simulate([bat, r, d], [wire(bat, '+', r, 'A'), wire(r, 'B', d, 'A'), wire(d, 'K', bat, '-')]);
    expect(el(sim, d).voltage).toBeGreaterThan(0.55);
    expect(el(sim, d).voltage).toBeLessThan(0.75);
  });

  it('Zener regulates reverse-biased near its rated voltage', () => {
    const bat = mk('battery', { voltage: 12, rint: 0.1 });
    const r = mk('resistor', { ohms: 470 });
    const z = mk('zener', { vz: 5.1 });
    const sim = simulate([bat, r, z], [wire(bat, '+', r, 'A'), wire(r, 'B', z, 'K'), wire(z, 'A', bat, '-')]);
    expect(sim.converged).toBe(true);
    const vz = -el(sim, z).voltage;
    expect(vz).toBeGreaterThan(5.1);
    expect(vz).toBeLessThan(5.4);
    expect(-el(sim, z).current).toBeGreaterThan(0.01);
  });

  it('satisfies KCL at the ground node', () => {
    const bat = mk('battery', { voltage: 9, rint: 0.5 });
    const r = mk('resistor', { ohms: 330 });
    const led = mk('led');
    const r2 = mk('resistor', { ohms: 1000 });
    const sim = simulate(
      [bat, r, led, r2],
      [
        wire(bat, '+', r, 'A'),
        wire(r, 'B', led, 'A'),
        wire(led, 'K', bat, '-'),
        wire(bat, '+', r2, 'A'),
        wire(r2, 'B', bat, '-'),
      ],
    );
    const supplied = -el(sim, bat).current;
    expect(supplied).toBeCloseTo(el(sim, r).current + el(sim, r2).current, 6);
  });
});
