"use client";
import { DataTable, ErrorBox, Loading, Stat } from "@/components/Controls";
import { Figure, Panel } from "@/components/Layout";
import { Provenance } from "@/components/Provenance";
import { SIM, useGet } from "@/lib/api";
import { fmtPct } from "@/lib/stats";

type HW = {
  source: string; live: boolean; job_id: string; backend: string; processor: { family: string; revision: string }; num_qubits: number;
  timestamps_utc: Record<string, string>; quantum_seconds: number;
  experiment: { code: string; distance: number; rounds: number; shots: number; physical_qubits: number[]; decoder_error_rates: Record<string, number> };
  circuits: { name: string; depth: number; ops: Record<string, number>; physical_qubits: number[] }[];
  counts: Record<string, [string, number][]>;
  analysis: { qec: { shots: number; detectors: number; detection_event_rate: number; logical_errors_raw: number; logical_errors_decoded: number; logical_error_raw_ci95: [number, number]; logical_error_decoded_ci95: [number, number] };
    feedforward: { shots: number; correlated_shots: number; success: number; success_ci95: [number, number] } };
  analysis_matches_record: boolean;
  detectors: { index: number; qubit: number; round: number; rate: number }[];
  calibration: { last_update: string; qubits: Record<string, { t1_s: number; t2_s: number; readout_error: number }>; cz_errors: Record<string, number> };
  integrity: { checksums_ok: boolean; files: Record<string, boolean>; sha256_expected?: Record<string, string>; sha256_recomputed?: Record<string, string>; sums_file?: string };
};

export function useHardware() { return useGet<HW>(`${SIM}/hardware`); }

function Tick({ ok }: { ok: boolean }) {
  return <span className="font-semibold" style={{ color: ok ? "var(--s5)" : "var(--fault)" }}>{ok ? "✓" : "✗"}</span>;
}

export function HardwareRecord() {
  const hw = useHardware();
  const health = useGet<{ hardware_submission: string }>(`${SIM}/health`);
  if (hw.error) return <ErrorBox error={hw.error} what="Hardware archive" />;
  if (!hw.data) return <Loading what="Verifying checksums and re-decoding the archive" />;
  const h = hw.data, q = h.analysis.qec, ff = h.analysis.feedforward;
  const phys = h.experiment.physical_qubits;
  const toPhys = (stimQ: number) => phys[stimQ];
  const ms = (a: string, b: string) => ((Date.parse(h.timestamps_utc[b]) - Date.parse(h.timestamps_utc[a])) / 1000).toFixed(1);
  return (
    <div className="space-y-8" data-testid="hardware" data-job={h.job_id}>
      <div className="rounded-md border-2 p-5" style={{ borderColor: "var(--prov-hardware)", background: "color-mix(in srgb, var(--prov-hardware) 5%, var(--panel))" }}>
        <div className="flex flex-wrap items-center gap-3">
          <Provenance source="hardware" />
          <span className="font-sans text-[13px] text-ink-2">Measured once on {h.timestamps_utc.created?.slice(0, 10)}. Read from disk now. Never re-run from this page.</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Job" value={<span className="text-[15px]">{h.job_id}</span>} testid="hw-job" />
          <Stat label="Backend" value={h.backend} sub={`${h.processor.family} r${h.processor.revision} · ${h.num_qubits} qubits`} testid="hw-backend" />
          <Stat label="Quantum time" value={`${h.quantum_seconds} s`} sub={`queued→running ${ms("created", "running")} s, running→done ${ms("running", "finished")} s`} />
          <Stat label="Physical qubits" value={phys.join(", ")} sub={`${h.experiment.code} d = ${h.experiment.distance}, ${h.experiment.rounds} rounds`} testid="hw-qubits" />
        </div>
        <p className="mt-3 font-sans text-[12.5px] text-ink-2">
          Submission path: <strong data-testid="hw-submission">{health.data?.hardware_submission ?? "…"}</strong>. The backend has no IBM Quantum account code and only opens these files.
        </p>
      </div>

      <Panel title="Integrity: SHA-256 checksums and an independent re-decode" source={<Provenance source="hardware" detail={h.integrity.sums_file} />} testid="hw-integrity">
        <DataTable testid="hw-sums" align={["l", "l", "l", "l"]} head={["File", "Expected (SHA256SUMS)", "Recomputed now", "Match"]}
          rows={Object.entries(h.integrity.files).map(([f, ok]) => [<span key="f" className="num">{f}</span>,
            <span key="e" className="num text-[11.5px]">{h.integrity.sha256_expected?.[f] ?? "—"}</span>,
            <span key="r" className="num text-[11.5px]">{h.integrity.sha256_recomputed?.[f] ?? "—"}</span>, <Tick key="t" ok={ok} />])} />
        <p className="mt-3 font-sans text-[13px] text-ink-2">
          <Tick ok={h.integrity.checksums_ok} /> All files match the checksums written at archive time. <Tick ok={h.analysis_matches_record} /> Decoding{" "}
          <span className="num">measurements.npz</span> again with PyMatching gives exactly the analysis stored in <span className="num">record.json</span>.
        </p>
      </Panel>

      <Figure n="8.1" title="Repetition code d = 3, 2 rounds, on ibm_kingston qubits 148–152" testid="fig-8-1"
        source={<Provenance source="hardware" detail={`${q.shots.toLocaleString()} shots`} />}
        assumptions={<>Bit-flip repetition memory storing |0⟩, compiled to the heavy-hex chain {phys.join("–")} (data on even positions, ancillas on odd) with no SWAPs. Decoder weights from the device calibration: p_gate {h.experiment.decoder_error_rates.p_gate.toExponential(2)}, p_meas {h.experiment.decoder_error_rates.p_meas.toExponential(2)}, p_idle {h.experiment.decoder_error_rates.p_idle.toExponential(2)}.</>}
        sample={<>{q.shots.toLocaleString()} shots, {q.detectors} detectors per shot; feed-forward test {ff.shots.toLocaleString()} shots.</>}
        uncertainty={<>Exact Clopper–Pearson 95% intervals. Raw logical error {q.logical_errors_raw}/{q.shots} [{q.logical_error_raw_ci95.map((x) => x.toExponential(1)).join(", ")}]; decoded {q.logical_errors_decoded}/{q.shots} [0, {q.logical_error_decoded_ci95[1].toExponential(1)}]. The intervals overlap.</>}
        limitations={<>One job, one layout, two rounds. The code protects against bit flips only, so this is a pipeline test, not a quantum memory. The calibration snapshot was last updated {h.calibration.last_update}, before the job ran. One error versus zero is not evidence that decoding helped.</>}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
          <div>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Logical errors, raw" value={`${q.logical_errors_raw} / ${q.shots}`} testid="hw-raw" />
              <Stat label="Logical errors, decoded" value={`${q.logical_errors_decoded} / ${q.shots}`} testid="hw-decoded" />
              <Stat label="Detection-event rate" value={fmtPct(q.detection_event_rate, 2)} sub={`${q.detectors} detectors per shot`} testid="hw-der" />
              <Stat label="Feed-forward success" value={`${ff.correlated_shots} / ${ff.shots}`} sub={`95%: ${fmtPct(ff.success_ci95[0])} – ${fmtPct(ff.success_ci95[1])}`} testid="hw-ff" />
            </div>
            <div className="mt-4 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">How often each detector fired</div>
            <div className="mt-2 space-y-1.5" data-testid="hw-detectors">
              {h.detectors.map((d) => (
                <div key={d.index} className="grid grid-cols-[150px_1fr_52px] items-center gap-2 font-sans text-[12.5px]">
                  <span className="text-ink-2">check on q{toPhys(d.qubit)}, {d.round === h.experiment.rounds ? "final readout" : `round ${d.round + 1}`}</span>
                  <div className="h-3 rounded-sm bg-sunken"><div className="h-full rounded-sm" style={{ width: `${(100 * d.rate) / 0.05}%`, background: "var(--prov-hardware)" }} /></div>
                  <span className="num text-right" data-testid={`hw-det-${d.index}`}>{fmtPct(d.rate, 1)}</span>
                </div>
              ))}
              <div className="font-sans text-[11px] text-muted">Bar length: rate on a 0–5% scale.</div>
            </div>
          </div>
          <div>
            <ChainDiagram phys={phys} cal={h.calibration} />
            <div className="mt-4 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Most frequent 7-bit measurement records</div>
            <DataTable testid="hw-counts" align={["l", "r", "r"]} head={["Record (Stim order)", "Shots", "Share"]}
              rows={(h.counts.pub0_m ?? []).slice(0, 8).map(([b, n]) => [<span key="b" className="num">{b}</span>, n, fmtPct(n / q.shots, 1)])} />
          </div>
        </div>
      </Figure>

      <Panel title="Calibration of the qubits used (as archived)" source={<Provenance source="hardware" detail={`last update ${h.calibration.last_update}`} />} testid="hw-cal">
        <DataTable testid="hw-cal-table" align={["l", "l", "r", "r", "r"]} head={["Qubit", "Role", "T₁", "T₂", "Readout error"]}
          rows={Object.entries(h.calibration.qubits).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => {
            const i = phys.indexOf(+k);
            return [k, i < 0 ? "feed-forward test" : i % 2 ? "ancilla" : "data", `${(v.t1_s * 1e6).toFixed(0)} µs`, `${(v.t2_s * 1e6).toFixed(0)} µs`, fmtPct(v.readout_error, 2)];
          })} />
        <div className="mt-3 font-sans text-[12.5px] text-ink-2">CZ gate errors: {Object.entries(h.calibration.cz_errors).map(([k, v]) => `${k} ${fmtPct(v, 2)}`).join(" · ")}</div>
      </Panel>
    </div>
  );
}

function ChainDiagram({ phys, cal }: { phys: number[]; cal: HW["calibration"] }) {
  return (
    <svg viewBox="0 0 420 96" className="w-full" role="img" aria-label={`Physical qubit chain ${phys.join(", ")}: data, ancilla, data, ancilla, data`}>
      {phys.slice(0, -1).map((_, i) => <line key={i} x1={40 + i * 85} x2={125 + i * 85} y1={40} y2={40} stroke="var(--rule-strong)" strokeWidth="2" />)}
      {phys.map((p, i) => {
        const c = cal.qubits[String(p)];
        return (
          <g key={p}>
            {i % 2 ? <rect x={40 + i * 85 - 14} y={26} width={28} height={28} rx={3} fill="var(--panel)" stroke="var(--zcheck)" strokeWidth="2" />
              : <circle cx={40 + i * 85} cy={40} r={15} fill="var(--panel)" stroke="var(--ink-2)" strokeWidth="1.6" />}
            <text x={40 + i * 85} y={40} dy="0.35em" textAnchor="middle" fontSize="11" fill="var(--ink)" fontFamily="var(--font-jetbrains)">{p}</text>
            {c && <text x={40 + i * 85} y={78} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-jetbrains)">T₁ {(c.t1_s * 1e6).toFixed(0)} µs</text>}
            <text x={40 + i * 85} y={12} textAnchor="middle" fontSize="10" fill="var(--muted)">{i % 2 ? "ZZ check" : "data"}</text>
          </g>
        );
      })}
    </svg>
  );
}
