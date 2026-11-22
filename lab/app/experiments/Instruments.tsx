"use client";
import { useState } from "react";
import { Plot } from "@/components/charts/Plot";
import { Button, DataTable, ErrorBox, Loading, NumberField, Segmented, Select, Stat } from "@/components/Controls";
import { Panel } from "@/components/Layout";
import { Provenance } from "@/components/Provenance";
import { AEGIS, SIM, useGet, useRun } from "@/lib/api";
import { fmtMs, fmtSci } from "@/lib/stats";

// ---------------------------------------------------------------- A. Gross-code memory shot
type Shot = {
  source: string; basis: string; p: number; f: number; seed: number; syndrome: number[][]; true_observables: number[]; heralds: number; herald_rounds: number[];
  decoders: Record<string, { logical_correct: boolean; ms: number; explains_syndrome: boolean; bp_iterations: number; predicted_observables: number[] }>;
  routing: null | { risk: number; threshold: number; escalated: boolean; path: string }; aegis_available: boolean;
};
type AegisStatus = { allowed_p: number[]; allowed_f: number[]; model: { name: string } | null; loss_model: { name: string } | null };

export function GrossExperiment() {
  const st = useGet<AegisStatus>(`${AEGIS}/status`);
  const [basis, setBasis] = useState<"X" | "Z">("X");
  const [p, setP] = useState(0.004);
  const [f, setF] = useState(0);
  const [seed, setSeed] = useState(101);
  const [base, setBase] = useState<string[]>(["relay", "bposd"]);
  const r = useRun<object, Shot>(`${AEGIS}/decode`);
  const shot = r.data;
  const go = (s = seed) => r.run({ basis, p, f, seed: s, baselines: base });
  return (
    <Panel title="Experiment A · one 12-cycle memory shot of the Gross code, decoded three ways" source={<Provenance source="live" detail="Stim + ldpc + relay-bp + QEC-Aegis, :8765" />} testid="exp-gross">
      <div className="flex flex-wrap items-end gap-4">
        <Segmented label="Memory basis" value={basis} onChange={setBasis} options={[{ value: "X", label: "X" }, { value: "Z", label: "Z" }]} testid="g-basis" />
        <Select label="Physical error rate p" value={p} onChange={setP} options={(st.data?.allowed_p ?? [0.003, 0.004, 0.005]).map((v) => ({ value: v, label: String(v) }))} testid="g-p" />
        <Select label="Erasure fraction f" value={f} onChange={setF} options={(st.data?.allowed_f ?? [0]).map((v) => ({ value: v, label: String(v) }))} testid="g-f" />
        <NumberField label="Shot seed" value={seed} min={0} onChange={setSeed} testid="g-seed" />
        <div className="flex flex-col gap-1 font-sans text-[12.5px] text-ink-2">
          <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Baselines</span>
          <div className="flex gap-3 py-1">
            {[["relay", "relay-BP"], ["bposd", "BP-OSD"]].map(([k, l]) => (
              <label key={k} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={base.includes(k)} onChange={(e) => setBase((b) => (e.target.checked ? [...b, k] : b.filter((x) => x !== k)))} />{l}</label>
            ))}
          </div>
        </div>
        <Button onClick={() => go()} disabled={r.loading} testid="g-run">{r.loading ? "Decoding…" : "Sample and decode"}</Button>
        <Button kind="secondary" onClick={() => { setSeed(seed + 1); go(seed + 1); }} disabled={r.loading}>Next seed</Button>
      </div>
      {f > 0 && !st.data?.loss_model && <p className="mt-2 font-sans text-[12.5px] text-muted">No erasure-trained router on this machine, so only the baselines decode when f &gt; 0.</p>}
      <ErrorBox error={st.error ?? r.error} what="Gross backend" />
      {r.loading && !shot && <Loading what="Sampling 288 qubits × 12 cycles with Stim, then decoding" />}
      {shot && (
        <div className="mt-5 space-y-5" data-testid="g-result" data-seed={shot.seed}>
          <SyndromeRaster syndrome={shot.syndrome} heralds={shot.herald_rounds} basis={shot.basis} />
          <DataTable testid="g-table" align={["l", "l", "l", "l", "r", "r"]}
            head={["Decoder", "Hê = s", "Predicted observables (12)", "Logical outcome", "BP iterations", "Time"]}
            rows={[
              ["Simulator truth", "—", <Bits key="t" bits={shot.true_observables} />, "—", "—", "—"],
              ...Object.entries(shot.decoders).map(([name, d]) => [
                <span key="n" className="font-medium text-ink">{name}</span>, d.explains_syndrome ? "yes" : "no",
                <Bits key="b" bits={d.predicted_observables} truth={shot.true_observables} />,
                <span key="o" data-testid={`g-outcome-${name}`} style={{ color: d.logical_correct ? "var(--s5)" : "var(--fault)" }}>{d.logical_correct ? "correct" : "logical error"}</span>,
                <span key="i" data-testid={`g-iter-${name}`}>{d.bp_iterations}</span>, <span key="m" data-testid={`g-ms-${name}`}>{fmtMs(d.ms)}</span>,
              ]),
            ]} />
          {shot.routing && <p className="font-sans text-[12.5px] text-ink-2">QEC-Aegis route: <strong data-testid="g-route">{shot.routing.path}</strong>. Risk <span className="num">{shot.routing.risk.toExponential(2)}</span> against threshold <span className="num">{shot.routing.threshold.toFixed(4)}</span>.</p>}
          <p className="font-sans text-[12px] text-muted">
            &quot;Correct&quot; means all 12 predicted logical observables equal the simulator&apos;s. A decoder can explain the syndrome and still be logically wrong:
            its correction then differs from the true error by a logical operator. Seed {shot.seed}, p = {shot.p}, f = {shot.f}
            {shot.f > 0 ? `, ${shot.heralds} heralded erasures` : ""}.
          </p>
        </div>
      )}
    </Panel>
  );
}

function Bits({ bits, truth }: { bits: number[]; truth?: number[] }) {
  return <span className="num text-[12.5px] tracking-[0.08em]">{bits.map((b, i) => <span key={i} style={{ color: truth && truth[i] !== b ? "var(--fault)" : undefined, fontWeight: truth && truth[i] !== b ? 700 : undefined }}>{b}</span>)}</span>;
}

function SyndromeRaster({ syndrome, heralds, basis }: { syndrome: number[][]; heralds: number[]; basis: string }) {
  const cw = 9, ch = 15, total = syndrome.flat().reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="mb-1 flex flex-wrap justify-between font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">
        <span>Detection events on {basis} checks: 13 rows × 72 checks</span><span className="num normal-case" data-testid="g-total">{total} events</span>
      </div>
      <div className="overflow-x-auto">
        <svg width={72 * cw + 120} height={13 * ch + 22} className="block" role="img" aria-label={`Syndrome raster with ${total} detection events`} data-testid="g-raster">
          {syndrome.map((row, t) => (
            <g key={t}>
              <text x={60} y={t * ch + 11} textAnchor="end" fontSize="10.5" fill="var(--muted)" className="num">{t === 12 ? "readout" : `cycle ${t + 1}`}</text>
              {row.map((v, c) => <rect key={c} x={66 + c * cw} y={t * ch + 1} width={cw - 1.5} height={ch - 2} rx={1} fill={v ? "var(--fired)" : "var(--sunken)"} />)}
              <text x={66 + 72 * cw + 6} y={t * ch + 11} fontSize="10.5" fill="var(--ink-2)" className="num">{row.reduce((a, b) => a + b, 0)}{heralds[t] ? ` · ${heralds[t]}h` : ""}</text>
            </g>
          ))}
          <text x={66} y={13 * ch + 16} fontSize="10.5" fill="var(--muted)">check 0</text>
          <text x={66 + 71 * cw} y={13 * ch + 16} fontSize="10.5" fill="var(--muted)" textAnchor="end">check 71</text>
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- B. logical error-rate sweep (surface / repetition)
type Rates = { run_id: string; seed: number; experiment: string; noise_model: string; interval: string; total_seconds: number;
  points: { distance: number; p: number; errors: number; shots: number; rate: number; ci95: [number, number]; seconds: number; vs_d3?: string }[] };
type Meta = { limits: { rate_shots: [number, number]; rate_points: number; rate_p: [number, number]; compare_shots: [number, number]; compare_p: [number, number] }; noise_models: Record<string, string> };

export function RateSweep() {
  const meta = useGet<Meta>(`${SIM}/meta`);
  const [code, setCode] = useState<"surface" | "repetition">("surface");
  const [basis, setBasis] = useState<"Z" | "X">("Z");
  const [noise, setNoise] = useState<"circuit" | "X" | "Y" | "Z">("circuit");
  const [rounds, setRounds] = useState(3);
  const [lo, setLo] = useState(0.002), [hi, setHi] = useState(0.02), [pts, setPts] = useState(5);
  const [shots, setShots] = useState(20000);
  const [seed, setSeed] = useState(2026);
  const r = useRun<object, Rates>(`${SIM}/simulate/rates`);
  const ps = Array.from({ length: pts }, (_, i) => +(lo * Math.pow(hi / lo, pts === 1 ? 0 : i / (pts - 1))).toPrecision(3));
  const res = r.data;
  const series = res ? [3, 5].map((d, k) => ({ id: `d${d}`, label: `d = ${d}`, color: k ? "var(--s2)" : "var(--s1)",
    points: res.points.filter((q) => q.distance === d).map((q) => ({ x: q.p, y: Math.max(q.rate, q.ci95[1] * 1e-3), lo: q.ci95[0], hi: q.ci95[1], note: `${q.errors} of ${q.shots.toLocaleString()}` })) })) : [];
  return (
    <Panel title="Experiment B · logical error rate against physical error rate" source={<Provenance source="live" detail="Stim + PyMatching, :8000" />} testid="exp-rates">
      <div className="flex flex-wrap items-end gap-4">
        <Segmented label="Code" value={code} onChange={setCode} options={[{ value: "surface", label: "surface" }, { value: "repetition", label: "repetition" }]} />
        <Segmented label="Basis" value={basis} onChange={setBasis} options={[{ value: "Z", label: "Z" }, { value: "X", label: "X" }]} />
        <Select label="Noise" value={noise} onChange={setNoise} options={[{ value: "circuit", label: "circuit-level" }, { value: "X", label: "X only" }, { value: "Y", label: "Y only" }, { value: "Z", label: "Z only" }]} />
        <Select label="Rounds" value={rounds} onChange={setRounds} options={[2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))} />
        <NumberField label="p from" value={lo} step={0.001} onChange={setLo} width="w-24" />
        <NumberField label="p to" value={hi} step={0.001} onChange={setHi} width="w-24" />
        <Select label="Points" value={pts} onChange={setPts} options={[2, 3, 4, 5, 6].map((v) => ({ value: v, label: String(v) }))} />
        <NumberField label="Shots / point" value={shots} step={1000} min={1000} max={100000} onChange={setShots} testid="rates-shots" />
        <NumberField label="Seed" value={seed} onChange={setSeed} />
        <Button onClick={() => r.run({ code, basis, noise, rounds, distances: [3, 5], p_values: ps, shots, seed })} disabled={r.loading} testid="rates-run">{r.loading ? "Sampling…" : "Run sweep"}</Button>
      </div>
      <p className="mt-2 font-sans text-[12px] text-muted">
        p values: <span className="num">{ps.join(", ")}</span>. {meta.data ? `${meta.data.noise_models[noise].replace(/\.?$/, ".")}` : ""}{" "}
        {meta.data && <>Bounds enforced by the backend: {meta.data.limits.rate_shots[0].toLocaleString()}–{meta.data.limits.rate_shots[1].toLocaleString()} shots, at most {meta.data.limits.rate_points} points, p in [{meta.data.limits.rate_p.join(", ")}].</>}
      </p>
      <ErrorBox error={r.error} what="Simulation backend" />
      {res && (
        <div className="mt-4 space-y-4" data-testid="rates-result" data-run-id={res.run_id}>
          <Plot series={series} xLabel="physical error rate p" yLabel="logical error per experiment" testid="rates-plot" />
          <DataTable testid="rates-table" align={["r", "r", "r", "r", "l", "l"]} head={["p", "d", "errors / shots", "rate", "95% interval (Clopper–Pearson)", "d = 5 vs d = 3"]}
            rows={res.points.map((q) => [q.p, q.distance, `${q.errors} / ${q.shots.toLocaleString()}`, fmtSci(q.rate, 2, true), `${fmtSci(q.ci95[0], 2, true)} – ${fmtSci(q.ci95[1], 2, true)}`, q.vs_d3 ?? ""])} />
          <p className="font-sans text-[12px] text-muted">{res.experiment} · {res.interval} · seed {res.seed} · {res.total_seconds} s · run {res.run_id}. A point with zero errors is drawn at its upper bound ÷ 1000 so it stays on the log axis; read the table.</p>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- C. two independent simulators, same experiment
type Compare = { run_id: string; seed: number; experiment: string; noise_model: string; simulators: Record<string, string>; decoder: string;
  aer: { errors: number; shots: number; rate: number; ci95: [number, number] }; stim: { errors: number; shots: number; rate: number; ci95: [number, number] };
  detection_event_rate: { aer: number; stim: number }; fisher_exact_p: number; consistent: boolean; seconds: { aer: number; stim: number } };

export function SimCompare() {
  const [code, setCode] = useState<"surface" | "repetition">("surface");
  const [d, setD] = useState(3);
  const [p, setP] = useState(0.005);
  const [shots, setShots] = useState(5000);
  const [seed, setSeed] = useState(5);
  const r = useRun<object, Compare>(`${SIM}/simulate/compare`);
  const c = r.data;
  return (
    <Panel title="Experiment C · Qiskit Aer against Stim on the same noisy circuit" source={<Provenance source="live" detail=":8000" />} testid="exp-compare">
      <div className="flex flex-wrap items-end gap-4">
        <Segmented label="Code" value={code} onChange={setCode} options={[{ value: "surface", label: "surface" }, { value: "repetition", label: "repetition" }]} />
        <Segmented label="Distance" value={d} onChange={setD} options={[3, 5].map((v) => ({ value: v, label: String(v) }))} />
        <NumberField label="p" value={p} step={0.001} min={0.001} max={0.02} onChange={setP} width="w-24" />
        <NumberField label="Shots" value={shots} step={1000} min={1000} max={20000} onChange={setShots} />
        <NumberField label="Seed" value={seed} onChange={setSeed} />
        <Button onClick={() => r.run({ code, distance: d, rounds: d, p, shots, seed })} disabled={r.loading} testid="cmp-run">{r.loading ? "Running both…" : "Compare"}</Button>
      </div>
      <ErrorBox error={r.error} what="Simulation backend" />
      {c && (
        <div className="mt-4 space-y-3" data-testid="cmp-result" data-run-id={c.run_id}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Aer logical errors" value={`${c.aer.errors} / ${c.aer.shots}`} sub={`95%: ${fmtSci(c.aer.ci95[0])} – ${fmtSci(c.aer.ci95[1])}`} testid="cmp-aer" />
            <Stat label="Stim logical errors" value={`${c.stim.errors} / ${c.stim.shots}`} sub={`95%: ${fmtSci(c.stim.ci95[0])} – ${fmtSci(c.stim.ci95[1])}`} testid="cmp-stim" />
            <Stat label="Fisher exact p-value" value={c.fisher_exact_p.toFixed(3)} sub={c.consistent ? "consistent at the 5% level" : "INCONSISTENT at the 5% level"} testid="cmp-fisher" />
            <Stat label="Detection-event rate" value={`${c.detection_event_rate.aer.toFixed(4)} / ${c.detection_event_rate.stim.toFixed(4)}`} sub="Aer / Stim" />
          </div>
          <p className="font-sans text-[12.5px] leading-relaxed text-ink-2">
            {c.noise_model} Decoder: {c.decoder}. Aer took {c.seconds.aer.toFixed(2)} s and Stim {c.seconds.stim.toFixed(3)} s. A p-value below 0.05 would mean
            the two simulators disagree on the circuit or the noise. Agreement shows the circuit translation from Stim to Qiskit is faithful, which the
            hardware run in Module 8 relies on.
          </p>
        </div>
      )}
    </Panel>
  );
}
