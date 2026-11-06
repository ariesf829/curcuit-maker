import { describe, expect, it } from 'vitest';
import { defaultParams } from '../model/params';
import type { Part, Wire } from '../model/types';
import { checkWires, wireCurrents } from './wires';
import { simulate } from './simulate';

const part = (id: string, type: Part['type'], params: Record<string, number> = {}): Part => ({
  id,
  type,
  name: id,
  x: 0,
  y: 0,
  rot: 0,
  params: { ...defaultParams(type), ...params },
});
const wire = (id: string, from: [string, string], to: [string, string]): Wire => ({
  id,
  from: { partId: from[0], pin: from[1] },
  to: { partId: to[0], pin: to[1] },
});

const parts = [part('bat', 'battery', { voltage: 9, rint: 0.01 }), part('r', 'resistor', { ohms: 89.99 })];

describe('wireCurrents', () => {
  it('reports the loop current on each wire with the right direction', () => {
    const wires = [wire('w1', ['bat', '+'], ['r', 'A']), wire('w2', ['r', 'B'], ['bat', '-'])];
    const c = wireCurrents(parts, wires, simulate(parts, wires));
    expect(c.get('w1')!).toBeCloseTo(0.1, 3);
    expect(c.get('w2')!).toBeCloseTo(0.1, 3);
  });

  it('flips the sign when the wire is drawn the other way round', () => {
    const wires = [wire('w1', ['r', 'A'], ['bat', '+']), wire('w2', ['r', 'B'], ['bat', '-'])];
    const c = wireCurrents(parts, wires, simulate(parts, wires));
    expect(c.get('w1')!).toBeCloseTo(-0.1, 3);
    expect(c.get('w2')!).toBeCloseTo(0.1, 3);
  });

  it('splits current evenly between two parallel wires', () => {
    const wires = [
      wire('w1', ['bat', '+'], ['r', 'A']),
      wire('w1b', ['bat', '+'], ['r', 'A']),
      wire('w2', ['r', 'B'], ['bat', '-']),
    ];
    const c = wireCurrents(parts, wires, simulate(parts, wires));
    expect(c.get('w1')!).toBeCloseTo(0.05, 3);
    expect(c.get('w1b')!).toBeCloseTo(0.05, 3);
    expect(c.get('w2')!).toBeCloseTo(0.1, 3);
  });

  it('carries no current when the circuit is open', () => {
    const wires = [wire('w1', ['bat', '+'], ['r', 'A'])];
    const c = wireCurrents(parts, wires, simulate(parts, wires));
    expect(Math.abs(c.get('w1')!)).toBeLessThan(1e-6);
  });
});

describe('checkWires', () => {
  const wires = [wire('w1', ['bat', '+'], ['r', 'A']), wire('w2', ['r', 'B'], ['bat', '-'])];
  const currents = new Map([
    ['w1', 0.9],
    ['w2', -1.2],
  ]);

  it('warns near the limit and errors above it', () => {
    const issues = checkWires(wires, currents, 1000);
    expect(issues.map((i) => [i.wireIds, i.severity])).toEqual([
      [['w1'], 'warning'],
      [['w2'], 'error'],
    ]);
  });

  it('is quiet when the limit is generous', () => {
    expect(checkWires(wires, currents, 5000)).toEqual([]);
  });
});
