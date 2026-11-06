import { create } from 'zustand';
import { GRID, PART_DEFS, type PartType } from '../model/parts';
import type { PinMode } from '../model/boards';
import { attachedParts, pinWorld, rotatePoint } from '../model/connectivity';
import { defaultParams } from '../model/params';
import { bendsOf, routePath } from '../model/routing';
import type { Part, PinRef, Point, Wire } from '../model/types';
import { DEFAULT_WIRE_COLOR } from '../model/serialize';
import { DEFAULT_WIRE_LIMIT_MA } from '../sim/wires';

export type Selection = { kind: 'part' | 'wire'; id: string } | null;

interface CircuitState {
  parts: Part[];
  wires: Wire[];
  selection: Selection;
  wiringFrom: PinRef | null;
  /** Bend points placed so far while drawing a wire. */
  wiringPoints: Point[];
  orthogonal: boolean;
  /** Maximum current a wire may carry before it is flagged, in mA. */
  wireLimitMa: number;
  setWireLimitMa: (v: number) => void;
  /** Colour given to newly drawn wires. */
  wireColor: string;
  setWireColor: (id: string, color: string) => void;
  setDefaultWireColor: (color: string) => void;
  /** Replaces the whole circuit (used by open and examples). */
  loadCircuit: (parts: Part[], wires: Wire[], wireLimitMa: number) => void;
  addPart: (type: PartType, x: number, y: number) => void;
  movePart: (id: string, x: number, y: number) => void;
  setParam: (id: string, key: string, value: number) => void;
  setBoardPins: (id: string, modes: Record<string, PinMode>, duty: Record<string, number>) => void;
  addWaypoint: (p: Point) => void;
  removeLastWaypoint: () => void;
  moveWirePoint: (id: string, index: number, p: Point) => void;
  removeWirePoint: (id: string, index: number) => void;
  setOrthogonal: (v: boolean) => void;
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
  wiringPoints: [],
  orthogonal: true,
  wireLimitMa: DEFAULT_WIRE_LIMIT_MA,
  wireColor: DEFAULT_WIRE_COLOR,

  setWireColor: (id, color) => set((s) => ({ wires: s.wires.map((w) => (w.id === id ? { ...w, color } : w)), wireColor: color })),
  setDefaultWireColor: (wireColor) => set({ wireColor }),
  loadCircuit: (parts, wires, wireLimitMa) =>
    set({ parts, wires, wireLimitMa, selection: null, wiringFrom: null, wiringPoints: [] }),

  setWireLimitMa: (v) => set({ wireLimitMa: Math.max(1, v) }),

  addPart: (type, x, y) =>
    set((s) => {
      const count = s.parts.filter((q) => q.type === type).length + 1;
      const part: Part = {
        id: uid(),
        type,
        name: `${PART_DEFS[type].prefix}${count}`,
        x: snap(x),
        y: snap(y),
        rot: 0,
        params: defaultParams(type),
      };
      return { parts: [...s.parts, part], selection: { kind: 'part', id: part.id } };
    }),

  movePart: (id, x, y) =>
    set((s) => {
      const part = s.parts.find((q) => q.id === id);
      if (!part) return s;
      const dx = x - part.x;
      const dy = y - part.y;
      if (dx === 0 && dy === 0) return s;
      // A breadboard carries the parts plugged into it, and wires routed between them.
      const group = new Set<string>([id]);
      if (part.type === 'breadboard') attachedParts(s.parts, part).forEach((q) => group.add(q.id));
      return {
        parts: s.parts.map((q) => (group.has(q.id) ? { ...q, x: q.x + dx, y: q.y + dy } : q)),
        wires: s.wires.map((w) =>
          w.points && group.has(w.from.partId) && group.has(w.to.partId)
            ? { ...w, points: w.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
            : w,
        ),
      };
    }),

  setParam: (id, key, value) =>
    set((s) => ({ parts: s.parts.map((q) => (q.id === id ? { ...q, params: { ...q.params, [key]: value } } : q)) })),

  rotateSelected: () =>
    set((s) => {
      const sel = s.selection;
      if (sel?.kind !== 'part') return s;
      const part = s.parts.find((q) => q.id === sel.id);
      if (!part) return s;
      const turn = (q: Part): Part => ({ ...q, rot: ((q.rot + 1) & 3) as Part['rot'] });
      if (part.type !== 'breadboard') return { parts: s.parts.map((q) => (q.id === sel.id ? turn(q) : q)) };

      // Rotate the board and its plugged-in parts together about the board origin.
      const group = new Set<string>([part.id, ...attachedParts(s.parts, part).map((q) => q.id)]);
      const spin = (p: Point): Point => {
        const r = rotatePoint({ x: p.x - part.x, y: p.y - part.y }, 1);
        return { x: part.x + r.x, y: part.y + r.y };
      };
      return {
        parts: s.parts.map((q) => {
          if (!group.has(q.id)) return q;
          const t = turn(q);
          return q.id === part.id ? t : { ...t, ...spin(q) };
        }),
        wires: s.wires.map((w) =>
          w.points && group.has(w.from.partId) && group.has(w.to.partId) ? { ...w, points: w.points.map(spin) } : w,
        ),
      };
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
    const { wiringFrom: from, wiringPoints, parts, orthogonal, wireColor } = get();
    if (!from) return set({ wiringFrom: ref, wiringPoints: [] });
    if (from.partId === ref.partId && from.pin === ref.pin) return set({ wiringFrom: null, wiringPoints: [] });
    const a = parts.find((q) => q.id === from.partId);
    const b = parts.find((q) => q.id === ref.partId);
    if (!a || !b) return set({ wiringFrom: null, wiringPoints: [] });
    const bends = bendsOf(routePath(pinWorld(a, from.pin), wiringPoints, pinWorld(b, ref.pin), orthogonal));
    const wire: Wire = {
      id: uid(),
      from,
      to: ref,
      ...(bends.length > 0 && { points: bends }),
      ...(wireColor !== DEFAULT_WIRE_COLOR && { color: wireColor }),
    };
    set((s) => ({
      wires: [...s.wires, wire],
      wiringFrom: null,
      wiringPoints: [],
      selection: { kind: 'wire', id: wire.id },
    }));
  },

  addWaypoint: (p) =>
    set((s) => {
      if (!s.wiringFrom) return s;
      const last = s.wiringPoints[s.wiringPoints.length - 1];
      if (last && last.x === p.x && last.y === p.y) return s;
      return { wiringPoints: [...s.wiringPoints, p] };
    }),

  removeLastWaypoint: () => set((s) => ({ wiringPoints: s.wiringPoints.slice(0, -1) })),

  moveWirePoint: (id, index, p) =>
    set((s) => ({
      wires: s.wires.map((w) => (w.id === id && w.points ? { ...w, points: w.points.map((q, i) => (i === index ? p : q)) } : w)),
    })),

  removeWirePoint: (id, index) =>
    set((s) => ({
      wires: s.wires.map((w) => {
        if (w.id !== id || !w.points) return w;
        const points = w.points.filter((_, i) => i !== index);
        return points.length > 0 ? { ...w, points } : { id: w.id, from: w.from, to: w.to };
      }),
    })),

  setOrthogonal: (orthogonal) => set({ orthogonal }),

  setBoardPins: (id, modes, duty) =>
    set((s) => ({
      parts: s.parts.map((q) =>
        q.id === id ? { ...q, pinModes: Object.keys(modes).length ? modes : undefined, pinDuty: Object.keys(duty).length ? duty : undefined } : q,
      ),
    })),

  cancelWiring: () => set({ wiringFrom: null, wiringPoints: [] }),

  clearAll: () => set({ parts: [initialBoard()], wires: [], selection: null, wiringFrom: null, wiringPoints: [] }),
}));
