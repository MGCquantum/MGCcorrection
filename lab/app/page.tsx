import Link from "next/link";
import { MODULES } from "@/lib/modules";
import { Provenance, type Source } from "@/components/Provenance";
import { TeX } from "@/components/TeX";

const KEY: [Source, string][] = [
  ["theory", "Closed-form results (Born rule, binomial sums, GF(2) algebra) evaluated in your browser. Exact, no sampling."],
  ["illustration", "A worked algorithm on a small matrix, run in your browser to show the update equations. Never presented as a production result."],
  ["live", "Computed on request by a local Python backend: Stim and Qiskit Aer sample circuits, PyMatching, ldpc and relay-bp decode."],
  ["stored", "Read from result files this project wrote earlier (per-shot records, validation studies). The figure states how and when."],
  ["reference", "Copied from a cited source, such as the starter kit's README. Not measured on this machine."],
  ["hardware", "One archived IBM Quantum job, verified by SHA-256 checksums and re-decoded from disk. Nothing is ever submitted."],
];

export default function Home() {
  return (
    <div className="max-w-[1120px]">
      <header className="border-b border-rule pb-10">
        <div className="font-sans text-[12px] font-semibold uppercase tracking-[0.16em] text-accent">MidQwest 2026 · Quantum error correction</div>
        <h1 className="mt-3 max-w-[48rem] font-serif text-[3rem] font-semibold leading-[1.06] tracking-[-0.015em] text-navy">
          From a single qubit to decoding the Gross code
        </h1>
        <div className="prose-lab mt-6 max-w-[46rem] text-[1.2rem]">
          <p>
            A quantum memory fails when noise moves the stored state out of the code space in a way the decoder cannot undo.
            This laboratory builds that sentence up from first principles. It starts with the Pauli operators and the Born rule,
            derives syndromes from stabilizers, and ends with the [[144,12,12]] bivariate bicycle code, where decoding means solving{" "}
            <TeX>{"H\\,e = s \\pmod 2"}</TeX> on a 936 × 8784 matrix in a few milliseconds.
          </p>
          <p>
            Every number is labeled with where it came from. Theory is computed exactly in the page. Simulations run on the two local
            Python backends that already power this project. Stored results say how and when they were measured. The one hardware run
            is kept apart, read-only.
          </p>
        </div>
      </header>

      <section className="mt-12" aria-labelledby="progression">
        <h2 id="progression" className="font-serif text-[1.6rem] font-semibold text-navy">The progression</h2>
        <ol className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-rule bg-rule md:grid-cols-2">
          {MODULES.map((m) => (
            <li key={m.slug} className="bg-panel">
              <Link href={`/${m.slug}`} className="group block h-full p-5 hover:bg-sunken/60">
                <div className="flex items-baseline gap-3">
                  <span className="num text-[13px] text-accent">{String(m.n).padStart(2, "0")}</span>
                  <span className="font-serif text-[1.2rem] font-semibold text-navy group-hover:underline group-hover:underline-offset-4">{m.title}</span>
                </div>
                <p className="mt-2 pl-8 font-serif text-[15px] leading-relaxed text-ink-2">{m.blurb}</p>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16" aria-labelledby="provenance">
        <h2 id="provenance" className="font-serif text-[1.6rem] font-semibold text-navy">How to read a number here</h2>
        <dl className="mt-6 grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
          {KEY.map(([s, text]) => (
            <div key={s} className="flex flex-col gap-1.5">
              <dt><Provenance source={s} /></dt>
              <dd className="font-serif text-[15px] leading-relaxed text-ink-2">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-16" aria-labelledby="architecture">
        <h2 id="architecture" className="font-serif text-[1.6rem] font-semibold text-navy">Architecture</h2>
        <p className="prose-lab mt-3 max-w-[46rem]">
          The lab is a Next.js frontend with no simulation code of its own. It reaches two independent backends through same-origin
          proxies. They live in different repositories and share no code.
        </p>
        <Architecture />
      </section>
    </div>
  );
}

function Architecture() {
  const box = "fill-[var(--panel)] stroke-[var(--rule-strong)]";
  return (
    <svg viewBox="0 0 1000 330" className="mt-6 w-full max-w-[1000px]" role="img"
      aria-label="Browser talks to the Next.js lab on port 3000, which proxies /api/aegis to the QEC-Aegis server on port 8765 and /api/sim to the FastAPI simulation server on port 8000.">
      <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" /></marker></defs>
      <g fontFamily="var(--font-inter)" fontSize="13" fill="var(--ink)">
        <rect x="10" y="125" width="170" height="80" rx="6" className={box} />
        <text x="95" y="158" textAnchor="middle" fontWeight="600">Browser</text>
        <text x="95" y="178" textAnchor="middle" fontSize="12" fill="var(--muted)">exact theory, illustrations</text>

        <rect x="250" y="105" width="230" height="120" rx="6" className={box} />
        <text x="365" y="138" textAnchor="middle" fontWeight="600">Next.js lab · :3100</text>
        <text x="365" y="160" textAnchor="middle" fontSize="12" fill="var(--muted)">MidQWest-2026/lab</text>
        <text x="365" y="185" textAnchor="middle" fontSize="12" fill="var(--muted)">/api/aegis/* → :8765</text>
        <text x="365" y="203" textAnchor="middle" fontSize="12" fill="var(--muted)">/api/sim/* → :8000</text>

        <rect x="560" y="20" width="420" height="125" rx="6" className={box} />
        <text x="580" y="48" fontWeight="600">QEC-Aegis server · :8765 (Python stdlib http)</text>
        <text x="580" y="70" fontSize="12" fill="var(--muted)">repo MidQWest-2026 · dashboard/server.py</text>
        <text x="580" y="92" fontSize="12" fill="var(--ink-2)">Gross [[144,12,12]] circuits (Stim), BP-OSD (ldpc), relay-BP,</text>
        <text x="580" y="110" fontSize="12" fill="var(--ink-2)">QEC-Aegis router · experiments/records, manifest</text>
        <text x="580" y="128" fontSize="12" fill="var(--ink-2)">new read-only: /gross/structure, /records, /manifest, /calibration</text>

        <rect x="560" y="185" width="420" height="125" rx="6" className={box} />
        <text x="580" y="213" fontWeight="600">Simulation server · :8000 (FastAPI)</text>
        <text x="580" y="235" fontSize="12" fill="var(--muted)">repo MidQwest · dashboard/server.py</text>
        <text x="580" y="257" fontSize="12" fill="var(--ink-2)">repetition + rotated surface code d = 3, 5 · Qiskit Aer, Stim,</text>
        <text x="580" y="275" fontSize="12" fill="var(--ink-2)">PyMatching · ibm_kingston archive (read-only, checksummed)</text>
        <text x="580" y="293" fontSize="12" fill="var(--ink-2)">new: /matching-graph, /decode-syndrome (PyMatching)</text>
      </g>
      <g stroke="var(--muted)" strokeWidth="1.5" fill="none" markerEnd="url(#arr)">
        <line x1="180" y1="165" x2="246" y2="165" />
        <path d="M480 145 C 520 145, 520 85, 556 85" />
        <path d="M480 185 C 520 185, 520 245, 556 245" />
      </g>
    </svg>
  );
}
