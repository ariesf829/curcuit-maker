import { buildNets, pinKey } from '../model/connectivity';
import type { Part, Wire } from '../model/types';
import type { Issue } from './checks';
import type { SimResult } from './simulate';

// Every wire gets the same small resistance, so loops of wires share current evenly.
const WIRE_OHMS = 1;

/**
 * Current through each wire, positive when conventional current flows from `wire.from` to `wire.to`.
 *
 * Parts, breadboard strips and plugged-in pins form conductor nodes; wires are the edges between them.
 * Each part terminal draws or injects its solved current at its node, and the wire network is solved
 * with Kirchhoff's current law.
 */
export function wireCurrents(parts: Part[], wires: Wire[], sim: SimResult): Map<string, number> {
  const result = new Map<string, number>(wires.map((w) => [w.id, 0]));
  if (wires.length === 0) return result;

  const nodeOf = buildNets(parts, []).netOf;
  const node = (r: { partId: string; pin: string }) => nodeOf.get(pinKey(r));

  const edges = wires
    .map((w) => ({ id: w.id, a: node(w.from), b: node(w.to) }))
    .filter((e): e is { id: string; a: number; b: number } => e.a !== undefined && e.b !== undefined && e.a !== e.b);
  if (edges.length === 0) return result;

  // Element current flows into terminal a and out of terminal b, so the wires feed a and drain b.
  const inject = new Map<number, number>();
  const add = (n: number | undefined, amps: number) => {
    if (n !== undefined) inject.set(n, (inject.get(n) ?? 0) + amps);
  };
  for (const e of sim.elements) {
    add(nodeOf.get(pinKey({ partId: e.partId, pin: e.pinA })), e.current);
    add(nodeOf.get(pinKey({ partId: e.partId, pin: e.pinB })), -e.current);
  }

  // Split the wire graph into connected components and solve each one.
  const adj = new Map<number, number[]>();
  for (const [i, e] of edges.entries()) {
    for (const n of [e.a, e.b]) adj.set(n, [...(adj.get(n) ?? []), i]);
  }
  const seen = new Set<number>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const nodes: number[] = [];
    const comp = new Set<number>();
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const n = stack.pop()!;
      nodes.push(n);
      for (const ei of adj.get(n)!) {
        comp.add(ei);
        const other = edges[ei].a === n ? edges[ei].b : edges[ei].a;
        if (!seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }

    // Node 0 of the component is the reference (0 V); solve G·v = I for the rest.
    const idx = new Map(nodes.map((n, i) => [n, i]));
    const size = nodes.length;
    const g = Array.from({ length: size }, () => new Array<number>(size + 1).fill(0));
    for (const ei of comp) {
      const a = idx.get(edges[ei].a)!;
      const b = idx.get(edges[ei].b)!;
      const c = 1 / WIRE_OHMS;
      g[a][a] += c;
      g[b][b] += c;
      g[a][b] -= c;
      g[b][a] -= c;
    }
    nodes.forEach((n, i) => {
      g[i][size] = inject.get(n) ?? 0;
    });
    const v = solveLinear(g.slice(1).map((row) => row.slice(1, size).concat(row[size])), size - 1);

    const volt = (n: number) => {
      const i = idx.get(n)!;
      return i === 0 ? 0 : v[i - 1];
    };
    for (const ei of comp) {
      // Injections above are demands (current drawn by parts), so the potentials are inverted: negate.
      result.set(edges[ei].id, -(volt(edges[ei].a) - volt(edges[ei].b)) / WIRE_OHMS);
    }
  }
  return result;
}

/** Gaussian elimination with partial pivoting on an augmented n×(n+1) matrix. */
function solveLinear(m: number[][], n: number): number[] {
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / d;
      if (f !== 0) for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

export const DEFAULT_WIRE_LIMIT_MA = 1000;

/** Flags wires carrying more than the allowed current (warning from 80 %, error above the limit). */
export function checkWires(wires: Wire[], currents: Map<string, number>, limitMa: number): Issue[] {
  const issues: Issue[] = [];
  const fmt = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} A` : `${x.toFixed(1)} mA`);
  wires.forEach((w, i) => {
    const mA = Math.abs(currents.get(w.id) ?? 0) * 1000;
    if (mA <= limitMa * 0.8) return;
    const over = mA > limitMa;
    issues.push({
      id: `wire:${w.id}`,
      severity: over ? 'error' : 'warning',
      title: over ? `Wire ${i + 1} is overloaded` : `Wire ${i + 1} is near its limit`,
      detail: `Carries ${fmt(mA)}; the wire limit is ${fmt(limitMa)}. Use a thicker wire, split the load, or reduce the current.`,
      partIds: [w.from.partId],
      nets: [],
      wireIds: [w.id],
    });
  });
  return issues;
}
