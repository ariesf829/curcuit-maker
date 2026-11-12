import { create } from 'zustand';
import { isBoardType } from '../model/boards';
import { parse, ScriptError } from '../script/lang';
import { ScriptRuntime, type RuntimeIO } from '../script/runtime';
import { pinVoltage } from '../sim/simulate';
import { solveCircuit } from '../sim/solved';
import { findLcd } from '../sim/i2cBus';
import { findEscs } from '../sim/escBus';
import { findServos } from '../sim/servoBus';
import { useEsc } from './escStore';
import { useLcd } from './lcdStore';
import { useServo } from './servoStore';
import { useCircuit } from './circuitStore';

const TICK_MS = 30;
const MAX_LINES = 300;

export const EXAMPLE_SKETCH = `// Blink an LED on GPIO 4
const int LED_PIN = 4;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  Serial.println("LED on");
  delay(500);
  digitalWrite(LED_PIN, LOW);
  Serial.println("LED off");
  delay(500);
}
`;

export type ScriptStatus = 'stopped' | 'running' | 'finished' | 'error';

interface ScriptState {
  source: string;
  status: ScriptStatus;
  error: { message: string; line: number } | null;
  /** Console lines; the last one may be unfinished. */
  output: string[];
  setSource: (s: string) => void;
  run: () => void;
  stop: () => void;
  clearOutput: () => void;
}

let timer: ReturnType<typeof setInterval> | undefined;
let boardId: string | undefined;
let runtime: ScriptRuntime | undefined;

function clearTimer() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

function releaseBoard() {
  if (boardId) useCircuit.getState().setBoardPins(boardId, {}, {});
  runtime?.releaseDisplays();
  runtime = undefined;
  useLcd.getState().clear();
  useServo.getState().clear();
  useEsc.getState().clear();
}

export const useScript = create<ScriptState>((set, get) => {
  const append = (text: string) =>
    set((s) => {
      const parts = text.split('\n');
      const out = s.output.slice();
      out[out.length - 1] = (out[out.length - 1] ?? '') + parts[0];
      for (const p of parts.slice(1)) out.push(p);
      return { output: out.length > MAX_LINES ? out.slice(-MAX_LINES) : out };
    });
  const note = (text: string) => append(`${get().output.at(-1) ? '\n' : ''}[${text}]\n`);

  const fail = (e: unknown) => {
    const err = e instanceof ScriptError ? e : new ScriptError(e instanceof Error ? e.message : String(e), 0);
    set({ status: 'error', error: { message: err.message, line: err.line } });
  };

  return {
    source: EXAMPLE_SKETCH,
    status: 'stopped',
    error: null,
    output: [''],

    setSource: (source) => set({ source }),
    clearOutput: () => set({ output: [''] }),

    run: () => {
      clearTimer();
      releaseBoard();
      boardId = undefined;
      set({ error: null, output: [''] });
      const board = useCircuit.getState().parts.find((p) => isBoardType(p.type));
      if (!board) {
        set({ status: 'error', error: { message: 'Add an ESP32 board first.', line: 0 } });
        return;
      }
      let program;
      try {
        program = parse(get().source);
      } catch (e) {
        fail(e);
        return;
      }
      const io: RuntimeIO = {
        board: (id) => useCircuit.getState().parts.find((p) => p.id === id),
        setPins: (id, modes, duty) => useCircuit.getState().setBoardPins(id, modes, duty),
        voltage: (id, pin) => {
          const { parts, wires } = useCircuit.getState();
          return pinVoltage(solveCircuit(parts, wires).sim, id, pin) ?? 0;
        },
        print: append,
        warn: (m) => note(`Warning: ${m}`),
        lcdBus: (id, address, sda, scl) => {
          const { parts, wires } = useCircuit.getState();
          return findLcd(parts, solveCircuit(parts, wires).sim, id, address, sda, scl);
        },
        lcdShow: (partId, view) => useLcd.getState().show(partId, view),
        servoBus: (id, pin) => {
          const { parts, wires } = useCircuit.getState();
          return findServos(parts, solveCircuit(parts, wires).sim, id, pin);
        },
        servoShow: (partId, angle) => useServo.getState().show(partId, angle),
        escBus: (id, pin) => {
          const { parts, wires } = useCircuit.getState();
          return findEscs(parts, solveCircuit(parts, wires).sim, id, pin);
        },
        escShow: (partId, throttle, armed) => useEsc.getState().show(partId, throttle, armed),
      };
      boardId = board.id;
      const rt = new ScriptRuntime(program, io, board.id);
      runtime = rt;
      set({ status: 'running' });
      timer = setInterval(() => {
        rt.tick(TICK_MS);
        if (rt.error) {
          clearTimer();
          fail(rt.error);
        } else if (rt.done) {
          clearTimer();
          set({ status: 'finished' });
        }
      }, TICK_MS);
    },

    stop: () => {
      clearTimer();
      releaseBoard();
      boardId = undefined;
      set({ status: 'stopped' });
    },
  };
});
