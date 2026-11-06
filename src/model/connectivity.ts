import { PART_DEFS, breadboardGroup } from './parts';
import type { Part, PinRef, Point, Wire } from './types';

export const SNAP_DISTANCE = 6;

export const pinKey = (r: PinRef) => `${r.partId}:${r.pin}`;

export function rotatePoint(pt: Point, rot: number): Point {
  switch (rot & 3) {
    case 1:
      return { x: -pt.y, y: pt.x };
    case 2:
      return { x: -pt.x, y: -pt.y };
    case 3:
      return { x: pt.y, y: -pt.x };
    default:
      return pt;
  }
}

export function pinWorld(part: Part, pinName: string): Point {
  const pin = PART_DEFS[part.type].pins.find((q) => q.name === pinName);
  if (!pin) throw new Error(`Unknown pin ${pinName} on ${part.type}`);
  const r = rotatePoint(pin, part.rot);
  return { x: part.x + r.x, y: part.y + r.y };
}

/** Non-breadboard parts with at least one pin plugged into a hole of the given breadboard. */
export function attachedParts(parts: Part[], board: Part): Part[] {
  const holes = PART_DEFS.breadboard.pins.map((h) => pinWorld(board, h.name));
  return parts.filter(
    (q) =>
      q.type !== 'breadboard' &&
      PART_DEFS[q.type].pins.some((pin) => {
        const pos = pinWorld(q, pin.name);
        return holes.some((h) => Math.hypot(h.x - pos.x, h.y - pos.y) <= SNAP_DISTANCE);
      }),
  );
}

class UnionFind {
  private parent = new Map<string, string>();
  add(k: string) {
    if (!this.parent.has(k)) this.parent.set(k, k);
  }
  find(k: string): string {
    let root = k;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    while (this.parent.get(k) !== root) {
      const next = this.parent.get(k)!;
      this.parent.set(k, root);
      k = next;
    }
    return root;
  }
  union(a: string, b: string) {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface NetList {
  /** Each net is a list of pin keys ("partId:pin"). */
  nets: string[][];
  netOf: Map<string, number>;
}

/**
 * Builds electrical nets from breadboard internals, wires, and component pins
 * that sit on top of breadboard holes (matched by position).
 */
export function buildNets(parts: Part[], wires: Wire[]): NetList {
  const uf = new UnionFind();
  const boards = parts.filter((q) => q.type === 'breadboard');
  const others = parts.filter((q) => q.type !== 'breadboard');

  for (const part of parts) {
    for (const pin of PART_DEFS[part.type].pins) uf.add(`${part.id}:${pin.name}`);
  }

  for (const bb of boards) {
    const first = new Map<string, string>();
    for (const pin of PART_DEFS.breadboard.pins) {
      const g = breadboardGroup(pin.name);
      const key = `${bb.id}:${pin.name}`;
      const head = first.get(g);
      if (head) uf.union(head, key);
      else first.set(g, key);
    }
  }

  for (const w of wires) uf.union(pinKey(w.from), pinKey(w.to));

  // Duplicate power/ground pins on a dev board (GND, GND2, 3V3b, ...) are one net.
  for (const part of parts) {
    if (!part.type.startsWith('esp32')) continue;
    const firstByBase = new Map<string, string>();
    for (const pin of PART_DEFS[part.type].pins) {
      const m = /^(GND|3V3|5V)(\d|b)*$/.exec(pin.name);
      if (!m) continue;
      const key = `${part.id}:${pin.name}`;
      const head = firstByBase.get(m[1]);
      if (head) uf.union(head, key);
      else firstByBase.set(m[1], key);
    }
  }

  for (const bb of boards) {
    const holes = PART_DEFS.breadboard.pins.map((h) => ({ key: `${bb.id}:${h.name}`, pos: pinWorld(bb, h.name) }));
    for (const part of others) {
      for (const pin of PART_DEFS[part.type].pins) {
        const pos = pinWorld(part, pin.name);
        for (const hole of holes) {
          if (Math.hypot(hole.pos.x - pos.x, hole.pos.y - pos.y) <= SNAP_DISTANCE) {
            uf.union(`${part.id}:${pin.name}`, hole.key);
          }
        }
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const part of parts) {
    for (const pin of PART_DEFS[part.type].pins) {
      const key = `${part.id}:${pin.name}`;
      const root = uf.find(key);
      const list = groups.get(root);
      if (list) list.push(key);
      else groups.set(root, [key]);
    }
  }

  const nets = [...groups.values()];
  const netOf = new Map<string, number>();
  nets.forEach((net, i) => net.forEach((k) => netOf.set(k, i)));
  return { nets, netOf };
}
