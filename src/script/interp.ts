import { ScriptError, type Expr, type Func, type Program, type Stmt, type TypeSpec, type Wrap } from './lang';

export type Value = number | string | Value[];
export type Yield = { k: 'delay'; us: number } | { k: 'budget' };
type Gen<T> = Generator<Yield, T, undefined>;

/** What the program can do to the outside world. */
export interface Host {
  nowUs(): number;
  pinMode(pin: number, mode: number): void;
  digitalWrite(pin: number, value: number): void;
  digitalRead(pin: number): number;
  /** 12-bit reading (0..4095). */
  analogRead(pin: number): number;
  /** PWM duty from 0 to 1. */
  analogWrite(pin: number, duty: number): void;
  print(text: string): void;
  /** Wire.begin(); pins are undefined when the default I2C pins are used. */
  wireBegin(sda?: number, scl?: number): void;
  lcdCreate(name: string, address: number, cols: number, rows: number): void;
  lcdCall(name: string, method: string, args: Array<number | string>): void;
  /** Servo output: horn angle (0-180) commanded on a GPIO, or null when detached. */
  servoPulse(gpio: number | null, key: string, angle: number | null): void;
}

const SERVO_DEFAULT_MIN_US = 544;
const SERVO_DEFAULT_MAX_US = 2400;
const SERVO_METHODS = new Set(['attach', 'detach', 'write', 'writeMicroseconds', 'read', 'attached']);

interface ServoState {
  gpio: number | null;
  minUs: number;
  maxUs: number;
  us: number | null;
}

const LCD_METHODS = new Set([
  'init', 'begin', 'backlight', 'noBacklight', 'clear', 'home', 'setCursor', 'print', 'println', 'write', 'display', 'noDisplay',
  'cursor', 'noCursor', 'blink', 'noBlink', 'createChar', 'scrollDisplayLeft', 'scrollDisplayRight', 'setBacklight',
]);

const BUDGET = 4000;
const MAX_DEPTH = 150;

const CONSTANTS: Record<string, number> = {
  HIGH: 1, LOW: 0, INPUT: 1, OUTPUT: 3, INPUT_PULLUP: 5, INPUT_PULLDOWN: 9,
  true: 1, false: 0, PI: Math.PI, HEX: 16, DEC: 10, BIN: 2, OCT: 8,
};
const ARITH = new Set(['+', '-', '*', '/', '%']);
const FLOAT_FUNCS = new Set([
  'sqrt', 'pow', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'log', 'log10', 'exp', 'floor', 'ceil', 'radians', 'degrees', 'fabs',
]);
const PASS_FUNCS = new Set(['abs', 'min', 'max', 'constrain', 'sq']);

interface Var {
  type: TypeSpec;
  value: Value;
  isArray: boolean;
}

class Env {
  vars = new Map<string, Var>();
  readonly parent?: Env;
  constructor(parent?: Env) {
    this.parent = parent;
  }
  lookup(name: string): Var | undefined {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    for (let e: Env | undefined = this; e; e = e.parent) {
      const v = e.vars.get(name);
      if (v) return v;
    }
    return undefined;
  }
}

type Flow = undefined | { k: 'break' | 'continue' } | { k: 'ret'; v?: Value };

function wrapInt(wrap: Wrap, n: number): number {
  if (!Number.isFinite(n)) return 0;
  n = Math.trunc(n);
  switch (wrap) {
    case 'i8': return (n << 24) >> 24;
    case 'u8': return n & 255;
    case 'i16': return (n << 16) >> 16;
    case 'u16': return n & 65535;
    case 'i32': return n | 0;
    case 'u32': return n >>> 0;
    default: return n;
  }
}

function coerce(t: TypeSpec, v: Value, line: number): Value {
  if (Array.isArray(v)) throw new ScriptError('An array cannot be used as a single value here.', line);
  switch (t.kind) {
    case 'string':
      return String(v);
    case 'void':
      return v;
    default:
      if (typeof v === 'string') throw new ScriptError('Text cannot be used as a number.', line);
      if (t.kind === 'float') return v;
      if (t.kind === 'bool') return v ? 1 : 0;
      return wrapInt(t.wrap, v);
  }
}

const defaultOf = (t: TypeSpec): Value => (t.kind === 'string' ? '' : 0);
const truthy = (v: Value) => (typeof v === 'string' ? v.length > 0 : Array.isArray(v) ? true : v !== 0);

function formatValue(v: Value, float: boolean): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return '[array]';
  if (!float) return String(v);
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  return v.toFixed(2);
}

function printf(fmt: string, args: Value[], line: number): string {
  let i = 0;
  return fmt.replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?(?:hh|h|ll|l|z)?([diufFeEgGsxXcp%])/g, (_m, flags: string, width: string, prec: string, conv: string) => {
    if (conv === '%') return '%';
    if (i >= args.length) throw new ScriptError('printf has more % placeholders than values.', line);
    const a = args[i++];
    const n = typeof a === 'number' ? a : Number.NaN;
    let s: string;
    switch (conv) {
      case 'd': case 'i': s = String(Math.trunc(n)); break;
      case 'u': s = String(Math.trunc(n) >>> 0); break;
      case 'f': case 'F': s = n.toFixed(prec === undefined ? 6 : Number(prec)); break;
      case 'e': case 'E': s = n.toExponential(prec === undefined ? 6 : Number(prec)); break;
      case 'g': case 'G': s = String(n); break;
      case 'x': s = (Math.trunc(n) >>> 0).toString(16); break;
      case 'X': s = (Math.trunc(n) >>> 0).toString(16).toUpperCase(); break;
      case 'c': s = String.fromCharCode(n); break;
      default: s = String(a);
    }
    if (flags.includes('+') && n >= 0 && 'dif'.includes(conv)) s = `+${s}`;
    const w = width ? Number(width) : 0;
    if (s.length < w) s = flags.includes('-') ? s.padEnd(w) : flags.includes('0') && conv !== 's' ? s.padStart(w, '0') : s.padStart(w);
    return s;
  });
}

export class Interp {
  private globals = new Env();
  private steps = 0;
  private depth = 0;
  private ledcBits = new Map<number, number>();
  private lcds = new Set<string>();
  private servos = new Map<string, ServoState>();

  private prog: Program;
  private host: Host;

  constructor(prog: Program, host: Host) {
    this.prog = prog;
    this.host = host;
  }

  *run(): Gen<void> {
    for (const g of this.prog.globals) yield* this.exec(g, this.globals);
    const setup = this.prog.funcs.get('setup');
    const loop = this.prog.funcs.get('loop');
    if (!loop) throw new ScriptError('Your program needs a void loop() function.', 1);
    if (setup) yield* this.callUser(setup, [], setup.line);
    for (;;) {
      yield* this.callUser(loop, [], loop.line);
      if (++this.steps >= BUDGET) {
        this.steps = 0;
        yield { k: 'budget' };
      }
    }
  }

  // ------------------------------------------------------------ statements

  private *execList(list: Stmt[], env: Env): Gen<Flow> {
    for (const s of list) {
      const flow = yield* this.exec(s, env);
      if (flow) return flow;
    }
    return undefined;
  }

  private *exec(s: Stmt, env: Env): Gen<Flow> {
    if (++this.steps >= BUDGET) {
      this.steps = 0;
      yield { k: 'budget' };
    }
    switch (s.k) {
      case 'block':
        return yield* this.execList(s.body, new Env(env));
      case 'device': {
        if (s.cls === 'Servo') {
          this.servos.set(s.name, { gpio: null, minUs: SERVO_DEFAULT_MIN_US, maxUs: SERVO_DEFAULT_MAX_US, us: null });
          return undefined;
        }
        const a: number[] = [];
        for (const x of s.args) a.push(this.num(yield* this.ev(x, env), s.line));
        if (a.length !== 3) throw new ScriptError(`${s.cls} ${s.name}(address, columns, rows) needs 3 values, like LiquidCrystal_I2C lcd(0x27, 16, 2);`, s.line);
        this.lcds.add(s.name);
        this.host.lcdCreate(s.name, Math.trunc(a[0]), Math.trunc(a[1]), Math.trunc(a[2]));
        return undefined;
      }
      case 'decl': {
        for (const v of s.vars) {
          if (v.isArray) {
            if (v.init && !Array.isArray(v.init)) throw new ScriptError(`Fill array '${v.name}' with { }.`, v.line);
            const list = (v.init as Expr[] | undefined) ?? [];
            const size = v.size ? this.toInt(yield* this.ev(v.size, env), v.line) : list.length;
            if (size < 0 || size > 100000) throw new ScriptError(`Array '${v.name}' has an unreasonable size.`, v.line);
            if (list.length > size) throw new ScriptError(`Array '${v.name}' has more values than its size.`, v.line);
            const arr: Value[] = new Array<Value>(size).fill(defaultOf(s.type));
            for (const [i, item] of list.entries()) arr[i] = coerce(s.type, yield* this.ev(item, env), v.line);
            env.vars.set(v.name, { type: s.type, value: arr, isArray: true });
          } else {
            const value = v.init ? coerce(s.type, yield* this.ev(v.init as Expr, env), v.line) : defaultOf(s.type);
            env.vars.set(v.name, { type: s.type, value, isArray: false });
          }
        }
        return undefined;
      }
      case 'expr':
        yield* this.ev(s.e, env);
        return undefined;
      case 'if':
        if (truthy(yield* this.ev(s.c, env))) return yield* this.exec(s.a, env);
        return s.b ? yield* this.exec(s.b, env) : undefined;
      case 'while':
        while (truthy(yield* this.ev(s.c, env))) {
          const flow = yield* this.exec(s.body, env);
          if (flow?.k === 'break') break;
          if (flow?.k === 'ret') return flow;
        }
        return undefined;
      case 'do':
        do {
          const flow = yield* this.exec(s.body, env);
          if (flow?.k === 'break') break;
          if (flow?.k === 'ret') return flow;
        } while (truthy(yield* this.ev(s.c, env)));
        return undefined;
      case 'for': {
        const inner = new Env(env);
        if (s.init) yield* this.exec(s.init, inner);
        while (!s.c || truthy(yield* this.ev(s.c, inner))) {
          const flow = yield* this.exec(s.body, inner);
          if (flow?.k === 'break') break;
          if (flow?.k === 'ret') return flow;
          if (s.step) yield* this.ev(s.step, inner);
        }
        return undefined;
      }
      case 'switch': {
        const subject = yield* this.ev(s.e, env);
        let start = -1;
        for (const [i, c] of s.cases.entries()) {
          if (c.test && (yield* this.ev(c.test, env)) === subject) {
            start = i;
            break;
          }
        }
        if (start < 0) start = s.cases.findIndex((c) => !c.test);
        if (start < 0) return undefined;
        const inner = new Env(env);
        for (const c of s.cases.slice(start)) {
          const flow = yield* this.execList(c.body, inner);
          if (flow?.k === 'break') return undefined;
          if (flow) return flow;
        }
        return undefined;
      }
      case 'ret':
        return { k: 'ret', v: s.e ? yield* this.ev(s.e, env) : undefined };
      case 'break':
        return { k: 'break' };
      case 'continue':
        return { k: 'continue' };
    }
  }

  // ------------------------------------------------------------ expressions

  private toInt(v: Value, line: number): number {
    if (typeof v !== 'number') throw new ScriptError('A number is needed here.', line);
    return Math.trunc(v);
  }

  private num(v: Value, line: number): number {
    if (typeof v !== 'number') throw new ScriptError('A number is needed here.', line);
    return v;
  }

  private varOf(e: Expr, env: Env): Var {
    if (e.k !== 'id') throw new ScriptError('A variable name is needed here.', e.line);
    const v = env.lookup(e.name);
    if (!v) throw new ScriptError(`'${e.name}' was not declared. Check the spelling.`, e.line);
    return v;
  }

  private isFloat(e: Expr, env: Env): boolean {
    switch (e.k) {
      case 'num': return e.float;
      case 'id': {
        const v = env.lookup(e.name);
        return v ? v.type.kind === 'float' && !v.isArray : e.name === 'PI';
      }
      case 'un': return e.op !== '!' && this.isFloat(e.e, env);
      case 'bin': return ARITH.has(e.op) && (this.isFloat(e.l, env) || this.isFloat(e.r, env));
      case 'assign': case 'incdec': return this.isFloat(e.target, env);
      case 'cond': return this.isFloat(e.a, env) || this.isFloat(e.b, env);
      case 'cast': return e.type.kind === 'float';
      case 'index': {
        const v = e.arr.k === 'id' ? env.lookup(e.arr.name) : undefined;
        return !!v && v.type.kind === 'float';
      }
      case 'call': {
        const fn = this.prog.funcs.get(e.name);
        if (fn) return fn.ret.kind === 'float';
        if (FLOAT_FUNCS.has(e.name)) return true;
        return PASS_FUNCS.has(e.name) && e.args.some((a) => this.isFloat(a, env));
      }
      default: return false;
    }
  }

  private arith(op: string, l: Value, r: Value, floatDiv: boolean, line: number): Value {
    if (typeof l === 'string' || typeof r === 'string') {
      const text = (x: Value) => (typeof x === 'string' ? x : String(x));
      if (op === '+') return text(l) + text(r);
      if (op === '==') return l === r ? 1 : 0;
      if (op === '!=') return l !== r ? 1 : 0;
      throw new ScriptError(`Operator '${op}' cannot be used with text.`, line);
    }
    const a = this.num(l, line);
    const b = this.num(r, line);
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (floatDiv) return a / b;
        if (b === 0) throw new ScriptError('Division by zero.', line);
        return Math.trunc(a / b);
      case '%':
        if (b === 0) throw new ScriptError('Division by zero.', line);
        return a % b;
      case '==': return a === b ? 1 : 0;
      case '!=': return a !== b ? 1 : 0;
      case '<': return a < b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
      case '&': return a & b;
      case '|': return a | b;
      case '^': return a ^ b;
      case '<<': return a << b;
      case '>>': return a >> b;
      default: throw new ScriptError(`Unknown operator '${op}'.`, line);
    }
  }

  private *arrayRef(e: Extract<Expr, { k: 'index' }>, env: Env): Gen<{ arr: Value[]; i: number; type: TypeSpec }> {
    const v = this.varOf(e.arr, env);
    if (!v.isArray) throw new ScriptError(`'${(e.arr as { name: string }).name}' is not an array.`, e.line);
    const i = this.toInt(yield* this.ev(e.idx, env), e.line);
    const arr = v.value as Value[];
    if (i < 0 || i >= arr.length) throw new ScriptError(`Index ${i} is outside the array (size ${arr.length}).`, e.line);
    return { arr, i, type: v.type };
  }

  private *ev(e: Expr, env: Env): Gen<Value> {
    switch (e.k) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 'id': {
        const v = env.lookup(e.name);
        if (v) return v.value;
        if (e.name in CONSTANTS) return CONSTANTS[e.name];
        throw new ScriptError(`'${e.name}' was not declared. Check the spelling.`, e.line);
      }
      case 'un': {
        const v = yield* this.ev(e.e, env);
        if (e.op === '!') return truthy(v) ? 0 : 1;
        const n = this.num(v, e.line);
        return e.op === '-' ? -n : e.op === '~' ? ~n : n;
      }
      case 'bin': {
        if (e.op === '&&') return truthy(yield* this.ev(e.l, env)) && truthy(yield* this.ev(e.r, env)) ? 1 : 0;
        if (e.op === '||') return truthy(yield* this.ev(e.l, env)) || truthy(yield* this.ev(e.r, env)) ? 1 : 0;
        const l = yield* this.ev(e.l, env);
        const r = yield* this.ev(e.r, env);
        return this.arith(e.op, l, r, e.op === '/' && (this.isFloat(e.l, env) || this.isFloat(e.r, env)), e.line);
      }
      case 'cond':
        return truthy(yield* this.ev(e.c, env)) ? yield* this.ev(e.a, env) : yield* this.ev(e.b, env);
      case 'cast':
        return coerce(e.type, yield* this.ev(e.e, env), e.line);
      case 'index': {
        const { arr, i } = yield* this.arrayRef(e, env);
        return arr[i];
      }
      case 'assign': {
        const rhs = yield* this.ev(e.value, env);
        const compound = (cur: Value, float: boolean) =>
          e.op === '=' ? rhs : this.arith(e.op.slice(0, -1), cur, rhs, float || this.isFloat(e.value, env), e.line);
        if (e.target.k === 'index') {
          const { arr, i, type } = yield* this.arrayRef(e.target, env);
          arr[i] = coerce(type, compound(arr[i], type.kind === 'float'), e.line);
          return arr[i];
        }
        const v = this.varOf(e.target, env);
        if (v.isArray) throw new ScriptError('An array cannot be assigned as a whole; set its items one by one.', e.line);
        v.value = coerce(v.type, compound(v.value, v.type.kind === 'float'), e.line);
        return v.value;
      }
      case 'incdec': {
        const d = e.op === '++' ? 1 : -1;
        if (e.target.k === 'index') {
          const { arr, i, type } = yield* this.arrayRef(e.target, env);
          const old = this.num(arr[i], e.line);
          arr[i] = coerce(type, old + d, e.line);
          return e.prefix ? arr[i] : old;
        }
        const v = this.varOf(e.target, env);
        const old = this.num(v.value, e.line);
        v.value = coerce(v.type, old + d, e.line);
        return e.prefix ? v.value : old;
      }
      case 'call': {
        const args: Value[] = [];
        for (const a of e.args) args.push(yield* this.ev(a, env));
        const fn = this.prog.funcs.get(e.name);
        if (fn) return yield* this.callUser(fn, args, e.line);
        return yield* this.builtin(e, args, env);
      }
    }
  }

  private *callUser(fn: Func, args: Value[], line: number): Gen<Value> {
    if (args.length !== fn.params.length) {
      throw new ScriptError(`${fn.name}() needs ${fn.params.length} value(s) but was given ${args.length}.`, line);
    }
    if (this.depth >= MAX_DEPTH) throw new ScriptError('Too many nested function calls. Does a function call itself forever?', line);
    const env = new Env(this.globals);
    fn.params.forEach((p, i) => {
      env.vars.set(p.name, { type: p.type, isArray: p.isArray, value: p.isArray ? args[i] : coerce(p.type, args[i], line) });
    });
    this.depth++;
    try {
      const flow = yield* this.execList(fn.body, env);
      if (flow?.k === 'ret' && flow.v !== undefined && fn.ret.kind !== 'void') return coerce(fn.ret, flow.v, line);
      return 0;
    } finally {
      this.depth--;
    }
  }

  private fmtArgs(e: Extract<Expr, { k: 'call' }>, args: Value[], env: Env): string {
    if (args.length === 0) return '';
    const float = this.isFloat(e.args[0], env);
    const first = args[0];
    if (args.length >= 2 && typeof first === 'number') {
      const n = this.num(args[1], e.line);
      if (float) return first.toFixed(Math.max(0, Math.min(20, n)));
      const whole = Math.trunc(first);
      return (whole < 0 ? whole >>> 0 : whole).toString(n).toUpperCase();
    }
    return formatValue(first, float);
  }

  private *builtin(e: Extract<Expr, { k: 'call' }>, a: Value[], env: Env): Gen<Value> {
    const { name, line } = e;
    const h = this.host;
    const want = (min: number, max = min) => {
      if (a.length < min || a.length > max) {
        throw new ScriptError(`${name}() needs ${min === max ? min : `${min} to ${max}`} value(s) but was given ${a.length}.`, line);
      }
    };
    const n = (i: number) => this.num(a[i], line);
    const nums = () => a.map((_, i) => n(i));

    const dot = name.indexOf('.');
    const servo = dot > 0 ? this.servos.get(name.slice(0, dot)) : undefined;
    if (servo) {
      const key = name.slice(0, dot);
      const method = name.slice(dot + 1);
      if (!SERVO_METHODS.has(method)) throw new ScriptError(`The Servo has no '${method}' function in this simulator.`, line);
      const angleOf = () =>
        servo.us === null ? 0 : Math.max(0, Math.min(180, Math.round(((servo.us - servo.minUs) * 180) / Math.max(1, servo.maxUs - servo.minUs))));
      switch (method) {
        case 'attach':
          want(1, 3);
          servo.gpio = this.toInt(a[0], line);
          if (a.length === 3) {
            servo.minUs = n(1);
            servo.maxUs = n(2);
          }
          if (servo.us !== null) h.servoPulse(servo.gpio, key, angleOf());
          return servo.gpio;
        case 'detach':
          servo.gpio = null;
          h.servoPulse(null, key, null);
          return 0;
        case 'write': {
          want(1);
          const v = n(0);
          servo.us = v < 200 ? servo.minUs + ((servo.maxUs - servo.minUs) * Math.max(0, Math.min(180, v))) / 180 : v;
          if (servo.gpio !== null) h.servoPulse(servo.gpio, key, angleOf());
          return 0;
        }
        case 'writeMicroseconds':
          want(1);
          servo.us = Math.max(servo.minUs, Math.min(servo.maxUs, n(0)));
          if (servo.gpio !== null) h.servoPulse(servo.gpio, key, angleOf());
          return 0;
        case 'read': return angleOf();
        default: return servo.gpio !== null ? 1 : 0;
      }
    }

    if (dot > 0 && this.lcds.has(name.slice(0, dot))) {
      const method = name.slice(dot + 1);
      if (!LCD_METHODS.has(method)) throw new ScriptError(`The LCD has no '${method}' function in this simulator.`, line);
      if (method === 'print' || method === 'println') {
        h.lcdCall(name.slice(0, dot), 'print', [this.fmtArgs(e, a, env) + (method === 'println' ? '\n' : '')]);
      } else if (method === 'write') {
        want(1);
        h.lcdCall(name.slice(0, dot), 'print', [typeof a[0] === 'string' ? a[0] : String.fromCharCode(n(0))]);
      } else {
        h.lcdCall(name.slice(0, dot), method, a.map((v) => (typeof v === 'string' ? v : this.num(v, line))));
      }
      return 0;
    }

    switch (name) {
      case 'Wire.begin':
        h.wireBegin(a.length >= 2 ? this.toInt(a[0], line) : undefined, a.length >= 2 ? this.toInt(a[1], line) : undefined);
        return 1;
      case 'Wire.setClock': case 'Wire.end': case 'Wire.setPins': return 0;
      case 'pinMode': want(2); h.pinMode(this.toInt(a[0], line), n(1)); return 0;
      case 'digitalWrite': want(2); h.digitalWrite(this.toInt(a[0], line), n(1) ? 1 : 0); return 0;
      case 'digitalRead': want(1); return h.digitalRead(this.toInt(a[0], line));
      case 'analogRead': want(1); return h.analogRead(this.toInt(a[0], line));
      case 'analogReadMilliVolts': want(1); return Math.round((h.analogRead(this.toInt(a[0], line)) * 3300) / 4095);
      case 'analogWrite': want(2); h.analogWrite(this.toInt(a[0], line), Math.min(1, Math.max(0, n(1) / 255))); return 0;
      case 'ledcAttach': want(3); this.ledcBits.set(this.toInt(a[0], line), n(2)); return 1;
      case 'ledcWrite': {
        want(2);
        const pin = this.toInt(a[0], line);
        const max = 2 ** (this.ledcBits.get(pin) ?? 8) - 1;
        h.analogWrite(pin, Math.min(1, Math.max(0, n(1) / max)));
        return 0;
      }
      case 'delay': want(1); yield { k: 'delay', us: Math.max(0, n(0)) * 1000 }; return 0;
      case 'delayMicroseconds': want(1); yield { k: 'delay', us: Math.max(0, n(0)) }; return 0;
      case 'yield': yield { k: 'budget' }; return 0;
      case 'millis': want(0); return Math.floor(h.nowUs() / 1000) >>> 0;
      case 'micros': want(0); return Math.floor(h.nowUs()) >>> 0;

      case 'Serial.begin': case 'Serial.flush': case 'Serial.end': case 'randomSeed': return 0;
      case 'Serial.available': return 0;
      case 'Serial.read': return -1;
      case 'Serial.print': h.print(this.fmtArgs(e, a, env)); return 0;
      case 'Serial.println': h.print(`${this.fmtArgs(e, a, env)}\n`); return 0;
      case 'Serial.write': want(1); h.print(typeof a[0] === 'string' ? a[0] : String.fromCharCode(n(0))); return 1;
      case 'Serial.printf': {
        if (a.length < 1 || typeof a[0] !== 'string') throw new ScriptError('Serial.printf needs a text format first.', line);
        h.print(printf(a[0], a.slice(1), line));
        return 0;
      }
      case 'String': want(1); return formatValue(a[0], this.isFloat(e.args[0], env));

      case 'abs': want(1); return Math.abs(n(0));
      case 'fabs': want(1); return Math.abs(n(0));
      case 'min': want(2); return Math.min(n(0), n(1));
      case 'max': want(2); return Math.max(n(0), n(1));
      case 'constrain': want(3); return Math.min(Math.max(n(0), n(1)), n(2));
      case 'sq': want(1); return n(0) * n(0);
      case 'sqrt': want(1); return Math.sqrt(n(0));
      case 'pow': want(2); return Math.pow(n(0), n(1));
      case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'atan': case 'log': case 'log10': case 'exp': case 'floor': case 'ceil':
        want(1);
        return Math[name](n(0));
      case 'atan2': want(2); return Math.atan2(n(0), n(1));
      case 'round': want(1); return Math.round(n(0));
      case 'radians': want(1); return (n(0) * Math.PI) / 180;
      case 'degrees': want(1); return (n(0) * 180) / Math.PI;
      case 'map': {
        want(5);
        const [x, inMin, inMax, outMin, outMax] = nums();
        if (inMax === inMin) throw new ScriptError('map() cannot use the same input minimum and maximum.', line);
        return Math.trunc(((x - inMin) * (outMax - outMin)) / (inMax - inMin)) + outMin;
      }
      case 'random': {
        want(1, 2);
        const [lo, hi] = a.length === 1 ? [0, n(0)] : [n(0), n(1)];
        return hi <= lo ? lo : lo + Math.floor(Math.random() * (hi - lo));
      }
      case 'bitRead': want(2); return (this.toInt(a[0], line) >>> n(1)) & 1;
      default:
        throw new ScriptError(`Unknown function '${name}'. It is not part of the supported Arduino subset yet.`, line);
    }
  }
}
