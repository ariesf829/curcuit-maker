import type { Part, Wire } from '../model/types';
import { checkCircuit } from './checks';
import { simulate } from './simulate';
import { addSuggestions } from './suggest';
import { wireCurrents } from './wires';

export interface Solved {
  parts: Part[];
  wires: Wire[];
  sim: ReturnType<typeof simulate>;
  issues: ReturnType<typeof checkCircuit>;
  currents: Map<string, number>;
}

let cache: Solved | null = null;

/** Solves a circuit once per distinct (parts, wires) pair; the UI and the script runtime share the result. */
export function solveCircuit(parts: Part[], wires: Wire[]): Solved {
  if (cache?.parts === parts && cache.wires === wires) return cache;
  const sim = simulate(parts, wires);
  const issues = addSuggestions(checkCircuit(parts, sim), parts, wires, sim);
  cache = { parts, wires, sim, issues, currents: wireCurrents(parts, wires, sim) };
  return cache;
}
