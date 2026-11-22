import { describe, expect, it } from "vitest";
import { BELL, GATES, apply, applyChannel, bloch, corr, kron, PAULI1, stateFromAngles, whichBell, probPlus, I2 } from "@/lib/quantum";

const close = (a: number, b: number, eps = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("single qubit", () => {
  it("Bloch vector of cos(t/2)|0> + e^{ip} sin(t/2)|1>", () => {
    const t = 1.1, p = 2.3, r = bloch(stateFromAngles(t, p));
    close(r[0], Math.sin(t) * Math.cos(p)); close(r[1], Math.sin(t) * Math.sin(p)); close(r[2], Math.cos(t));
  });
  it("Paulis rotate the Bloch vector by pi", () => {
    const r = bloch(stateFromAngles(0.7, 0.4));
    const rx = bloch(apply(GATES.X, stateFromAngles(0.7, 0.4)));
    const ry = bloch(apply(GATES.Y, stateFromAngles(0.7, 0.4)));
    const rz = bloch(apply(GATES.Z, stateFromAngles(0.7, 0.4)));
    [[rx, [r[0], -r[1], -r[2]]], [ry, [-r[0], r[1], -r[2]]], [rz, [-r[0], -r[1], r[2]]]].forEach(([a, b]) => a.forEach((x, i) => close(x, b[i])));
  });
  it("Hadamard maps |0> to |+>", () => {
    const r = bloch(apply(GATES.H, stateFromAngles(0, 0)));
    close(r[0], 1); close(r[2], 0); close(probPlus(r, "X"), 1); close(probPlus(r, "Z"), 0.5);
  });
});

describe("Bell states", () => {
  it("stabilizers of Phi+ are XX = +1, ZZ = +1, YY = -1, local Paulis average to 0", () => {
    const v = BELL["Φ+"];
    close(corr(v, "X", "X"), 1); close(corr(v, "Z", "Z"), 1); close(corr(v, "Y", "Y"), -1);
    close(corr(v, "Z", "I"), 0); close(corr(v, "X", "I"), 0);
  });
  it("X on A flips ZZ, Z on A flips XX, Y flips both", () => {
    const XA = kron(PAULI1.X, I2), ZA = kron(PAULI1.Z, I2), YA = kron(PAULI1.Y, I2);
    expect(whichBell(apply(XA, BELL["Φ+"]))).toBe("Ψ+");
    expect(whichBell(apply(ZA, BELL["Φ+"]))).toBe("Φ−");
    expect(whichBell(apply(YA, BELL["Φ+"]))).toBe("Ψ−");
    close(corr(apply(XA, BELL["Φ+"]), "Z", "Z"), -1); close(corr(apply(ZA, BELL["Φ+"]), "X", "X"), -1);
  });
});

describe("channels", () => {
  it("depolarizing shrinks the Bloch vector by 1 - 4p/3", () => {
    const r = applyChannel("depolarizing", 0.3, [0, 0, 1]); close(r[2], 1 - 0.4);
  });
  it("amplitude damping drives every state to |0>", () => {
    const r = applyChannel("amplitude-damping", 0.2, [1, 0, 0], 200); close(r[2], 1, 1e-9); close(r[0], 0, 1e-9);
  });
  it("bit flip leaves x alone and scales y, z", () => {
    const r = applyChannel("bit-flip", 0.1, [0.6, 0, 0.8]); close(r[0], 0.6); close(r[2], 0.8 * 0.8);
  });
});

describe("foundations: normalization, Born rule, Pauli algebra, physical channels", () => {
  const mm = (a: import("@/lib/quantum").Mat, b: import("@/lib/quantum").Mat) =>
    a.map((row, i) => b[0].map((_, j) => row.reduce((s, _x, k) => {
      const p = { re: a[i][k].re * b[k][j].re - a[i][k].im * b[k][j].im, im: a[i][k].re * b[k][j].im + a[i][k].im * b[k][j].re };
      return { re: s.re + p.re, im: s.im + p.im };
    }, { re: 0, im: 0 })));
  it("every state from angles and every Bell state is normalized, and gates preserve the norm", () => {
    for (let t = 0; t <= Math.PI; t += 0.37) for (let p = 0; p < 2 * Math.PI; p += 0.71) {
      const v = stateFromAngles(t, p);
      close(v.reduce((s, a) => s + a.re * a.re + a.im * a.im, 0), 1);
      for (const g of Object.values(GATES)) close(apply(g, v).reduce((s, a) => s + a.re * a.re + a.im * a.im, 0), 1);
    }
    for (const v of Object.values(BELL)) close(v.reduce((s, a) => s + a.re * a.re + a.im * a.im, 0), 1);
  });
  it("Born rule: P(+1 along an axis) = (1 + r_axis)/2 equals |<+axis|psi>|^2", () => {
    const t = 0.8, p = 1.9, v = stateFromAngles(t, p);
    close(probPlus(bloch(v), "Z"), v[0].re ** 2 + v[0].im ** 2);
    const plus = apply(GATES.H, v);                              // <+|psi> is the |0> amplitude of H|psi>
    close(probPlus(bloch(v), "X"), plus[0].re ** 2 + plus[0].im ** 2);
  });
  it("Paulis square to I, anticommute, and XY = iZ", () => {
    const { X, Y, Z } = GATES;
    for (const P of [X, Y, Z]) { const sq = mm(P, P); close(sq[0][0].re, 1); close(sq[1][1].re, 1); close(sq[0][1].re, 0); }
    const xy = mm(X, Y), yx = mm(Y, X);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { close(xy[i][j].re + yx[i][j].re, 0); close(xy[i][j].im + yx[i][j].im, 0); }
    close(xy[0][0].im, 1); close(xy[1][1].im, -1);              // XY = iZ
  });
  it("channels never push a state outside the Bloch ball (complete positivity bound)", () => {
    for (const ch of ["bit-flip", "phase-flip", "depolarizing", "amplitude-damping"] as const)
      for (const p of [0, 0.1, 0.5, 0.9, 1])
        for (const r of [[0, 0, 1], [1, 0, 0], [0, -1, 0], [0.6, 0, -0.8]] as [number, number, number][])
          expect(Math.hypot(...applyChannel(ch, p, r))).toBeLessThanOrEqual(1 + 1e-12);
  });
});
