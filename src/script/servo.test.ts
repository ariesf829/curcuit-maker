import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../examples';
import { findServos } from '../sim/servoBus';
import { solveCircuit } from '../sim/solved';
import { parse } from './lang';
import { ScriptRuntime, type RuntimeIO } from './runtime';

const ex = EXAMPLES.find((e) => e.id === 'servo')!;

function setup(wires = ex.wires, source = ex.source, ms = 1000) {
  const warnings: string[] = [];
  const angles: Record<string, number | null> = {};
  const io: RuntimeIO = {
    board: (id) => ex.parts.find((p) => p.id === id),
    setPins: () => {},
    voltage: () => 0,
    print: () => {},
    warn: (m) => warnings.push(m),
    lcdBus: () => ({ problem: 'none' }),
    lcdShow: () => {},
    servoBus: (id, pin) => findServos(ex.parts, solveCircuit(ex.parts, wires).sim, id, pin),
    servoShow: (id, a) => {
      angles[id] = a;
    },
    escBus: () => ({ partIds: [] }),
    escShow: () => {},
  };
  const rt = new ScriptRuntime(parse(source), io, 'esp');
  for (let t = 0; t < ms; t += 10) rt.tick(10);
  return { rt, warnings, angles };
}

describe('Servo', () => {
  it('follows write() angles in the example', () => {
    const { rt, warnings, angles } = setup();
    expect(rt.error).toBeUndefined();
    expect(warnings).toEqual([]);
    expect(angles.srv1).toBeGreaterThan(0);
  });

  it('maps write() and writeMicroseconds() to angles', () => {
    const src = 'Servo s;\nvoid setup(){ s.attach(18); s.write(90); }\nvoid loop(){}';
    expect(setup(undefined, src).angles.srv1).toBe(90);
    const us = 'Servo s;\nvoid setup(){ s.attach(18, 1000, 2000); s.writeMicroseconds(1500); }\nvoid loop(){}';
    expect(setup(undefined, us).angles.srv1).toBe(90);
  });

  it('reads back the angle', () => {
    const src = 'Servo s;\nint a;\nvoid setup(){ s.attach(18); s.write(45); a = s.read(); Serial.println(a); }\nvoid loop(){}';
    expect(setup(undefined, src).rt.error).toBeUndefined();
  });

  it('does not move when SIG is unplugged', () => {
    const { angles, warnings } = setup(ex.wires.filter((w) => w.to.pin !== 'SIG'));
    expect(angles.srv1).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/SIG is not connected/);
  });

  it('does not move without power', () => {
    const { angles, warnings } = setup(ex.wires.filter((w) => w.to.pin !== 'V+' && w.to.pin !== '+'));
    expect(angles.srv1).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/not powered/);
  });
});
