import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../examples';
import { findEscs, findMotorEsc } from './escBus';
import { pinVoltage, simulate } from './simulate';

const example = EXAMPLES.find((e) => e.id === 'brushless-esc')!;

describe('brushless ESC connections', () => {
  it('powers the ESP32 from its BEC and finds the connected motor phases', () => {
    const sim = simulate(example.parts, example.wires);
    expect(sim.poweredEscs.has('esc')).toBe(true);
    expect(pinVoltage(sim, 'esc', '+5V')).toBeCloseTo(5, 1);
    expect(pinVoltage(sim, 'esp', 'VIN')).toBeGreaterThan(4.3);
    expect(findEscs(example.parts, sim, 'esp', 'D18')).toEqual({ partIds: ['esc'] });
    expect(findMotorEsc(example.parts, sim, 'blm')?.id).toBe('esc');
  });

  it('does not power an ESC from an undersized battery', () => {
    const parts = example.parts.map((part) =>
      part.id === 'bat' ? { ...part, params: { ...part.params, voltage: 5 } } : part,
    );
    const sim = simulate(parts, example.wires);
    expect(sim.poweredEscs.has('esc')).toBe(false);
    expect(findEscs(parts, sim, 'esp', 'D18')).toMatchObject({ problem: expect.stringContaining('2S-6S') });
  });
});
