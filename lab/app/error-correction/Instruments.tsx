"use client";
import { useEffect, useMemo, useState } from "react";
import { Plot } from "@/components/charts/Plot";
import { Button, ErrorBox, Loading, NumberField, Segmented, Select, Stat } from "@/components/Controls";
import { Panel } from "@/components/Layout";
import { Provenance } from "@/components/Provenance";
import { TeX } from "@/components/TeX";
import { SIM, useGet, useRun } from "@/lib/api";
import { CircuitDiagram, CompileMetrics, type Drawing } from "@/components/Circuit";
import { matvec, weight } from "@/lib/gf2";
import { fmtSci, repetitionLeading, repetitionLogical } from "@/lib/stats";

// ---------------------------------------------------------------- exact code-capacity curve
export function RepetitionCurve() {
  const ps = Array.from({ length: 41 }, (_, i) => Math.pow(10, -3 + (i / 40) * Math.log10(0.5 / 1e-3)));
  const colors = ["var(--muted)", "var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
  const series = [1, 3, 5, 7, 9].map((d, k) => ({
    id: `d${d}`, label: d === 1 ? "unencoded (d = 1)" : `d = ${d}`, color: colors[k], dashed: d === 1,
    points: ps.map((p) => ({ x: p, y: repetitionLogical(d, p), note: d > 1 ? `leading term ${fmtSci(repetitionLeading(d, p))}` : undefined })),
  }));
  return (
    <Panel title="Majority vote against independent bit flips" source={<Provenance source="theory" />} testid="rep-curve">
      <Plot series={series} xLabel="physical bit-flip probability p" yLabel="logical failure P_L" yDomain={[1e-14, 0.7]} xDomain={[1e-3, 0.5]}
        ariaLabel="Logical failure probability of the repetition code against physical bit-flip probability, for distances 1 to 9" />
      <p className="mt-3 font-sans text-[12.5px] leading-relaxed text-muted">
        Exact binomial sums (eq. 2.2). On log-log axes the slope of each curve at small p is <TeX>{"t+1=(d+1)/2"}</TeX>, the number of flips needed
        to fool the majority. Every curve passes through P<sub>L</sub> = ½ at p = ½. Below that, adding qubits always helps: this is the threshold of
        this idealized model. Code capacity assumes perfect parity measurements, so the threshold for circuit noise is far lower (Module 3).
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------- syndrome bench (exact) + simulator run (live)
type Pauli = "I" | "X" | "Y" | "Z";
type Memory = "bit" | "phase";
const xPart = (p: Pauli) => +(p === "X" || p === "Y");
const zPart = (p: Pauli) => +(p === "Z" || p === "Y");

/** Minimum-weight correction of a repetition-code syndrome: the two error patterns consistent with s, keep the lighter. */
function decodeRepetition(s: number[]) {
  const e0 = [0];
  s.forEach((bit, i) => e0.push(e0[i] ^ bit));
  const e1 = e0.map((b) => b ^ 1);
  return weight(e0) <= weight(e1) ? e0 : e1;
}

type CircuitInfo = { drawing: Drawing; metrics: { qubits: number; depth: number; two_qubit_gates: number; measure: number; reset: number }; layout: { qubits: { id: number; role: string; x: number; row: number }[]; detectors: { index: number; qubit: number | null; round: number }[]; data_qubits: number[]; boundaries: { index: number; label: string }[] } };
type Injection = {
  run_id: string; seed: number; experiment: string; computed_by: Record<string, string | number>;
  error: { type: string; qubit: number; boundary: number; when: string };
  syndrome: { fired: number[]; fired_detail: { index: number; qubit: number | null; round: number }[]; num_detectors: number; same_in_every_shot: boolean };
  decoder: { predicted_logical_flip: boolean };
  logical: { observable_flipped: boolean; outcome: string; shots: number; errors_before_decoding: number; errors_after_decoding: number };
  stim_reference: { fired: number[]; syndrome_matches_aer: boolean };
  timing_ms: Record<string, number>;
  circuit: { drawing: Drawing };
  measurements: { first_shot: string; bits_per_shot: number };
};

export function SyndromeBench() {
  const [d, setD] = useState(5);
  const [memory, setMemory] = useState<Memory>("bit");
  const [tool, setTool] = useState<Pauli>("X");
  const [paulis, setPaulis] = useState<Pauli[]>(Array(5).fill("I"));
  useEffect(() => setPaulis(Array(d).fill("I")), [d]);

  const H = useMemo(() => Array.from({ length: d - 1 }, (_, i) => Array.from({ length: d }, (_, j) => +(j === i || j === i + 1))), [d]);
  // The bit-flip code measures Z_i Z_{i+1}, which sees the X part of an error. The phase-flip code measures X_i X_{i+1} and sees the Z part.
  const seen = paulis.map(memory === "bit" ? xPart : zPart);
  const unseen = paulis.map(memory === "bit" ? zPart : xPart);
  const s = matvec(H, seen);
  const corr = decodeRepetition(s);
  const residual = seen.map((b, i) => b ^ corr[i]);
  const logicalFlip = residual.every((b) => b === 1);
  const unseenParity = unseen.reduce((a, b) => a ^ b, 0);
  const toggle = (i: number) => setPaulis((ps) => ps.map((p, j) => (j === i ? (p === tool ? "I" : tool) : p)));
  const checkOp = memory === "bit" ? "Z" : "X";
  const logicalOp = memory === "bit" ? "\\bar X = X^{\\otimes d}" : "\\bar Z = Z^{\\otimes d}";

  const W = 64 * d + 20;
  return (
    <div className="space-y-5">
      <Panel title="Syndrome bench: inject any errors, read the syndrome" source={<Provenance source="theory" detail="exact parity algebra" />} testid="syndrome-bench">
        <div className="flex flex-wrap items-end gap-4">
          <Segmented label="Distance d" value={d} onChange={setD} options={[3, 5, 7].map((v) => ({ value: v, label: String(v) }))} testid="bench-d" />
          <Segmented label="Code" value={memory} onChange={setMemory} testid="bench-memory"
            options={[{ value: "bit", label: "bit-flip code (Z checks)" }, { value: "phase", label: "phase-flip code (X checks)" }]} />
          <Segmented label="Click applies" value={tool} onChange={setTool} options={(["X", "Y", "Z"] as Pauli[]).map((p) => ({ value: p, label: p }))} testid="bench-tool" />
          <Button kind="ghost" onClick={() => setPaulis(Array(d).fill("I"))}>clear errors</Button>
        </div>

        <svg viewBox={`0 0 ${W} 120`} className="mt-4 w-full max-w-[640px]" role="group" aria-label="Data qubits and parity checks">
          {H.map((_, i) => {
            const x = 42 + 64 * i + 32, fired = s[i] === 1;
            return (
              <g key={"c" + i}>
                <line x1={x - 32} x2={x + 32} y1={40} y2={40} stroke="var(--rule-strong)" />
                <rect x={x - 13} y={74} width={26} height={26} rx={3} fill={fired ? "var(--fired)" : "var(--panel)"} stroke={memory === "bit" ? "var(--zcheck)" : "var(--xcheck)"} strokeWidth="1.8" data-testid={`check-${i}`} data-fired={fired ? 1 : 0} />
                <line x1={x - 32} x2={x - 6} y1={52} y2={74} stroke="var(--rule-strong)" /><line x1={x + 32} x2={x + 6} y1={52} y2={74} stroke="var(--rule-strong)" />
                <text x={x} y={91} textAnchor="middle" fontSize="11" fill={fired ? "var(--paper)" : "var(--ink-2)"} fontFamily="var(--font-jetbrains)">{s[i]}</text>
                <text x={x} y={114} textAnchor="middle" fontSize="10.5" fill="var(--muted)" fontFamily="var(--font-jetbrains)">{checkOp}{i}{checkOp}{i + 1}</text>
              </g>
            );
          })}
          {paulis.map((p, i) => {
            const x = 42 + 64 * i, on = p !== "I";
            return (
              <g key={"q" + i} role="button" tabIndex={0} aria-label={`data qubit ${i}, error ${p === "I" ? "none" : p}`} aria-pressed={on} data-testid={`qubit-${i}`}
                onClick={() => toggle(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(i); } }} style={{ cursor: "pointer" }}>
                <circle className="focus-ring" cx={x} cy={40} r={16} fill={on ? "var(--fault)" : "var(--panel)"} stroke="var(--ink-2)" strokeWidth="1.5" />
                <text x={x} y={40} dy="0.35em" textAnchor="middle" fontSize="12" fill={on ? "var(--paper)" : "var(--ink-2)"} fontFamily="var(--font-jetbrains)">{on ? p : i}</text>
              </g>
            );
          })}
        </svg>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 font-sans text-[12px] text-muted">
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--fault)" }} />data qubit with an error (click or Enter)</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--fired)" }} />check that reports −1</span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[auto_1fr]">
          <div className="rounded-[5px] bg-sunken px-4 py-2 text-[14px]" data-testid="bench-equation">
            <TeX block>{`\\underbrace{\\begin{pmatrix}${H.map((r) => r.join("&")).join("\\\\")}\\end{pmatrix}}_{H}\\underbrace{\\begin{pmatrix}${seen.join("\\\\")}\\end{pmatrix}}_{e} = \\underbrace{\\begin{pmatrix}${s.join("\\\\")}\\end{pmatrix}}_{s}\\pmod 2`}</TeX>
          </div>
          <div className="space-y-3 font-sans text-[13px] text-ink-2">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="Errors seen by checks" value={weight(seen)} testid="bench-weight" />
              <Stat label="Syndrome s" value={s.join("")} testid="bench-syndrome" />
              <Stat label="Correction ê" value={corr.join("")} sub="lighter of 2 solutions" testid="bench-correction" />
              <Stat label={memory === "bit" ? "Logical X̄ error?" : "Logical Z̄ error?"} value={logicalFlip ? "yes" : "no"} sub={`e ⊕ ê = ${residual.join("")}`} testid="bench-logical" />
            </div>
            <p>
              Exactly two error patterns explain any syndrome, <TeX>{"e"}</TeX> and <TeX>{"e\\oplus 1\\cdots1"}</TeX>, because the all-ones vector{" "}
              <TeX>{logicalOp}</TeX> has zero syndrome. The decoder keeps the lighter one. It succeeds while fewer than <TeX>{"d/2"}</TeX> qubits are hit
              ({weight(seen)} of {d} now). Otherwise <TeX>{"e\\oplus\\hat e"}</TeX> is the logical operator and the stored bit is flipped without any check noticing.
            </p>
            <p className={unseenParity ? "rounded-sm bg-[color-mix(in_srgb,var(--fault)_8%,transparent)] px-2 py-1" : ""} data-testid="bench-unseen">
              {memory === "bit" ? "Z" : "X"} components of the errors are invisible to these checks: they commute with every{" "}
              <TeX>{`${checkOp}_i${checkOp}_{i+1}`}</TeX>. Their parity is <strong>{unseenParity}</strong>.{" "}
              {unseenParity ? (memory === "bit"
                ? "On a stored superposition α|0…0⟩ + β|1…1⟩ this applies Z̄ (β → −β): an undetectable logical phase error. The bit-flip code is not a quantum memory."
                : "On the stored state this applies X̄: an undetectable logical bit flip.")
                : "No undetected logical effect from them right now."}
            </p>
          </div>
        </div>
      </Panel>
      <SimulatorRun d={d} memory={memory} paulis={paulis} predicted={s} />
    </div>
  );
}

/** Replays the bench's single error as a real circuit on Qiskit Aer, decoded by PyMatching (MidQwest backend). */
function SimulatorRun({ d, memory, paulis, predicted }: { d: number; memory: Memory; paulis: Pauli[]; predicted: number[] }) {
  const [rounds, setRounds] = useState(3);
  const [boundary, setBoundary] = useState(1);
  const [shots, setShots] = useState(100);
  const [seed, setSeed] = useState(7);
  const basis = memory === "bit" ? "Z" : "X";
  const supported = d === 3 || d === 5;
  const circ = useGet<CircuitInfo>(supported ? `${SIM}/circuit?code=repetition&basis=${basis}&distance=${d}&rounds=${rounds}` : null);
  const inj = useRun<object, Injection>(`${SIM}/simulate/injection`);
  useEffect(() => { inj.setData(null); }, [d, memory, rounds]); // eslint-disable-line react-hooks/exhaustive-deps

  const errs = paulis.map((p, i) => [p, i] as const).filter(([p]) => p !== "I");
  const single = errs.length === 1 ? errs[0] : null;
  const lay = circ.data?.layout;
  const ancillas = lay ? lay.qubits.filter((q) => q.role !== "data").sort((a, b) => a.x - b.x).map((q) => q.id) : [];
  const maxRound = lay ? Math.max(...lay.detectors.map((x) => x.round)) : rounds;

  const run = () => {
    if (!single || !lay) return;
    inj.run({ code: "repetition", basis, distance: d, rounds, error_type: single[0], qubit: lay.data_qubits[single[1]], boundary, shots, seed });
  };
  const res = inj.data;
  const firedSet = new Set(res?.syndrome.fired ?? []);
  // Prediction from the bench: an error after round b fires the adjacent checks in detector round b.
  const predictedFired = lay ? lay.detectors.filter((det) => det.round === boundary && det.qubit !== null && predicted[ancillas.indexOf(det.qubit)] === 1).map((det) => det.index).sort((a, b) => a - b) : [];
  const agree = res ? JSON.stringify(predictedFired) === JSON.stringify([...res.syndrome.fired].sort((a, b) => a - b)) : null;

  return (
    <Panel title="Now run it as a circuit: Qiskit Aer + PyMatching" source={<Provenance source="live" detail="MidQwest FastAPI :8000" />} testid="sim-run">
      {!supported ? <p className="font-sans text-[13px] text-muted">The simulation backend supports d = 3 and 5. Choose one of those above.</p> : (
        <>
          <p className="mb-3 font-sans text-[13px] leading-relaxed text-ink-2">
            The backend builds the {memory === "bit" ? "bit-flip" : "phase-flip"} repetition memory as a Stim circuit with {rounds} rounds of ancilla-based
            parity measurement. It inserts your error as a real gate, converts the circuit to Qiskit and runs it on Aer. Detection events compare each check
            with its previous round, so an error appears once in time, where it happened. The decoder sees only measurement results.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <Select label="Rounds" value={rounds} onChange={(r) => { setRounds(r); setBoundary((b) => Math.min(b, r)); }} options={[2, 3, 4, 5].map((r) => ({ value: r, label: String(r) }))} testid="sim-rounds" />
            <Select label="Error inserted" value={boundary} onChange={setBoundary} testid="sim-boundary"
              options={(lay?.boundaries ?? []).map((b) => ({ value: b.index, label: b.label }))} />
            <NumberField label="Shots" value={shots} min={1} max={1000} onChange={setShots} testid="sim-shots" />
            <NumberField label="Seed" value={seed} min={0} onChange={setSeed} testid="sim-seed" />
            <Button onClick={run} disabled={!single || !lay || inj.loading} testid="sim-run-button">{inj.loading ? "Running…" : "Run on Aer"}</Button>
          </div>
          {!single && <p className="mt-2 font-sans text-[12.5px] text-muted">Place exactly one error on the bench above. The backend injects one error per run, and multi-error behaviour is what the exact bench is for.</p>}
          <ErrorBox error={circ.error ?? inj.error} what="Simulation backend" />
          {circ.loading && <Loading what="Building circuit" />}
          {lay && (
            <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[auto_1fr]">
              <div>
                <div className="mb-1 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Detection events (Aer, shot 1)</div>
                <table className="border-collapse font-sans text-[12px]" data-testid="sim-grid">
                  <thead><tr><th className="pr-2 text-left font-normal text-muted">round</th>{ancillas.map((a, i) => <th key={a} className="num px-1 font-normal text-muted">c{i}</th>)}</tr></thead>
                  <tbody>{Array.from({ length: maxRound + 1 }, (_, t) => (
                    <tr key={t}>
                      <td className="num pr-2 text-muted">{t === maxRound ? `${t} (readout)` : t}</td>
                      {ancillas.map((a) => {
                        const det = lay.detectors.find((x) => x.round === t && x.qubit === a);
                        const on = det && firedSet.has(det.index);
                        return <td key={a} className="p-0.5"><div title={det ? `detector ${det.index}` : "no detector"} data-fired={on ? 1 : 0}
                          className="h-6 w-6 rounded-[3px] border" style={{ background: !det ? "transparent" : on ? "var(--fired)" : "var(--sunken)", borderColor: det ? "var(--rule-strong)" : "transparent" }} /></td>;
                      })}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {res && (
                <div className="space-y-3" data-testid="sim-result" data-run-id={res.run_id}>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <Stat label="Fired detectors" value={res.syndrome.fired.join(", ") || "none"} testid="sim-fired" />
                    <Stat label="Decoder predicts flip" value={res.decoder.predicted_logical_flip ? "yes" : "no"} testid="sim-predicted" />
                    <Stat label="Outcome (shot 1)" value={res.logical.outcome} testid="sim-outcome" />
                    <Stat label="Wrong after decoding" value={`${res.logical.errors_after_decoding} / ${res.logical.shots}`} sub={`before: ${res.logical.errors_before_decoding}`} testid="sim-after" />
                  </div>
                  <ul className="space-y-1 font-sans text-[12.5px] text-ink-2">
                    <li><Check ok={!!agree} /> Exact bench predicted detectors <span className="num">{predictedFired.join(", ") || "none"}</span>; Aer measured <span className="num">{res.syndrome.fired.join(", ") || "none"}</span>.</li>
                    <li><Check ok={res.stim_reference.syndrome_matches_aer} /> Independent Stim simulation of the same faulty circuit gives the same syndrome.</li>
                    <li><Check ok={res.syndrome.same_in_every_shot} /> Same syndrome in all {res.logical.shots} shots (no random noise in this circuit, only your error).</li>
                  </ul>
                  <div className="font-sans text-[11.5px] text-muted">
                    {String(res.computed_by.simulator)} · {String(res.computed_by.decoder)} · seed {res.seed} · run {res.run_id} · {res.timing_ms.total} ms total
                    <div className="mt-1">First shot, raw measurement bits (Stim record order): <span className="num text-ink-2" data-testid="sim-raw">{res.measurements.first_shot}</span></div>
                  </div>
                </div>
              )}
            </div>
          )}
          {lay && circ.data && (
            <div className="mt-6 space-y-5">
              <div>
                <div className="mb-1.5 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">
                  Circuit {res ? `with your ${res.error.type} error placed ${res.error.when}` : "without an error (run it to see the error placed)"}
                </div>
                <CircuitDiagram drawing={res ? res.circuit.drawing : circ.data.drawing} qubits={lay.qubits} rounds={rounds} fired={res?.syndrome.fired_detail} />
              </div>
              <CompileMetrics code="repetition" basis={basis} distance={d} rounds={rounds} written={circ.data.metrics} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function Check({ ok }: { ok: boolean }) {
  return <span aria-label={ok ? "agrees" : "differs"} className="mr-1.5 inline-block w-4 font-semibold" style={{ color: ok ? "var(--s5)" : "var(--fault)" }}>{ok ? "✓" : "✗"}</span>;
}
