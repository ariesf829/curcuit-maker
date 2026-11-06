import { useMemo } from 'react';
import { solveCircuit as solve } from '../sim/solved';
import { checkWires } from '../sim/wires';
import { useCircuit } from '../state/circuitStore';

export function useSimulation() {
  const parts = useCircuit((s) => s.parts);
  const wires = useCircuit((s) => s.wires);
  return useMemo(() => solve(parts, wires).sim, [parts, wires]);
}

/** Current through each wire in amps, positive from the wire's first pin to its second. */
export function useWireCurrents() {
  const parts = useCircuit((s) => s.parts);
  const wires = useCircuit((s) => s.wires);
  return useMemo(() => solve(parts, wires).currents, [parts, wires]);
}

export function useIssues() {
  const parts = useCircuit((s) => s.parts);
  const wires = useCircuit((s) => s.wires);
  const limitMa = useCircuit((s) => s.wireLimitMa);
  return useMemo(() => {
    const r = solve(parts, wires);
    const rank = { error: 0, warning: 1, info: 2 };
    return [...r.issues, ...checkWires(wires, r.currents, limitMa)].sort((a, b) => rank[a.severity] - rank[b.severity]);
  }, [parts, wires, limitMa]);
}

export function formatAmps(a: number): string {
  const x = Math.abs(a);
  if (x < 1e-9) return '0 A';
  if (x < 1e-3) return `${(a * 1e6).toFixed(1)} µA`;
  if (x < 1) return `${(a * 1e3).toFixed(2)} mA`;
  return `${a.toFixed(2)} A`;
}

export function formatVolts(v: number): string {
  return `${v.toFixed(3)} V`;
}
