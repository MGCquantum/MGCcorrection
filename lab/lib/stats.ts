/** Exact probability and interval formulas used by the theory panels. */

export function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

export function binomPmf(n: number, k: number, p: number): number {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));
}

/**
 * Majority-vote failure of the distance-d repetition code against independent bit flips
 * (code capacity, perfect syndrome measurement): P_L = sum_{k > d/2} C(d,k) p^k (1-p)^(d-k).
 */
export function repetitionLogical(d: number, p: number): number {
  let s = 0;
  for (let k = Math.floor(d / 2) + 1; k <= d; k++) s += binomPmf(d, k, p);
  return s;
}

/** Leading-order term C(d, t+1) p^(t+1) with t = (d-1)/2 correctable errors. */
export function repetitionLeading(d: number, p: number): number {
  const t = (d - 1) / 2;
  return Math.exp(logChoose(d, t + 1)) * Math.pow(p, t + 1);
}

/** 95% Wilson score interval of k/n, z = 1.96 as in aegis.policy.wilson. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const f = k / n, z2 = z * z;
  const centre = (f + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((f * (1 - f)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Per-cycle rate from a whole-experiment failure fraction: 1 - (1 - P)^(1/cycles). */
export const perCycle = (P: number, cycles = 12) => 1 - Math.pow(1 - P, 1 / cycles);

export function fmtSci(x: number | null | undefined, digits = 2, force = false): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  if (x === 0) return "0";
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (!force && e >= -2 && e <= 3) return x.toPrecision(digits + 1).replace(/\.?0+$/, (m) => (m.includes(".") ? "" : m));
  const m = x / Math.pow(10, e);
  return `${m.toFixed(digits)}×10${toSup(e)}`;
}

const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
export const toSup = (n: number) => String(n).split("").map((ch) => SUP[ch] ?? ch).join("");

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${ms.toFixed(0)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  return `${ms.toFixed(2)} ms`;
}

export const fmtPct = (x: number, digits = 1) => `${(100 * x).toFixed(digits)}%`;
export const fmtInt = (x: number) => x.toLocaleString("en-US");
