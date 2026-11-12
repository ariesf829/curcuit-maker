import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../examples';
import { solveCircuit } from '../sim/solved';
import { findLcd } from '../sim/i2cBus';
import { parse } from './lang';
import type { LcdView } from './lcd';
import { ScriptRuntime, type RuntimeIO } from './runtime';

const lcdExample = EXAMPLES.find((e) => e.id === 'lcd')!;

function setup(mutate?: (e: typeof lcdExample) => { parts: typeof lcdExample.parts; wires: typeof lcdExample.wires }, source = lcdExample.source) {
  const { parts, wires } = mutate ? mutate(lcdExample) : lcdExample;
  const warnings: string[] = [];
  const shown: Record<string, LcdView | null> = {};
  const io: RuntimeIO = {
    board: (id) => parts.find((p) => p.id === id),
    setPins: () => {},
    voltage: () => 0,
    print: () => {},
    warn: (m) => warnings.push(m),
    lcdBus: (id, address, sda, scl) => findLcd(parts, solveCircuit(parts, wires).sim, id, address, sda, scl),
    lcdShow: (id, view) => {
      shown[id] = view;
    },
    servoBus: () => ({ problem: 'no servo' }),
    servoShow: () => {},
    escBus: () => ({ partIds: [] }),
    escShow: () => {},
  };
  const rt = new ScriptRuntime(parse(source), io, 'esp');
  for (let t = 0; t < 1200; t += 10) rt.tick(10);
  return { rt, warnings, shown };
}

describe('I2C LCD', () => {
  it('shows what the example sketch prints', () => {
    const { rt, warnings, shown } = setup();
    expect(rt.error).toBeUndefined();
    expect(warnings).toEqual([]);
    const v = shown.lcd1!;
    expect(v.lines[0].trim()).toBe('Hello, ESP32!');
    expect(v.lines[1]).toMatch(/^Count: [123]\s*$/);
    expect(v.backlight).toBe(true);
  });

  it('prints floats with the requested digits', () => {
    const src = 'LiquidCrystal_I2C lcd(0x27, 16, 2);\nvoid setup(){ lcd.init(); lcd.print(3.14159, 2); lcd.setCursor(0,1); lcd.print(255, HEX); }\nvoid loop(){}';
    const { shown } = setup(undefined, src);
    expect(shown.lcd1!.lines[0].trim()).toBe('3.14');
    expect(shown.lcd1!.lines[1].trim()).toBe('FF');
  });

  it('does not find the display when SDA is unplugged', () => {
    const { warnings, shown } = setup((e) => ({ parts: e.parts, wires: e.wires.filter((w) => !(w.from.pin === 'D21')) }));
    expect(shown.lcd1).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/SDA is not connected/);
  });

  it('notices swapped SDA and SCL', () => {
    const { warnings } = setup((e) => ({
      parts: e.parts,
      wires: e.wires.map((w) => (w.from.pin === 'D21' ? { ...w, from: { ...w.from, pin: 'D22' } } : w.from.pin === 'D22' ? { ...w, from: { ...w.from, pin: 'D21' } } : w)),
    }));
    expect(warnings.join(' ')).toMatch(/swapped/);
  });

  it('needs power', () => {
    const { warnings } = setup((e) => ({ parts: e.parts, wires: e.wires.filter((w) => w.to.pin !== 'VCC') }));
    expect(warnings.join(' ')).toMatch(/not powered/);
  });

  it('reports a wrong address', () => {
    const { warnings } = setup(undefined, lcdExample.source.replace('0x27', '0x3F'));
    expect(warnings.join(' ')).toMatch(/0x3F not found.*0x27/);
  });

  it('honours the display state calls', () => {
    const src = 'LiquidCrystal_I2C lcd(0x27, 16, 2);\nvoid setup(){ lcd.init(); lcd.backlight(); lcd.print("Hi"); lcd.noBacklight(); lcd.clear(); lcd.setCursor(2,1); lcd.print("ok"); }\nvoid loop(){}';
    const v = setup(undefined, src).shown.lcd1!;
    expect(v.backlight).toBe(false);
    expect(v.lines[0].trim()).toBe('');
    expect(v.lines[1]).toBe('  ok            ');
  });
});
