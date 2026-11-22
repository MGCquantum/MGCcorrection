/** Linear algebra over GF(2) on small dense 0/1 matrices (rows of numbers). */
export type Bits = number[];
export type Matrix = Bits[];

export const matvec = (H: Matrix, e: Bits): Bits => H.map((row) => row.reduce((acc, h, j) => acc ^ (h & e[j]), 0));
export const xor = (a: Bits, b: Bits): Bits => a.map((x, i) => x ^ b[i]);
export const weight = (a: Bits) => a.reduce((s, x) => s + x, 0);

/** Rank over GF(2). */
export function rank(M: Matrix): number {
  const A = M.map((r) => [...r]);
  let r = 0;
  const cols = A[0]?.length ?? 0;
  for (let col = 0; col < cols && r < A.length; col++) {
    const piv = A.findIndex((row, i) => i >= r && row[col] === 1);
    if (piv < 0) continue;
    [A[r], A[piv]] = [A[piv], A[r]];
    for (let i = 0; i < A.length; i++) if (i !== r && A[i][col]) A[i] = xor(A[i], A[r]);
    r++;
  }
  return r;
}

/**
 * Solve H e = s restricted to the columns in `order`, taking pivots greedily in that order
 * (the first rank(H) independent columns form the information set). Unused columns are 0.
 * Returns null when s is not in the column space.
 */
export function solveInOrder(H: Matrix, s: Bits, order: number[]): { e: Bits; pivots: number[] } | null {
  const m = H.length, n = H[0].length;
  const A = H.map((row, i) => [...order.map((j) => row[j]), s[i]]);   // columns permuted, s appended
  const pivots: number[] = [];
  let r = 0;
  for (let k = 0; k < n && r < m; k++) {
    const piv = A.findIndex((row, i) => i >= r && row[k] === 1);
    if (piv < 0) continue;
    [A[r], A[piv]] = [A[piv], A[r]];
    for (let i = 0; i < m; i++) if (i !== r && A[i][k]) A[i] = xor(A[i], A[r]);
    pivots.push(k); r++;
  }
  for (let i = r; i < m; i++) if (A[i][n]) return null;
  const e = new Array(n).fill(0);
  pivots.forEach((k, i) => { e[order[k]] = A[i][n]; });
  return { e, pivots: pivots.map((k) => order[k]) };
}
