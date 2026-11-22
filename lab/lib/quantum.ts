/**
 * Exact single- and two-qubit quantum mechanics for Module 1. Everything here is closed-form
 * linear algebra on state vectors and Bloch vectors; nothing is sampled unless a function says so.
 */

export type C = { re: number; im: number };
export const c = (re: number, im = 0): C => ({ re, im });
export const add = (a: C, b: C): C => c(a.re + b.re, a.im + b.im);
export const mul = (a: C, b: C): C => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const conj = (a: C): C => c(a.re, -a.im);
export const abs2 = (a: C) => a.re * a.re + a.im * a.im;
export const scale = (a: C, s: number): C => c(a.re * s, a.im * s);

export type Vec = C[];
export type Mat = C[][];
export type Vec3 = [number, number, number];

export const I2: Mat = [[c(1), c(0)], [c(0), c(1)]];
export const X: Mat = [[c(0), c(1)], [c(1), c(0)]];
export const Y: Mat = [[c(0), c(0, -1)], [c(0, 1), c(0)]];
export const Z: Mat = [[c(1), c(0)], [c(0), c(-1)]];
const s2 = Math.SQRT1_2;
export const H: Mat = [[c(s2), c(s2)], [c(s2), c(-s2)]];
export const S: Mat = [[c(1), c(0)], [c(0), c(0, 1)]];
export const GATES = { X, Y, Z, H, S } as const;
export type GateName = keyof typeof GATES;

export function apply(m: Mat, v: Vec): Vec {
  return m.map((row) => row.reduce((acc, a, j) => add(acc, mul(a, v[j])), c(0)));
}

export function kron(a: Mat, b: Mat): Mat {
  const out: Mat = [];
  for (let i = 0; i < a.length; i++) for (let k = 0; k < b.length; k++) {
    const row: C[] = [];
    for (let j = 0; j < a[0].length; j++) for (let l = 0; l < b[0].length; l++) row.push(mul(a[i][j], b[k][l]));
    out.push(row);
  }
  return out;
}

/** |psi> = cos(theta/2)|0> + e^{i phi} sin(theta/2)|1>. */
export function stateFromAngles(theta: number, phi: number): Vec {
  return [c(Math.cos(theta / 2)), scale(c(Math.cos(phi), Math.sin(phi)), Math.sin(theta / 2))];
}

/** Bloch vector r_i = <psi| sigma_i |psi>. */
export function bloch(v: Vec): Vec3 {
  const [a, b] = v;
  const ab = mul(conj(a), b);            // a* b
  return [2 * ab.re, 2 * ab.im, abs2(a) - abs2(b)];
}

/** Angles (theta, phi) of a pure state's Bloch vector. */
export function angles(r: Vec3): [number, number] {
  const theta = Math.acos(Math.max(-1, Math.min(1, r[2])));
  let phi = Math.atan2(r[1], r[0]);
  if (phi < 0) phi += 2 * Math.PI;
  return [theta, phi];
}

/** Born rule in the eigenbasis of X, Y or Z: P(+1) = (1 + r_axis)/2. */
export function probPlus(r: Vec3, axis: "X" | "Y" | "Z") {
  return (1 + r[{ X: 0, Y: 1, Z: 2 }[axis]]) / 2;
}

/** Remove the global phase so amplitudes display canonically (first nonzero amplitude real, >= 0). */
export function canonical(v: Vec): Vec {
  const k = v.findIndex((a) => abs2(a) > 1e-12);
  if (k < 0) return v;
  const ph = Math.atan2(v[k].im, v[k].re);
  const rot = c(Math.cos(-ph), Math.sin(-ph));
  return v.map((a) => { const r = mul(a, rot); return c(Math.abs(r.re) < 1e-12 ? 0 : r.re, Math.abs(r.im) < 1e-12 ? 0 : r.im); });
}

export function fmtC(a: C, digits = 3): string {
  const re = Math.abs(a.re) < 5e-13 ? 0 : a.re, im = Math.abs(a.im) < 5e-13 ? 0 : a.im;
  if (im === 0) return re.toFixed(digits);
  if (re === 0) return `${im.toFixed(digits)}i`;
  return `${re.toFixed(digits)} ${im < 0 ? "−" : "+"} ${Math.abs(im).toFixed(digits)}i`;
}

// ---------------------------------------------------------------- two qubits (order |q_A q_B>)
export const BELL: Record<string, Vec> = {
  "Φ+": [c(s2), c(0), c(0), c(s2)],
  "Φ−": [c(s2), c(0), c(0), c(-s2)],
  "Ψ+": [c(0), c(s2), c(s2), c(0)],
  "Ψ−": [c(0), c(s2), c(-s2), c(0)],
};

export function expectation(m: Mat, v: Vec): number {
  const mv = apply(m, v);
  return v.reduce((acc, a, i) => acc + mul(conj(a), mv[i]).re, 0);
}

export const PAULI1: Record<"I" | "X" | "Y" | "Z", Mat> = { I: I2, X, Y, Z };

/** <P_A ⊗ P_B> for a two-qubit state. */
export function corr(v: Vec, a: keyof typeof PAULI1, b: keyof typeof PAULI1) {
  return expectation(kron(PAULI1[a], PAULI1[b]), v);
}

/** Which Bell state (up to global phase) a two-qubit vector is, or null. */
export function whichBell(v: Vec): string | null {
  for (const [name, b] of Object.entries(BELL)) {
    const overlap = v.reduce((acc, a, i) => add(acc, mul(conj(b[i]), a)), c(0));
    if (abs2(overlap) > 1 - 1e-9) return name;
  }
  return null;
}

/** Joint outcome probabilities of measuring both qubits in the Z basis: [P00, P01, P10, P11]. */
export function jointZ(v: Vec): number[] { return v.map(abs2); }

// ---------------------------------------------------------------- noise channels on the Bloch ball
export type Channel = "bit-flip" | "phase-flip" | "depolarizing" | "amplitude-damping";

/**
 * Affine action r -> M r + t of a single-qubit channel on the Bloch vector.
 *   bit flip      rho -> (1-p) rho + p X rho X                  : (x, (1-2p) y, (1-2p) z)
 *   phase flip    rho -> (1-p) rho + p Z rho Z                  : ((1-2p) x, (1-2p) y, z)
 *   depolarizing  rho -> (1-p) rho + p/3 (XrhoX + YrhoY + ZrhoZ) : (1 - 4p/3) r
 *   amplitude damping with gamma                                : (sqrt(1-g) x, sqrt(1-g) y, g + (1-g) z)
 */
export function channelMap(ch: Channel, p: number): { diag: Vec3; shift: Vec3 } {
  switch (ch) {
    case "bit-flip": return { diag: [1, 1 - 2 * p, 1 - 2 * p], shift: [0, 0, 0] };
    case "phase-flip": return { diag: [1 - 2 * p, 1 - 2 * p, 1], shift: [0, 0, 0] };
    case "depolarizing": return { diag: [1 - (4 * p) / 3, 1 - (4 * p) / 3, 1 - (4 * p) / 3], shift: [0, 0, 0] };
    case "amplitude-damping": { const s = Math.sqrt(1 - p); return { diag: [s, s, 1 - p], shift: [0, 0, p] }; }
  }
}

export function applyChannel(ch: Channel, p: number, r: Vec3, times = 1): Vec3 {
  let out: Vec3 = [...r];
  const { diag, shift } = channelMap(ch, p);
  for (let k = 0; k < times; k++) out = [diag[0] * out[0] + shift[0], diag[1] * out[1] + shift[1], diag[2] * out[2] + shift[2]];
  return out;
}

export const norm3 = (r: Vec3) => Math.hypot(r[0], r[1], r[2]);

/** Fidelity of a (possibly mixed) state with Bloch vector s against pure state with Bloch vector r. */
export function fidelityPure(r: Vec3, s: Vec3) { return (1 + r[0] * s[0] + r[1] * s[1] + r[2] * s[2]) / 2; }
