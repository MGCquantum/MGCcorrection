/** Small parity-check matrices for the decoder illustrations in Module 5. */
import type { Matrix } from "./gf2";

export const HAMMING: Matrix = [
  [1, 0, 1, 0, 1, 0, 1],
  [0, 1, 1, 0, 0, 1, 1],
  [0, 0, 0, 1, 1, 1, 1],
];

/**
 * Toric code of size L: qubits on the 2L^2 edges of an L x L torus, one check per vertex
 * (the vertex-edge incidence matrix). Bit flips on edges light the endpoints of the error chains.
 * Edge order: horizontal h(i,j) = i*L + j joins (i,j)-(i,j+1); vertical v(i,j) = L^2 + i*L + j joins (i,j)-(i+1,j).
 */
export function toric(L: number): Matrix {
  const V = L * L, E = 2 * V;
  const H: Matrix = Array.from({ length: V }, () => new Array(E).fill(0));
  const vid = (i: number, j: number) => ((i + L) % L) * L + ((j + L) % L);
  for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) {
    const h = i * L + j, v = V + i * L + j;
    H[vid(i, j)][h] = 1; H[vid(i, j + 1)][h] = 1;
    H[vid(i, j)][v] = 1; H[vid(i + 1, j)][v] = 1;
  }
  return H;
}
