import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../examples';
import { findEscs } from '../sim/escBus';
import { solveCircuit } from '../sim/solved';
import { findServos } from '../sim/servoBus';
import { parse } from './lang';
import { ScriptRuntime, type RuntimeIO } from './runtime';

const example = EXAMPLES.find((e) => e.id === 'brushless-esc')!;

describe('ESC throttle', () => {
  it('requires low throttle for one second before arming and then follows Servo.write()', () => {
    const warnings: string[] = [];
    const states: Array<{ throttle: number | null; armed?: boolean }> = [];
    const io: RuntimeIO = {
      board: (id) => example.parts.find((part) => part.id === id),
      setPins: () => {},
      voltage: () => 0,
      print: () => {},
      warn: (message) => warnings.push(message),
      lcdBus: () => ({ problem: 'no LCD in this test' }),
      lcdShow: () => {},
      servoBus: (id, pin) => findServos(example.parts, solveCircuit(example.parts, example.wires).sim, id, pin),
      servoShow: () => {},
      escBus: (id, pin) => findEscs(example.parts, solveCircuit(example.parts, example.wires).sim, id, pin),
      escShow: (_id, throttle, armed) => states.push({ throttle, armed }),
    };
    const runtime = new ScriptRuntime(
      parse('Servo esc; void setup(){ esc.attach(18); esc.write(0); } void loop(){ delay(1100); esc.write(90); delay(1000); }'),
      io,
      'esp',
    );

    for (let t = 0; t < 1100; t += 10) runtime.tick(10);
    expect(states.some((s) => s.armed && s.throttle === 0)).toBe(true);
    for (let t = 0; t < 200; t += 10) runtime.tick(10);
    expect(states.some((s) => s.armed && s.throttle === 0.5)).toBe(true);
    expect(warnings).toEqual([]);
    expect(runtime.error).toBeUndefined();
  });

  it('does not arm if throttle never goes low', () => {
    const states: Array<{ throttle: number | null; armed?: boolean }> = [];
    const io: RuntimeIO = {
      board: (id) => example.parts.find((part) => part.id === id),
      setPins: () => {},
      voltage: () => 0,
      print: () => {},
      warn: () => {},
      lcdBus: () => ({ problem: 'no LCD in this test' }),
      lcdShow: () => {},
      servoBus: (id, pin) => findServos(example.parts, solveCircuit(example.parts, example.wires).sim, id, pin),
      servoShow: () => {},
      escBus: (id, pin) => findEscs(example.parts, solveCircuit(example.parts, example.wires).sim, id, pin),
      escShow: (_id, throttle, armed) => states.push({ throttle, armed }),
    };
    const runtime = new ScriptRuntime(parse('Servo esc; void setup(){ esc.attach(18); esc.write(90); } void loop(){ delay(1500); }'), io, 'esp');
    for (let t = 0; t < 1300; t += 10) runtime.tick(10);
    expect(states.some((s) => s.armed)).toBe(false);
  });
});
