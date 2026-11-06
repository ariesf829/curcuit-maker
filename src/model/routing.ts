import type { Point } from './types';

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/**
 * Full polyline for a wire: start, the user's bend points, end.
 * With `orthogonal`, an elbow is inserted wherever two consecutive points differ in both axes,
 * so the wire runs in horizontal and vertical segments only.
 */
export function routePath(start: Point, bends: Point[], end: Point, orthogonal: boolean): Point[] {
  const raw = [start, ...bends, end];
  const out: Point[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const prev = out[out.length - 1];
    const next = raw[i];
    if (same(prev, next)) continue;
    if (orthogonal && prev.x !== next.x && prev.y !== next.y) out.push({ x: next.x, y: prev.y });
    out.push(next);
  }
  return out;
}

/** The bend points of a routed path, i.e. everything except the two end pins. */
export function bendsOf(path: Point[]): Point[] {
  return path.slice(1, -1);
}

export function pathToString(path: Point[]): string {
  return path.map((p) => `${p.x},${p.y}`).join(' ');
}

/** The point halfway along the path's total length. */
export function pathMid(path: Point[]): Point {
  const lens = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
  let left = lens.reduce((a, b) => a + b, 0) / 2;
  for (const [i, len] of lens.entries()) {
    if (left <= len && len > 0) {
      const t = left / len;
      return { x: path[i].x + (path[i + 1].x - path[i].x) * t, y: path[i].y + (path[i + 1].y - path[i].y) * t };
    }
    left -= len;
  }
  return path[0];
}
