import { BOARDS, pinRole, type PinMode } from '../model/boards';
import { PART_DEFS } from '../model/parts';
import type { Part } from '../model/types';
import { Interp, type Host } from './interp';
import { LcdModel, type LcdView } from './lcd';
import { ScriptError, type Program } from './lang';

const LOGIC_HIGH_VOLTS = 1.65;
const ADC_FULL_SCALE_VOLTS = 3.3;
const ADC_MAX = 4095;
const MAX_TICK_MS = 100;
const MAX_RESUMES_PER_TICK = 20000;

export interface RuntimeIO {
  board(id: string): Part | undefined;
  setPins(boardId: string, modes: Record<string, PinMode>, duty: Record<string, number>): void;
  /** Voltage on a board pin in the current circuit solution. */
  voltage(boardId: string, pin: string): number;
  print(text: string): void;
  warn(message: string): void;
  /** Finds the LCD part that answers at this address, given the wiring to the board's I2C pins. */
  lcdBus(boardId: string, address: number, sdaPin: string, sclPin: string): { partId: string } | { problem: string };
  /** Updates what an LCD part shows; null blanks it. */
  lcdShow(partId: string, view: LcdView | null): void;
  /** Servos whose signal wire is on this board pin and that are powered, or why none is. */
  servoBus(boardId: string, pin: string): { partIds: string[] } | { problem: string };
  /** Sets the commanded horn angle of a servo part; null forgets it. */
  servoShow(partId: string, angle: number | null): void;
}

const DEFAULT_I2C_GPIOS: Record<string, [number, number]> = { 'esp32-devkit-v1': [21, 22] };
const FALLBACK_I2C_GPIOS: [number, number] = [8, 9];

interface ServoSlot {
  gpio: number | null;
  angle: number | null;
  shownOn: string[];
}

interface LcdSlot {
  address: number;
  model: LcdModel;
  shownOn?: string;
}

/** Runs a parsed program against virtual time and drives one ESP32 board's pins. */
export class ScriptRuntime {
  done = false;
  error?: ScriptError;

  private gen: ReturnType<Interp['run']>;
  private taskUs = 0;
  private clockUs = 0;
  private modes: Record<string, PinMode> = {};
  private duty: Record<string, number> = {};
  private dirty = false;
  private warned = new Set<string>();
  private lcds = new Map<string, LcdSlot>();
  private lcdDirty = new Set<string>();
  private servos = new Map<string, ServoSlot>();
  private servoDirty = new Set<string>();
  private i2c: { sda?: number; scl?: number } = {};

  private io: RuntimeIO;
  private boardId: string;

  constructor(program: Program, io: RuntimeIO, boardId: string) {
    this.io = io;
    this.boardId = boardId;
    this.gen = new Interp(program, this.host()).run();
  }

  /** Advances virtual time by `dtMs` and runs the program until it waits past that point. */
  tick(dtMs: number) {
    if (this.done) return;
    this.clockUs += Math.min(dtMs, MAX_TICK_MS) * 1000;
    let resumes = 0;
    try {
      while (this.taskUs <= this.clockUs) {
        if (++resumes > MAX_RESUMES_PER_TICK) {
          this.taskUs = this.clockUs;
          break;
        }
        const r = this.gen.next();
        if (r.done) {
          this.done = true;
          break;
        }
        if (r.value.k === 'delay') this.taskUs += r.value.us;
        else {
          // A long stretch without delay(): let virtual time catch up so millis() keeps moving.
          this.taskUs = Math.max(this.taskUs, this.clockUs);
          this.flush();
          break;
        }
        this.flush();
      }
    } catch (e) {
      this.done = true;
      this.error = e instanceof ScriptError ? e : new ScriptError(e instanceof Error ? e.message : String(e), 0);
    }
    this.flush();
  }

  private flush() {
    this.flushLcds();
    this.flushServos();
    if (!this.dirty) return;
    this.dirty = false;
    this.io.setPins(this.boardId, { ...this.modes }, { ...this.duty });
  }

  /** Hides every display this program drew; called when the program stops. */
  releaseDisplays() {
    for (const slot of this.servos.values()) {
      for (const id of slot.shownOn) this.io.servoShow(id, null);
      slot.shownOn = [];
    }
    for (const slot of this.lcds.values()) {
      if (slot.shownOn) this.io.lcdShow(slot.shownOn, null);
      slot.shownOn = undefined;
    }
  }

  private flushServos() {
    for (const key of this.servoDirty) {
      const slot = this.servos.get(key);
      if (!slot) continue;
      const pin = slot.gpio === null ? undefined : this.pinName(slot.gpio);
      const found = pin ? this.io.servoBus(this.boardId, pin) : undefined;
      const ids = found && 'partIds' in found ? found.partIds : [];
      if (found && 'problem' in found) this.warnOnce(`servo:${key}:${found.problem}`, found.problem);
      for (const id of slot.shownOn) if (!ids.includes(id)) this.io.servoShow(id, null);
      slot.shownOn = ids;
      if (slot.angle !== null) for (const id of ids) this.io.servoShow(id, slot.angle);
    }
    this.servoDirty.clear();
  }

  private flushLcds() {
    if (this.lcdDirty.size === 0) return;
    const board = this.io.board(this.boardId);
    const [defSda, defScl] = (board && DEFAULT_I2C_GPIOS[board.type]) ?? FALLBACK_I2C_GPIOS;
    const sda = this.pinName(this.i2c.sda ?? defSda);
    const scl = this.pinName(this.i2c.scl ?? defScl);
    for (const name of this.lcdDirty) {
      const slot = this.lcds.get(name);
      if (!slot || !sda || !scl) continue;
      const found = this.io.lcdBus(this.boardId, slot.address, sda, scl);
      if ('problem' in found) {
        this.warnOnce(`lcd:${name}:${found.problem}`, found.problem);
        if (slot.shownOn) this.io.lcdShow(slot.shownOn, null);
        slot.shownOn = undefined;
        continue;
      }
      if (slot.shownOn && slot.shownOn !== found.partId) this.io.lcdShow(slot.shownOn, null);
      slot.shownOn = found.partId;
      this.io.lcdShow(found.partId, slot.model.view());
    }
    this.lcdDirty.clear();
  }

  private warnOnce(key: string, message: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.io.warn(message);
  }

  private pinName(gpio: number): string | undefined {
    const board = this.io.board(this.boardId);
    if (!board) return undefined;
    const def = BOARDS[board.type as keyof typeof BOARDS];
    const pin = PART_DEFS[board.type].pins.find((p) => {
      const role = pinRole(def, p.name);
      return role.kind === 'gpio' && role.gpio === gpio;
    });
    if (!pin) this.warnOnce(`missing:${gpio}`, `GPIO${gpio} does not exist on ${board.name}.`);
    return pin?.name;
  }

  private set(pin: string, mode: PinMode, duty?: number) {
    this.modes[pin] = mode;
    if (duty === undefined) delete this.duty[pin];
    else this.duty[pin] = duty;
    this.dirty = true;
  }

  private volts(pin: string) {
    this.flush();
    return this.io.voltage(this.boardId, pin);
  }

  private host(): Host {
    return {
      nowUs: () => this.taskUs,
      pinMode: (gpio, mode) => {
        const pin = this.pinName(gpio);
        if (!pin) return;
        if (mode === 3) this.set(pin, this.modes[pin] === 'high' ? 'high' : 'low');
        else if (mode === 1) this.set(pin, 'in');
        else if (mode === 5) this.set(pin, 'pullup');
        else if (mode === 9) this.set(pin, 'pulldown');
        else this.warnOnce(`mode:${gpio}`, `pinMode(${gpio}, ...) was given an unsupported mode; use INPUT, OUTPUT, INPUT_PULLUP or INPUT_PULLDOWN.`);
      },
      digitalWrite: (gpio, value) => {
        const pin = this.pinName(gpio);
        if (!pin) return;
        const m = this.modes[pin];
        if (m !== 'high' && m !== 'low') {
          this.warnOnce(`dw:${gpio}`, `digitalWrite(${gpio}, ...) did nothing: call pinMode(${gpio}, OUTPUT) first.`);
          return;
        }
        this.set(pin, value ? 'high' : 'low');
      },
      digitalRead: (gpio) => {
        const pin = this.pinName(gpio);
        return pin && this.volts(pin) >= LOGIC_HIGH_VOLTS ? 1 : 0;
      },
      analogRead: (gpio) => {
        const pin = this.pinName(gpio);
        if (!pin) return 0;
        if (!this.modes[pin] || this.modes[pin] === 'in') this.set(pin, 'adc');
        const v = this.volts(pin);
        return Math.min(ADC_MAX, Math.max(0, Math.round((v / ADC_FULL_SCALE_VOLTS) * ADC_MAX)));
      },
      analogWrite: (gpio, duty) => {
        const pin = this.pinName(gpio);
        if (!pin) return;
        if (duty <= 0) this.set(pin, 'low');
        else if (duty >= 1) this.set(pin, 'high');
        else this.set(pin, 'high', duty);
      },
      print: (text) => this.io.print(text),
      wireBegin: (sda, scl) => {
        this.i2c = { sda, scl };
        for (const name of this.lcds.keys()) this.lcdDirty.add(name);
      },
      lcdCreate: (name, address, cols, rows) => {
        this.lcds.set(name, { address, model: new LcdModel(cols, rows) });
        this.lcdDirty.add(name);
      },
      lcdCall: (name, method, args) => {
        this.lcds.get(name)?.model.call(method, args);
        this.lcdDirty.add(name);
      },
      servoPulse: (gpio, key, angle) => {
        const slot = this.servos.get(key) ?? { gpio: null, angle: null, shownOn: [] };
        this.servos.set(key, slot);
        slot.gpio = gpio;
        slot.angle = angle;
        this.servoDirty.add(key);
      },
    };
  }
}
