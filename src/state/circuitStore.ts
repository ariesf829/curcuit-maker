import { create } from 'zustand';
import { GRID, PART_DEFS, type PartType } from '../model/parts';
import type { Part, PinRef, Wire } from '../model/types';

export type Selection = { kind: 'part' | 'wire'; id: string } | null;

interface CircuitState {
  parts: Part[];
  wires: Wire[];
  selection: Selection;
  wiringFrom: PinRef | null;
  addPart: (type: PartType, x: number, y: number) => void;
  movePart: (id: string, x: number, y: number) => void;
  rotateSelected: () => void;
  removeSelected: () => void;
  select: (s: Selection) => void;
  clickPin: (ref: PinRef) => void;
  cancelWiring: () => void;
  clearAll: () => void;
}

export const snap = (v: number) => Math.round(v / GRID) * GRID;
const uid = () => crypto.randomUUID().slice(0, 8);

const initialBoard = (): Part => ({ id: uid(), type: 'breadboard', name: 'BB1', x: 160, y: 160, rot: 0 });

export const useCircuit = create<CircuitState>((set, get) => ({
  parts: [initialBoard()],
  wires: [],
  selection: null,
  wiringFrom: null,

  addPart: (type, x, y) =>
    set((s) => {
      const count = s.parts.filter((q) => q.type === type).length + 1;
      const part: Part = { id: uid(), type, name: `${PART_DEFS[type].prefix}${count}`, x: snap(x), y: snap(y), rot: 0 };
      return { parts: [...s.parts, part], selection: { kind: 'part', id: part.id } };
    }),

  movePart: (id, x, y) => set((s) => ({ parts: s.parts.map((q) => (q.id === id ? { ...q, x, y } : q)) })),

  rotateSelected: () =>
    set((s) => {
      const sel = s.selection;
      if (sel?.kind !== 'part') return s;
      return { parts: s.parts.map((q) => (q.id === sel.id ? { ...q, rot: ((q.rot + 1) & 3) as Part['rot'] } : q)) };
    }),

  removeSelected: () =>
    set((s) => {
      const sel = s.selection;
      if (!sel) return s;
      if (sel.kind === 'wire') return { wires: s.wires.filter((w) => w.id !== sel.id), selection: null };
      return {
        parts: s.parts.filter((q) => q.id !== sel.id),
        wires: s.wires.filter((w) => w.from.partId !== sel.id && w.to.partId !== sel.id),
        selection: null,
      };
    }),

  select: (selection) => set({ selection }),

  clickPin: (ref) => {
    const from = get().wiringFrom;
    if (!from) return set({ wiringFrom: ref });
    if (from.partId === ref.partId && from.pin === ref.pin) return set({ wiringFrom: null });
    const wire: Wire = { id: uid(), from, to: ref };
    set((s) => ({ wires: [...s.wires, wire], wiringFrom: null, selection: { kind: 'wire', id: wire.id } }));
  },

  cancelWiring: () => set({ wiringFrom: null }),

  clearAll: () => set({ parts: [initialBoard()], wires: [], selection: null, wiringFrom: null }),
}));
