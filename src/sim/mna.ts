/**
 * Nodal-analysis DC solver. Voltage sources are modelled as a Norton equivalent
 * (ideal source behind a small series resistance), so no branch unknowns are
 * needed and a short circuit gives a large finite current instead of a singular matrix.
 * Non-linear parts are solved with damped Newton-Raphson iterations.
 */

export const VT = 0.025852; // thermal voltage at 300 K
const GMIN = 1e-12;
const MAX_ITER = 300;
const TOLERANCE = 1e-7;
const MAX_STEP = 0.25; // largest allowed change of a diode voltage per iteration

export interface ResistorEl {
  kind: 'R';
  id: string;
  a: number;
  b: number;
  r: number;
}

/** Ideal source `v` (positive terminal a, negative terminal b) behind resistance `r`. */
export interface SourceEl {
  kind: 'V';
  id: string;
  a: number;
  b: number;
  v: number;
  r: number;
}

/** Anode a, cathode b. `vz` adds a reverse breakdown region for Zener diodes. */
export interface DiodeEl {
  kind: 'D';
  id: string;
  a: number;
  b: number;
  is: number;
  n: number;
  vz?: number;
}

/** Constant current `i` that enters terminal a and leaves terminal b. */
export interface CurrentEl {
  kind: 'I';
  id: string;
  a: number;
  b: number;
  i: number;
}

/**
 * NPN transistor (Ebers-Moll). Reports three results: `<id>:BE` and `<id>:BC` for the junction
 * diodes and `<id>:CE` for the transport current.
 */
export interface BjtEl {
  kind: 'Q';
  id: string;
  c: number;
  b: number;
  e: number;
  is: number;
  bf: number;
  br: number;
}

/**
 * N-channel MOSFET (square-law model). `k` is the transconductance parameter in A/V²,
 * `vth` the threshold. Reports one result `<id>:DS` (current from drain to source).
 */
export interface MosEl {
  kind: 'M';
  id: string;
  g: number;
  d: number;
  s: number;
  k: number;
  vth: number;
}

export type Element = ResistorEl | SourceEl | DiodeEl | CurrentEl | BjtEl | MosEl;

interface TransportEl {
  kind: 'T';
  id: string;
  c: number;
  b: number;
  e: number;
  is: number;
  be: string;
  bc: string;
}

type Internal = ResistorEl | SourceEl | DiodeEl | CurrentEl | MosEl | TransportEl;

const MOS_LAMBDA = 0.02;
const MOS_MAX_STEP = 0.5;

/** Drain current and its derivatives for vds >= 0. */
function mosEval(k: number, vth: number, vgs: number, vds: number) {
  const vov = vgs - vth;
  if (vov <= 0) return { id: 0, gm: 0, gds: 0 };
  let f: number;
  let fgm: number;
  let fgds: number;
  if (vds < vov) {
    f = k * (vov * vds - (vds * vds) / 2);
    fgm = k * vds;
    fgds = k * (vov - vds);
  } else {
    f = (k / 2) * vov * vov;
    fgm = k * vov;
    fgds = 0;
  }
  const m = 1 + MOS_LAMBDA * vds;
  return { id: f * m, gm: fgm * m, gds: fgds * m + f * MOS_LAMBDA };
}

/** The MOSFET is symmetric: when vds < 0 the source and drain swap roles. */
function mosOrient(vgs: number, vds: number) {
  return vds >= 0 ? { swapped: false, vgs, vds } : { swapped: true, vgs: vgs - vds, vds: -vds };
}

export interface ElementResult {
  id: string;
  /** Current flowing into terminal a and out of terminal b through the element. */
  current: number;
  /** Va - Vb. */
  voltage: number;
}

export interface SolveResult {
  converged: boolean;
  iterations: number;
  /** Voltage per node; the ground node is 0. */
  voltages: number[];
  elements: Map<string, ElementResult>;
}

// exp() that continues linearly beyond x = 40 so Newton steps cannot overflow.
function sexp(x: number): number {
  return x > 40 ? Math.exp(40) * (1 + x - 40) : Math.exp(x);
}
function sexpd(x: number): number {
  return x > 40 ? Math.exp(40) : Math.exp(x);
}

const BREAKDOWN_I = 1e-3;
const BREAKDOWN_VT = 0.03;

export function diodeCurrent(d: DiodeEl, v: number): number {
  let i = d.is * (sexp(v / (d.n * VT)) - 1);
  if (d.vz !== undefined) i -= BREAKDOWN_I * sexp((-v - d.vz) / BREAKDOWN_VT);
  return i;
}

function diodeConductance(d: DiodeEl, v: number): number {
  let g = (d.is / (d.n * VT)) * sexpd(v / (d.n * VT));
  if (d.vz !== undefined) g += (BREAKDOWN_I / BREAKDOWN_VT) * sexpd((-v - d.vz) / BREAKDOWN_VT);
  return g + GMIN;
}

/** Solves A x = b in place by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-30) continue;
    if (piv !== col) {
      [A[piv], A[col]] = [A[col], A[piv]];
      [b[piv], b[col]] = [b[col], b[piv]];
    }
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = Math.abs(A[r][r]) < 1e-30 ? 0 : s / A[r][r];
  }
  return x;
}

function expand(elements: Element[]): Internal[] {
  const out: Internal[] = [];
  for (const e of elements) {
    if (e.kind !== 'Q') {
      out.push(e);
      continue;
    }
    out.push({ kind: 'D', id: `${e.id}:BE`, a: e.b, b: e.e, is: e.is / e.bf, n: 1 });
    out.push({ kind: 'D', id: `${e.id}:BC`, a: e.b, b: e.c, is: e.is / e.br, n: 1 });
    out.push({ kind: 'T', id: `${e.id}:CE`, c: e.c, b: e.b, e: e.e, is: e.is, be: `${e.id}:BE`, bc: `${e.id}:BC` });
  }
  return out;
}

export function solveDC(input: Element[], nodeCount: number, ground: number): SolveResult {
  const elements = expand(input);
  const idx = (node: number) => (node === ground ? -1 : node < ground ? node : node - 1);
  const n = Math.max(0, nodeCount - 1);
  const diodes = elements.filter((e): e is DiodeEl => e.kind === 'D');
  const vd = new Map<string, number>(diodes.map((d) => [d.id, 0]));
  const mos = elements.filter((e): e is MosEl => e.kind === 'M');
  const mosState = new Map<string, { vgs: number; vds: number }>(mos.map((m) => [m.id, { vgs: 0, vds: 0 }]));

  let voltages = new Array<number>(nodeCount).fill(0);
  let converged = false;
  let iterations = 0;

  while (iterations < MAX_ITER) {
    iterations++;
    const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const rhs = new Array<number>(n).fill(0);

    const stampG = (a: number, b: number, g: number) => {
      const ia = idx(a);
      const ib = idx(b);
      if (ia >= 0) A[ia][ia] += g;
      if (ib >= 0) A[ib][ib] += g;
      if (ia >= 0 && ib >= 0) {
        A[ia][ib] -= g;
        A[ib][ia] -= g;
      }
    };
    // Constant current `i` leaving node a and entering node b through the element.
    const stampI = (a: number, b: number, i: number) => {
      const ia = idx(a);
      const ib = idx(b);
      if (ia >= 0) rhs[ia] -= i;
      if (ib >= 0) rhs[ib] += i;
    };

    // Current from p to q through the element equal to g * (V(cp) - V(cn)).
    const stampVccs = (p: number, q: number, cp: number, cn: number, g: number) => {
      const ip = idx(p);
      const iq = idx(q);
      const icp = idx(cp);
      const icn = idx(cn);
      if (ip >= 0) {
        if (icp >= 0) A[ip][icp] += g;
        if (icn >= 0) A[ip][icn] -= g;
      }
      if (iq >= 0) {
        if (icp >= 0) A[iq][icp] -= g;
        if (icn >= 0) A[iq][icn] += g;
      }
    };

    for (let i = 0; i < n; i++) A[i][i] += GMIN;

    for (const e of elements) {
      if (e.kind === 'R') stampG(e.a, e.b, 1 / e.r);
      else if (e.kind === 'V') {
        stampG(e.a, e.b, 1 / e.r);
        stampI(e.a, e.b, -e.v / e.r);
      } else if (e.kind === 'I') {
        stampI(e.a, e.b, e.i);
      } else if (e.kind === 'D') {
        const v0 = vd.get(e.id)!;
        const g = diodeConductance(e, v0);
        stampG(e.a, e.b, g);
        stampI(e.a, e.b, diodeCurrent(e, v0) - g * v0);
      } else if (e.kind === 'T') {
        const vbe = vd.get(e.be)!;
        const vbc = vd.get(e.bc)!;
        const ef = sexp(vbe / VT);
        const er = sexp(vbc / VT);
        const gf = (e.is / VT) * sexpd(vbe / VT);
        const gr = (e.is / VT) * sexpd(vbc / VT);
        stampVccs(e.c, e.e, e.b, e.e, gf);
        stampVccs(e.c, e.e, e.b, e.c, -gr);
        stampI(e.c, e.e, e.is * (ef - er) - gf * vbe + gr * vbc);
      } else {
        const st = mosState.get(e.id)!;
        const o = mosOrient(st.vgs, st.vds);
        const dd = o.swapped ? e.s : e.d;
        const ss = o.swapped ? e.d : e.s;
        const m = mosEval(e.k, e.vth, o.vgs, o.vds);
        stampG(dd, ss, m.gds + GMIN);
        stampVccs(dd, ss, e.g, ss, m.gm);
        stampI(dd, ss, m.id - m.gm * o.vgs - m.gds * o.vds);
      }
    }

    const x = solveLinear(A, rhs);
    voltages = new Array<number>(nodeCount).fill(0);
    for (let node = 0; node < nodeCount; node++) if (node !== ground) voltages[node] = x[idx(node)];

    let maxDelta = 0;
    for (const d of diodes) {
      const vNew = voltages[d.a] - voltages[d.b];
      const vOld = vd.get(d.id)!;
      maxDelta = Math.max(maxDelta, Math.abs(vNew - vOld));
      vd.set(d.id, vOld + Math.max(-MAX_STEP, Math.min(MAX_STEP, vNew - vOld)));
    }
    for (const m of mos) {
      const st = mosState.get(m.id)!;
      const vgsNew = voltages[m.g] - voltages[m.s];
      const vdsNew = voltages[m.d] - voltages[m.s];
      maxDelta = Math.max(maxDelta, Math.abs(vgsNew - st.vgs), Math.abs(vdsNew - st.vds));
      st.vgs += Math.max(-MOS_MAX_STEP, Math.min(MOS_MAX_STEP, vgsNew - st.vgs));
      st.vds += Math.max(-MOS_MAX_STEP, Math.min(MOS_MAX_STEP, vdsNew - st.vds));
    }
    if (maxDelta < TOLERANCE) {
      converged = true;
      break;
    }
  }

  const results = new Map<string, ElementResult>();
  for (const e of elements) {
    if (e.kind === 'T') {
      const vbe = voltages[e.b] - voltages[e.e];
      const vbc = voltages[e.b] - voltages[e.c];
      results.set(e.id, { id: e.id, current: e.is * (sexp(vbe / VT) - sexp(vbc / VT)), voltage: voltages[e.c] - voltages[e.e] });
    } else if (e.kind === 'M') {
      const vds = voltages[e.d] - voltages[e.s];
      const o = mosOrient(voltages[e.g] - voltages[e.s], vds);
      const id = mosEval(e.k, e.vth, o.vgs, o.vds).id;
      results.set(`${e.id}:DS`, { id: `${e.id}:DS`, current: o.swapped ? -id : id, voltage: vds });
    } else {
      const voltage = voltages[e.a] - voltages[e.b];
      let current: number;
      if (e.kind === 'R') current = voltage / e.r;
      else if (e.kind === 'V') current = (voltage - e.v) / e.r;
      else if (e.kind === 'I') current = e.i;
      else current = diodeCurrent(e, voltage);
      results.set(e.id, { id: e.id, current, voltage });
    }
  }
  return { converged, iterations, voltages, elements: results };
}
