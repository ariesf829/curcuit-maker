import { describe, expect, it } from 'vitest';
import { bendsOf, routePath } from './routing';

const P = (x: number, y: number) => ({ x, y });

describe('routePath', () => {
  it('is a straight line without bends when not orthogonal', () => {
    expect(routePath(P(0, 0), [], P(40, 20), false)).toEqual([P(0, 0), P(40, 20)]);
  });

  it('adds one elbow between two points that differ in both axes', () => {
    expect(routePath(P(0, 0), [], P(40, 20), true)).toEqual([P(0, 0), P(40, 0), P(40, 20)]);
  });

  it('keeps aligned points as a single segment', () => {
    expect(routePath(P(0, 0), [], P(40, 0), true)).toEqual([P(0, 0), P(40, 0)]);
  });

  it('routes through the user waypoints in order', () => {
    const path = routePath(P(0, 0), [P(0, 100), P(100, 100)], P(100, 0), true);
    expect(path).toEqual([P(0, 0), P(0, 100), P(100, 100), P(100, 0)]);
    expect(bendsOf(path)).toEqual([P(0, 100), P(100, 100)]);
  });

  it('drops repeated points', () => {
    expect(routePath(P(0, 0), [P(0, 0), P(20, 0)], P(20, 0), true)).toEqual([P(0, 0), P(20, 0)]);
  });
});
