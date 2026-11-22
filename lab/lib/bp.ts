/**
 * Min-sum belief propagation, its memory (DMem) variant, a relay ensemble and OSD-0, on small
 * parity-check matrices. This is an in-browser ILLUSTRATION of the update equations. The
 * production decoders (ldpc's BP-OSD, relay-bp) run in the Python backend on the Gross-code DEM.
 */
import { matvec, weight, solveInOrder, type Bits, type Matrix } from "./gf2";
import { mulberry32 } from "./rng";

export type BPIteration = {
  t: number;
  posterior: number[];            // Lambda_v
  hard: Bits;                     // e_v = [Lambda_v < 0]
  residual: number;               // weight of H e + s
  converged: boolean;
  c2v: number[][];                // c2v[c][v] (NaN where H[c][v] = 0)
};

export const llr = (p: number) => Math.log((1 - p) / p);

/**
 * Run min-sum BP with syndrome s. gamma (per variable) enables memory:
 *   lambda~_v(t) = (1 - gamma_v) lambda_v + gamma_v Lambda_v(t-1).  gamma = 0 is plain min-sum.
 */
export function minSum(H: Matrix, s: Bits, priors: number[], opts: { iters: number; alpha?: number; gamma?: number[]; start?: number[] }) {
  const m = H.length, n = H[0].length, alpha = opts.alpha ?? 1.0;
  const lam = priors.map(llr);
  const gamma = opts.gamma ?? new Array(n).fill(0);
  const nbrC = H.map((row) => row.flatMap((h, v) => (h ? [v] : [])));
  const nbrV = Array.from({ length: n }, (_, v) => H.flatMap((row, c) => (row[v] ? [c] : [])));
  let post = opts.start ? [...opts.start] : [...lam];
  const v2c: number[][] = H.map((row) => row.map((h, v) => (h ? lam[v] : NaN)));
  const c2v: number[][] = H.map((row) => row.map((h) => (h ? 0 : NaN)));
  const history: BPIteration[] = [];
  for (let t = 1; t <= opts.iters; t++) {
    for (let cc = 0; cc < m; cc++) {
      for (const v of nbrC[cc]) {
        let sign = s[cc] ? -1 : 1, mn = Infinity;
        for (const u of nbrC[cc]) if (u !== v) { const x = v2c[cc][u]; sign *= x < 0 ? -1 : 1; mn = Math.min(mn, Math.abs(x)); }
        c2v[cc][v] = sign * alpha * (mn === Infinity ? 0 : mn);
      }
    }
    const prior = lam.map((l, v) => (1 - gamma[v]) * l + gamma[v] * post[v]);
    post = prior.map((p, v) => p + nbrV[v].reduce((acc, cc) => acc + c2v[cc][v], 0));
    for (let cc = 0; cc < m; cc++) for (const v of nbrC[cc]) v2c[cc][v] = post[v] - c2v[cc][v];
    const hard = post.map((x) => (x < 0 ? 1 : 0));
    const res = matvec(H, hard).map((x, i) => x ^ s[i]);
    const converged = weight(res) === 0;
    history.push({ t, posterior: [...post], hard, residual: weight(res), converged, c2v: c2v.map((r) => [...r]) });
    if (converged) break;
  }
  return history;
}

export const solutionWeight = (e: Bits, priors: number[]) => e.reduce((acc, x, v) => acc + (x ? llr(priors[v]) : 0), 0);

export type RelayLeg = { leg: number; gamma: number[]; iterations: number; converged: boolean; solution: Bits | null; weight: number | null };

/**
 * Relay-BP: a first leg of memory BP with uniform gamma0, then legs whose gamma_v are drawn from an
 * interval (negative values allowed), each leg starting from the previous leg's posteriors. Every
 * converged leg contributes a solution; after `stopAfter` solutions the lightest is returned.
 */
export function relayBP(H: Matrix, s: Bits, priors: number[], o: {
  gamma0: number; preIter: number; legs: number; legIter: number; interval: [number, number]; stopAfter: number; seed: number;
}) {
  const n = H[0].length, rnd = mulberry32(o.seed);
  const legs: RelayLeg[] = [];
  let start: number[] | undefined;
  for (let leg = 0; leg <= o.legs; leg++) {
    const gamma = leg === 0 ? new Array(n).fill(o.gamma0) : Array.from({ length: n }, () => o.interval[0] + (o.interval[1] - o.interval[0]) * rnd());
    const hist = minSum(H, s, priors, { iters: leg === 0 ? o.preIter : o.legIter, gamma, start });
    const last = hist[hist.length - 1];
    start = last.posterior;
    legs.push({ leg, gamma, iterations: hist.length, converged: last.converged,
      solution: last.converged ? last.hard : null, weight: last.converged ? solutionWeight(last.hard, priors) : null });
    if (legs.filter((l) => l.converged).length >= o.stopAfter) break;
  }
  const best = legs.filter((l) => l.converged).sort((a, b) => (a.weight! - b.weight!))[0] ?? null;
  return { legs, best };
}

/**
 * OSD-0: order the columns from most to least likely flipped according to BP's posteriors,
 * take the first independent columns as the information set, solve H e = s there.
 */
export function osd0(H: Matrix, s: Bits, posterior: number[]) {
  const order = posterior.map((x, v) => [x, v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const sol = solveInOrder(H, s, order);
  return sol ? { e: sol.e, pivots: sol.pivots, order } : null;
}
