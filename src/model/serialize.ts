import { DEFAULT_WIRE_LIMIT_MA } from '../sim/wires';
import { PART_DEFS, type PartType } from './parts';
import type { Part, PinRef, Point, Wire } from './types';

export const FILE_VERSION = 1;
export const FILE_KIND = 'esp32-circuit-simulator';

export interface CircuitFile {
  kind: typeof FILE_KIND;
  version: number;
  parts: Part[];
  wires: Wire[];
  source: string;
  wireLimitMa: number;
}

export const DEFAULT_WIRE_COLOR = '#3fbf6f';
export const WIRE_COLORS = [
  { name: 'Green', value: DEFAULT_WIRE_COLOR },
  { name: 'Red', value: '#e5484d' },
  { name: 'Black', value: '#2b2f38' },
  { name: 'Yellow', value: '#f5d90a' },
  { name: 'Blue', value: '#3e8bff' },
  { name: 'Orange', value: '#ff8b3d' },
  { name: 'White', value: '#e8ecf2' },
  { name: 'Purple', value: '#a66bff' },
];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function serializeCircuit(c: Omit<CircuitFile, 'kind' | 'version'>): string {
  const file: CircuitFile = { kind: FILE_KIND, version: FILE_VERSION, ...c };
  return JSON.stringify(file, null, 2);
}

function readPoint(v: unknown, where: string): Point {
  if (!isObj(v) || !isNum(v.x) || !isNum(v.y)) throw new Error(`${where}: bad point`);
  return { x: v.x, y: v.y };
}

function readNumberMap(v: unknown, where: string): Record<string, number> {
  if (!isObj(v)) throw new Error(`${where}: expected an object`);
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) {
    if (!isNum(n)) throw new Error(`${where}.${k}: expected a number`);
    out[k] = n;
  }
  return out;
}

function readPart(v: unknown, i: number): Part {
  const where = `parts[${i}]`;
  if (!isObj(v)) throw new Error(`${where}: expected an object`);
  if (typeof v.id !== 'string' || !v.id) throw new Error(`${where}: missing id`);
  if (typeof v.type !== 'string' || !(v.type in PART_DEFS)) throw new Error(`${where}: unknown part type "${String(v.type)}"`);
  if (!isNum(v.x) || !isNum(v.y)) throw new Error(`${where}: bad position`);
  if (v.rot !== 0 && v.rot !== 1 && v.rot !== 2 && v.rot !== 3) throw new Error(`${where}: bad rotation`);
  const part: Part = {
    id: v.id,
    type: v.type as PartType,
    name: typeof v.name === 'string' ? v.name : v.id,
    x: v.x,
    y: v.y,
    rot: v.rot,
  };
  if (v.params !== undefined) part.params = readNumberMap(v.params, `${where}.params`);
  // Runtime-only GPIO state is never restored; the script sets it when it runs.
  return part;
}

function readPinRef(v: unknown, where: string, parts: Map<string, Part>): PinRef {
  if (!isObj(v) || typeof v.partId !== 'string' || typeof v.pin !== 'string') throw new Error(`${where}: bad pin reference`);
  const part = parts.get(v.partId);
  if (!part) throw new Error(`${where}: unknown part "${v.partId}"`);
  if (!PART_DEFS[part.type].pins.some((p) => p.name === v.pin)) throw new Error(`${where}: ${part.name} has no pin "${v.pin}"`);
  return { partId: v.partId, pin: v.pin };
}

/** Parses and validates a saved circuit; throws an Error with a readable message on bad input. */
export function parseCircuit(text: string): CircuitFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!isObj(raw) || raw.kind !== FILE_KIND) throw new Error('This is not a circuit file from this simulator.');
  if (!isNum(raw.version) || raw.version > FILE_VERSION) throw new Error('This file was saved by a newer version of the simulator.');
  if (!Array.isArray(raw.parts) || !Array.isArray(raw.wires)) throw new Error('The file is missing its parts or wires.');

  const parts = raw.parts.map(readPart);
  const byId = new Map(parts.map((p) => [p.id, p]));
  if (byId.size !== parts.length) throw new Error('Two parts share the same id.');

  const wires = raw.wires.map((w: unknown, i): Wire => {
    const where = `wires[${i}]`;
    if (!isObj(w) || typeof w.id !== 'string') throw new Error(`${where}: missing id`);
    const wire: Wire = { id: w.id, from: readPinRef(w.from, `${where}.from`, byId), to: readPinRef(w.to, `${where}.to`, byId) };
    if (w.points !== undefined) {
      if (!Array.isArray(w.points)) throw new Error(`${where}.points: expected a list`);
      if (w.points.length > 0) wire.points = w.points.map((p, j) => readPoint(p, `${where}.points[${j}]`));
    }
    if (typeof w.color === 'string' && /^#[0-9a-f]{6}$/i.test(w.color)) wire.color = w.color;
    return wire;
  });

  return {
    kind: FILE_KIND,
    version: FILE_VERSION,
    parts,
    wires,
    source: typeof raw.source === 'string' ? raw.source : '',
    wireLimitMa: isNum(raw.wireLimitMa) && raw.wireLimitMa >= 1 ? raw.wireLimitMa : DEFAULT_WIRE_LIMIT_MA,
  };
}
