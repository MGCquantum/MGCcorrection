import { describe, expect, it } from "vitest";
import { repetitionLogical, repetitionLeading, wilson, binomPmf, perCycle } from "@/lib/stats";
import { matvec, rank, solveInOrder } from "@/lib/gf2";
import { minSum, osd0, relayBP } from "@/lib/bp";

describe("repetition code (code capacity)", () => {
  it("d = 3: P_L = 3p^2 - 2p^3", () => {
    for (const p of [0.01, 0.1, 0.3]) expect(repetitionLogical(3, p)).toBeCloseTo(3 * p * p - 2 * p ** 3, 14);
  });
  it("P_L = 1/2 at p = 1/2 for every odd d, and below p for p < 1/2", () => {
    for (const d of [3, 5, 7, 9]) { expect(repetitionLogical(d, 0.5)).toBeCloseTo(0.5, 12); expect(repetitionLogical(d, 0.2)).toBeLessThan(0.2); }
  });
  it("leading term dominates at small p", () => {
    expect(repetitionLogical(5, 1e-4) / repetitionLeading(5, 1e-4)).toBeCloseTo(1, 3);
  });
  it("binomial pmf sums to one", () => {
    expect(Array.from({ length: 8 }, (_, k) => binomPmf(7, k, 0.37)).reduce((a, b) => a + b)).toBeCloseTo(1, 12);
  });
});

describe("statistics", () => {
  it("Wilson interval matches aegis.policy.wilson for 3 of 4000", () => {
    // Python: aegis.policy.wilson(3, 4000) = (0.0002550951115929764, 0.0022029441874642083)
    const [lo, hi] = wilson(3, 4000);
    expect(lo).toBeCloseTo(0.0002550951115929764, 12); expect(hi).toBeCloseTo(0.0022029441874642083, 12);
  });
  it("per-cycle rate inverts (1 - r)^12", () => {
    const r = perCycle(0.05); expect(1 - (1 - r) ** 12).toBeCloseTo(0.05, 14);
  });
});

const HAMMING = [[1, 0, 1, 0, 1, 0, 1], [0, 1, 1, 0, 0, 1, 1], [0, 0, 0, 1, 1, 1, 1]];

describe("GF(2) and decoding illustrations", () => {
  it("Hamming(7,4) check matrix has rank 3; every single error has a distinct syndrome", () => {
    expect(rank(HAMMING)).toBe(3);
    const syn = new Set(Array.from({ length: 7 }, (_, v) => matvec(HAMMING, Array.from({ length: 7 }, (_, j) => +(j === v))).join("")));
    expect(syn.size).toBe(7);
  });
  it("solveInOrder returns a solution of H e = s", () => {
    const s = [1, 0, 1];
    const sol = solveInOrder(HAMMING, s, [6, 5, 4, 3, 2, 1, 0])!;
    expect(matvec(HAMMING, sol.e)).toEqual(s);
  });
  it("min-sum BP corrects any single error of the Hamming code", () => {
    for (let v = 0; v < 7; v++) {
      const e = Array.from({ length: 7 }, (_, j) => +(j === v));
      const hist = minSum(HAMMING, matvec(HAMMING, e), new Array(7).fill(0.05), { iters: 20 });
      const last = hist[hist.length - 1];
      expect(last.converged).toBe(true);
      expect(matvec(HAMMING, last.hard)).toEqual(matvec(HAMMING, e));
    }
  });
  it("OSD-0 always explains the syndrome", () => {
    const s = [1, 1, 1];
    const hist = minSum(HAMMING, s, new Array(7).fill(0.05), { iters: 3 });
    const sol = osd0(HAMMING, s, hist[hist.length - 1].posterior)!;
    expect(matvec(HAMMING, sol.e)).toEqual(s);
  });
  it("relay-BP returns the lightest converged solution", () => {
    const s = matvec(HAMMING, [1, 1, 0, 0, 0, 0, 0]);
    const out = relayBP(HAMMING, s, new Array(7).fill(0.05), { gamma0: 0.15, preIter: 20, legs: 10, legIter: 15, interval: [-0.226, 0.622], stopAfter: 3, seed: 1 });
    expect(out.best).not.toBeNull();
    expect(matvec(HAMMING, out.best!.solution!)).toEqual(s);
  });
});

import { toric } from "@/lib/toycodes";
describe("toric code illustration", () => {
  const H = toric(3);
  it("every edge touches two vertices; rank is V - 1", () => {
    for (let e = 0; e < 18; e++) expect(H.reduce((s, r) => s + r[e], 0)).toBe(2);
    expect(rank(H)).toBe(8);
  });
  it("plain BP does not converge on a degenerate pair of defects, OSD-0 resolves it", () => {
    const s = new Array(9).fill(0); s[0] = 1; s[4] = 1;          // vertices (0,0) and (1,1): two weight-2 paths tie
    const hist = minSum(H, s, new Array(18).fill(0.05), { iters: 60 });
    expect(hist[hist.length - 1].converged).toBe(false);
    const sol = osd0(H, s, hist[hist.length - 1].posterior)!;
    expect(matvec(H, sol.e)).toEqual(s);
  });
});
