import { describe, expect, it } from 'vitest';
import { buildNets } from './connectivity';
import { PART_LIST } from './parts';
import type { Part, Wire } from './types';

const bb: Part = { id: 'bb', type: 'breadboard', name: 'BB1', x: 100, y: 100, rot: 0 };
const part = (id: string, type: Part['type'], x: number, y: number, rot: Part['rot'] = 0): Part => ({
  id,
  type,
  name: id,
  x,
  y,
  rot,
});

const sameNet = (n: ReturnType<typeof buildNets>, a: string, b: string) =>
  n.netOf.get(a) !== undefined && n.netOf.get(a) === n.netOf.get(b);

describe('part definitions', () => {
  it('has unique pin names on every part', () => {
    for (const def of PART_LIST) {
      const names = def.pins.map((q) => q.name);
      expect(new Set(names).size, def.type).toBe(names.length);
    }
  });

  it('provides the usual ESC battery, motor, and receiver connections', () => {
    expect(PART_LIST.find((def) => def.type === 'esc')?.pins.map((pin) => pin.name)).toEqual([
      'BAT+',
      'BAT-',
      'M1',
      'M2',
      'M3',
      '+5V',
      'SIG',
      'GND',
    ]);
  });
});

describe('buildNets', () => {
  it('joins pins plugged into the same breadboard column half', () => {
    // resistor A at hole a1 (col 1), LED A at hole c1 (same column, same half)
    const r = part('r', 'resistor', 100, 100);
    const led = part('led', 'led', 100, 140);
    const n = buildNets([bb, r, led], []);
    expect(sameNet(n, 'r:A', 'led:A')).toBe(true);
    expect(sameNet(n, 'r:A', 'r:B')).toBe(false);
    expect(sameNet(n, 'r:A', 'led:K')).toBe(false);
  });

  it('keeps the two halves of a column separate across the center gap', () => {
    const r = part('r', 'resistor', 100, 100); // row a
    const led = part('led', 'led', 100, 220); // row f
    const n = buildNets([bb, r, led], []);
    expect(sameNet(n, 'r:A', 'led:A')).toBe(false);
  });

  it('joins a whole power rail', () => {
    const bat = part('bat', 'battery', 100, 40); // T+ rail (y=40), col 1 and col 3
    const usb = part('usb', 'usb5v', 500, 40); // T+ rail, col 21
    const gnd = part('gnd', 'usb5v', 300, 60); // T- rail
    const n = buildNets([bb, bat, usb, gnd], []);
    expect(sameNet(n, 'bat:+', 'usb:5V')).toBe(true);
    expect(sameNet(n, 'bat:+', 'gnd:5V')).toBe(false);
  });

  it('keeps new motion sensor and solenoid terminals separate when added on a breadboard row', () => {
    const board = part('test-bb', 'breadboard', 160, 160);
    const pir = part('pir', 'motion-sensor', 280, 200);
    const solenoid = part('sol', 'solenoid-lock', 400, 200);
    const nets = buildNets([board, pir, solenoid], []);
    expect(sameNet(nets, 'pir:VCC', 'pir:OUT')).toBe(false);
    expect(sameNet(nets, 'pir:OUT', 'pir:GND')).toBe(false);
    expect(sameNet(nets, 'sol:COIL+', 'sol:COIL-')).toBe(false);
  });

  it('joins pins through wires', () => {
    const r = part('r', 'resistor', 0, 0);
    const bat = part('bat', 'battery', 0, 200);
    const wire: Wire = { id: 'w', from: { partId: 'r', pin: 'A' }, to: { partId: 'bat', pin: '+' } };
    const n = buildNets([r, bat], [wire]);
    expect(sameNet(n, 'r:A', 'bat:+')).toBe(true);
    expect(sameNet(n, 'r:B', 'bat:+')).toBe(false);
  });

  it('joins duplicate GND pins on a dev board', () => {
    const esp = part('esp', 'esp32-c3', 0, 0);
    const n = buildNets([esp], []);
    expect(sameNet(n, 'esp:GND', 'esp:GND8')).toBe(true);
    expect(sameNet(n, 'esp:GND', 'esp:3V3')).toBe(false);
    expect(sameNet(n, 'esp:3V3', 'esp:3V3b')).toBe(true);
  });

  it('respects rotation when matching holes', () => {
    // rotated 90deg: pin B ends up directly below pin A (same column, rows a and d)
    const r = part('r', 'resistor', 100, 100, 1);
    const n = buildNets([bb, r], []);
    expect(sameNet(n, 'r:A', 'r:B')).toBe(true);
  });
});
