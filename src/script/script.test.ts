import { describe, expect, it } from 'vitest';
import type { PinMode } from '../model/boards';
import type { Part } from '../model/types';
import { ScriptError, parse } from './lang';
import { ScriptRuntime, type RuntimeIO } from './runtime';

const board: Part = { id: 'b', type: 'esp32-devkit-v1', name: 'ESP32', x: 0, y: 0, rot: 0 };

function run(src: string, ms: number, volts: (pin: string) => number = () => 0) {
  const out: string[] = [];
  const warnings: string[] = [];
  const history: Array<Record<string, PinMode>> = [];
  let duty: Record<string, number> = {};
  const io: RuntimeIO = {
    board: () => board,
    setPins: (_id, modes, d) => {
      history.push(modes);
      duty = d;
    },
    voltage: (_id, pin) => volts(pin),
    print: (t) => out.push(t),
    warn: (m) => warnings.push(m),
    lcdBus: () => ({ problem: 'no lcd in this test' }),
    lcdShow: () => {},
    servoBus: () => ({ problem: 'no servo in this test' }),
    servoShow: () => {},
  };
  const rt = new ScriptRuntime(parse(src), io, 'b');
  for (let t = 0; t < ms; t += 10) rt.tick(10);
  return { text: out.join(''), warnings, history, duty: () => duty, rt };
}

const printed = (src: string) => run(src, 20).text;

describe('parser errors', () => {
  it('reports a missing semicolon on the line where it was needed', () => {
    try {
      parse('void setup() {\n  int a = 1\n}\nvoid loop() {}');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ScriptError);
      expect((e as ScriptError).line).toBe(2);
    }
  });

  it('reports an unclosed brace', () => {
    expect(() => parse('void loop() {\n delay(1);\n')).toThrow(/never closed/);
  });

  it('rejects pointers and function-like macros', () => {
    expect(() => parse('int *p;')).toThrow(/Pointers/);
    expect(() => parse('#define SQ(x) x*x\nvoid loop(){}')).toThrow(/Macros/);
  });
});

describe('language', () => {
  const p = (body: string) => printed(`void setup(){ ${body} } void loop(){ delay(1000); }`);

  it('uses integer division for ints and real division for floats', () => {
    expect(p('Serial.print(7 / 2); Serial.print(" "); Serial.print(7 / 2.0); Serial.print(" "); float x = 6.0; Serial.print(x / 4);')).toBe('3 3.50 1.50');
  });

  it('wraps integer types like C', () => {
    expect(p('byte b = 250; b += 10; Serial.print(b); Serial.print(" "); int i = 2147483647; i++; Serial.print(i);')).toBe('4 -2147483648');
  });

  it('supports loops, arrays, functions, switch and #define', () => {
    const src = `
      #define N 4
      int sq(int v) { return v * v; }
      int data[N] = {1, 2, 3, 4};
      void setup() {
        int sum = 0;
        for (int i = 0; i < N; i++) sum += sq(data[i]);
        Serial.print(sum);
        switch (sum) { case 1: Serial.print("a"); break; case 30: Serial.print("b"); default: Serial.print("c"); }
        int k = 0; while (true) { if (++k >= 3) break; }
        Serial.print(k);
      }
      void loop() { delay(1000); }`;
    expect(printed(src)).toBe('30bc3');
  });

  it('formats printf and number bases', () => {
    expect(p('Serial.printf("%d-%05.1f-%s-%x", 7, 3.14159, "hi", 255); Serial.print(" "); Serial.print(255, HEX); Serial.print(" "); Serial.println(3.14159, 3);')).toBe('7-003.1-hi-ff FF 3.142\n');
  });

  it('maps and constrains', () => {
    expect(p('Serial.print(map(2048, 0, 4095, 0, 100)); Serial.print(" "); Serial.print(constrain(15, 0, 10));')).toBe('50 10');
  });

  it('reports runtime errors with a line number', () => {
    const r = run('void setup() {\n int z = 0;\n int a = 5 / z;\n}\nvoid loop() {}', 20);
    expect(r.rt.error?.message).toMatch(/Division by zero/);
    expect(r.rt.error?.line).toBe(3);
  });

  it('names unknown functions and variables', () => {
    expect(run('void setup(){ foo(); } void loop(){}', 10).rt.error?.message).toMatch(/Unknown function 'foo'/);
    expect(run('void setup(){ x = 1; } void loop(){}', 10).rt.error?.message).toMatch(/'x' was not declared/);
  });

  it('stops runaway recursion', () => {
    expect(run('void f(){ f(); } void setup(){ f(); } void loop(){}', 10).rt.error?.message).toMatch(/nested/);
  });
});

describe('pins and time', () => {
  const blink = `
    const int LED = 4;
    void setup() { pinMode(LED, OUTPUT); }
    void loop() { digitalWrite(LED, HIGH); delay(500); digitalWrite(LED, LOW); delay(500); }`;

  it('leaves every pin as an input until the script configures it', () => {
    const r = run('void setup(){} void loop(){ delay(10); }', 100);
    expect(r.history).toEqual([]);
  });

  it('blinks on the virtual clock', () => {
    const r = run(blink, 2100);
    const levels = r.history.map((m) => m.D4);
    expect(levels.slice(0, 5)).toEqual(['high', 'low', 'high', 'low', 'high']);
  });

  it('ignores digitalWrite before pinMode and says why', () => {
    const r = run('void setup(){ digitalWrite(4, HIGH); } void loop(){ delay(10); }', 50);
    expect(r.history).toEqual([]);
    expect(r.warnings[0]).toMatch(/pinMode\(4, OUTPUT\)/);
  });

  it('reads pin voltages from the circuit', () => {
    const src = `
      void setup() { pinMode(5, INPUT_PULLUP); pinMode(6, INPUT); }
      void loop() { Serial.print(digitalRead(5)); Serial.print(digitalRead(18)); Serial.print(analogRead(34)); delay(1000); }`;
    const r = run(src, 30, (pin) => (pin === 'D5' ? 3.3 : pin === 'D34' ? 1.65 : 0));
    expect(r.text.startsWith('102048')).toBe(true);
    expect(r.history.at(-1)).toMatchObject({ D5: 'pullup', D34: 'adc' });
  });

  it('records PWM duty', () => {
    const r = run('void setup(){ pinMode(4, OUTPUT); analogWrite(4, 128); } void loop(){ delay(10); }', 30);
    expect(r.history.at(-1)?.D4).toBe('high');
    expect(r.duty().D4).toBeCloseTo(0.5, 2);
  });

  it('does not hang on a loop without delay and keeps millis() moving', () => {
    const r = run('unsigned long t = 0; void setup(){} void loop(){ t = millis(); if (t > 200) { Serial.print("done"); while (true) { delay(1000); } } }', 500);
    expect(r.rt.error).toBeUndefined();
    expect(r.text).toBe('done');
  });

  it('warns about a missing GPIO', () => {
    const r = run('void setup(){ pinMode(99, OUTPUT); } void loop(){ delay(10); }', 20);
    expect(r.warnings[0]).toMatch(/GPIO99 does not exist/);
  });
});
