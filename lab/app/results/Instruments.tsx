"use client";
import { useMemo, useState } from "react";
import { LogHistogram } from "@/components/charts/Histogram";
import { Plot, type Series } from "@/components/charts/Plot";
import { DataTable, ErrorBox, Loading, Segmented, Stat } from "@/components/Controls";
import { Figure, Note } from "@/components/Layout";
import { Provenance } from "@/components/Provenance";
import { AEGIS, useGet } from "@/lib/api";
import { fmtMs, fmtPct, fmtSci, perCycle, wilson } from "@/lib/stats";

type Tier = { pairs: number; failures_X: number; failures_Z: number; failures_pair: number; ler: number; ler_sigma: number; ler_ci95: [number, number];
  ms_mean: number; ms_mean_ci95: [number, number]; ms_median: number; ms_p95: number; ms_p99: number; ms_max: number; latency_counts: number[]; unconverged: number };
type Setting = { split: string; p: number; f: number; pairs: number; seed: number; tiers: Record<string, Tier>; files: string[]; written: string };
type Records = { source: string; origin: string; convention: string; interval: string; latency_edges_ms: number[]; settings: Setting[]; incomplete: { split: string; p: number; f: number; have?: string[] }[] };
type Reference = { origin: string; rows: { p: number; decoder: string; failures: string; ler: number; mean_s: number }[] };

/** Display order and colours follow the decoder, never its rank (fixed categorical order). */
export const TIERS: { id: string; label: string; color: string; what: string }[] = [
  { id: "relay", label: "relay-BP (kit)", color: "var(--s1)", what: "5 solutions, ≤ 300 legs" },
  { id: "bposd", label: "BP-OSD (kit)", color: "var(--s3)", what: "80 it. min-sum + OSD-CS order 10" },
  { id: "relay1", label: "relay1 (Aegis tier 1)", color: "var(--s2)", what: "first solution, ≤ 300 legs" },
  { id: "strong10", label: "strong10", color: "var(--s4)", what: "lightest of 10, ≤ 600 legs" },
  { id: "fast", label: "fast", color: "var(--s5)", what: "first solution, ≤ 10 legs" },
  { id: "bp200", label: "plain BP, 200 it.", color: "var(--s6)", what: "min-sum only" },
];

export function useRecords() { return useGet<Records>(`${AEGIS}/records`); }

function SplitNote({ rec }: { rec: Records }) {
  const splits = [...new Set(rec.settings.map((s) => s.split))];
  return (
    <Note tone="warn">
      <strong>Data split.</strong> Available complete settings: {rec.settings.map((s) => `${s.split} p=${s.p}${s.f ? ` f=${s.f}` : ""} (${s.pairs.toLocaleString()} pairs)`).join("; ")}.{" "}
      Everything in this preliminary section is measured on validation shots (seed 3). Those shots were also used to choose tiers and thresholds, so it is not an unbiased evaluation. {splits.includes("test") ? "Frozen-test records exist, but final numbers are reported only by the frozen-test evaluation above, once it is complete." : ""}
      {rec.incomplete.length > 0 && <> Incomplete (one basis only, not shown): {rec.incomplete.map((s) => `${s.split} p=${s.p}`).join(", ")}.</>}
    </Note>
  );
}

// ---------------------------------------------------------------- Fig 7.1 LER per cycle vs p
export function LerFigure() {
  const rec = useRecords();
  const ref = useGet<Reference>(`${AEGIS}/reference`);
  const split = "val";   // preliminary figures use validation shots only; final numbers come from the frozen evaluation above
  if (rec.error) return <ErrorBox error={rec.error} what="Records" />;
  if (!rec.data) return <Loading what="Summarizing per-shot records" />;
  const settings = rec.data.settings.filter((s) => s.split === split && s.f === 0).sort((a, b) => a.p - b.p);
  const series: Series[] = TIERS.map((t) => ({
    id: t.id, label: t.label, color: t.color,
    points: settings.filter((s) => s.tiers[t.id]).map((s) => {
      const r = s.tiers[t.id];
      return { x: s.p, y: Math.max(r.ler, r.ler_ci95[1] / 50), lo: r.ler_ci95[0], hi: r.ler_ci95[1], note: `${r.failures_pair} of ${r.pairs.toLocaleString()} pairs failed (X ${r.failures_X}, Z ${r.failures_Z})` };
    }),
  })).filter((s) => s.points.length);
  const refSeries: Series[] = ref.data ? ["relay-BP", "BP-OSD"].map((dname) => ({
    id: `ref-${dname}`, label: `${dname}, kit README (reference)`, color: dname === "relay-BP" ? "var(--s1)" : "var(--s3)", hollow: true, dashed: true, width: 1,
    points: ref.data!.rows.filter((r) => r.decoder === dname).map((r) => ({ x: r.p, y: r.ler, note: `failures X, Z: ${r.failures} of 10,000` })),
  })) : [];
  const n = settings.map((s) => `${s.pairs.toLocaleString()} pairs at p = ${s.p}`).join(", ");
  return (
    <>
      <SplitNote rec={rec.data} />
      <Figure n="7.1" title="PRELIMINARY · Logical error rate per cycle on validation shots, by decoder" testid="fig-7-1"
        source={<Provenance source="stored" detail="experiments/records · validation · not final" />}
        assumptions={<>The kit&apos;s X and Z memory circuits (12 cycles, uniform circuit-level depolarizing noise p, noiseless final readout). Shot k of X is paired with shot k of Z, and a pair fails if either basis predicts any of the 12 observables wrong. LER per cycle = 1 − (1 − P)<sup>1/12</sup>.</>}
        sample={<>{n}. Seed {settings[0]?.seed ?? "—"} ({split === "val" ? "validation" : split}). The same shots are decoded by every decoder, so the comparisons are paired.</>}
        uncertainty={<>Bars are 95% Wilson intervals on the pair failure fraction, mapped through the per-cycle formula. With few failures (for example 3 of 4,000) the interval spans about an order of magnitude. A point with zero failures sits at its upper bound ÷ 50.</>}
        limitations={<>Three noise strengths. Validation shots also served for model and threshold selection. The kit README points (hollow, dashed) come from a different machine and different shots: they show agreement, they are not part of this measurement. Erasure settings are excluded here.</>}>
        <Plot series={[...series, ...refSeries]} xLabel="physical error rate p" yLabel="logical error rate per cycle" testid="ler-plot"
          xDomain={[0.0027, 0.0056]} yDomain={[5e-6, 0.3]} xTicks={settings.map((s) => s.p)} />
        <div className="mt-4">
          <DataTable testid="ler-table" align={["l", "r", "r", "r", "r", "r"]}
            head={["Decoder", ...settings.map((s) => `p = ${s.p}: failed pairs`), ...settings.map((s) => `LER/cycle at ${s.p} [95%]`)]}
            rows={TIERS.filter((t) => settings.some((s) => s.tiers[t.id])).map((t) => [
              <span key="l" className="inline-flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />{t.label}</span>,
              ...settings.map((s) => s.tiers[t.id] ? <span key={s.p} data-testid={`ler-fail-${t.id}-${s.p}`}>{s.tiers[t.id].failures_pair} / {s.pairs.toLocaleString()}</span> : "—"),
              ...settings.map((s) => s.tiers[t.id] ? <span key={"l" + s.p} data-testid={`ler-${t.id}-${s.p}`}>{fmtSci(s.tiers[t.id].ler, 2, true)} [{fmtSci(s.tiers[t.id].ler_ci95[0], 1, true)}, {fmtSci(s.tiers[t.id].ler_ci95[1], 1, true)}]</span> : "—"),
            ])} />
        </div>
      </Figure>
    </>
  );
}

// ---------------------------------------------------------------- Fig 7.2 latency distributions
export function LatencyFigure({ split = "val", n = "7.2" }: { split?: string; n?: string }) {
  const rec = useRecords();
  const [p, setP] = useState(0.004);
  const [on, setOn] = useState<string[]>(["relay", "bposd", "relay1"]);
  if (!rec.data) return rec.error ? <ErrorBox error={rec.error} what="Records" /> : <Loading />;
  const ps = [...new Set(rec.data.settings.filter((x) => x.split === split && x.f === 0).map((x) => x.p))].sort();
  const s = rec.data.settings.find((x) => x.split === split && x.p === p && x.f === 0) ?? rec.data.settings.find((x) => x.split === split && x.p === ps[0] && x.f === 0);
  const tiers = [...TIERS, { id: "aegis", label: "QEC-Aegis (online)", color: "var(--ink)", what: "routed" }].filter((t) => s?.tiers[t.id]);
  if (!s) return null;
  return (
    <Figure n={n} title={split === "val" ? "PRELIMINARY · Decode-time distributions per shot pair (X + Z), validation" : `Decode-time distributions per shot pair (X + Z), ${split === "timing" ? "single-worker benchmark" : "frozen test"}`} testid={split === "val" ? "fig-7-2" : `fig-latency-${split}`}
      source={<Provenance source="stored" detail="per-shot timings in the records" />}
      assumptions={<>Wall-clock time of one decode call per basis, summed over the pair. Each decoder runs single-threaded inside one of the parallel worker processes listed in the manifest (8 workers on a 10-core arm64 Mac). Prior updates are timed; sampling is not.</>}
      sample={<>{`${s.pairs.toLocaleString()} pairs at p = ${s.p} (${split === "val" ? "validation, seed 3" : split === "timing" ? "timing shots, seed 5" : "frozen test, seed 2"}), every one decoded by every decoder shown.`}</>}
      uncertainty={<>Mean times carry 95% bootstrap intervals (1,000 resamples). Tail quantiles (p99, max) rest on a few dozen pairs and are the least stable numbers here.</>}
      limitations={<>Measured with 8 decoding workers running at once (and whatever else the machine was doing), so absolute times are inflated and noisy. The project&apos;s dedicated single-worker benchmark (make timing) has not been run yet. Compare shapes and ratios, not absolute milliseconds.</>}>
      <div className="mb-3 flex flex-wrap items-end gap-4">
        <Segmented label="p" value={s.p} onChange={setP} options={ps.map((v) => ({ value: v, label: String(v) }))} testid={split === "val" ? "lat-p" : `lat-p-${split}`} />
        <div className="flex flex-wrap gap-3 font-sans text-[12.5px] text-ink-2">
          {tiers.map((t) => <label key={t.id} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={on.includes(t.id)} onChange={(e) => setOn((o) => e.target.checked ? [...o, t.id] : o.filter((x) => x !== t.id))} />{t.label}</label>)}
        </div>
      </div>
      {s && (
        <>
          <LogHistogram edges={rec.data.latency_edges_ms} xLabel="decode time per pair" testid="lat-hist"
            series={tiers.filter((t) => on.includes(t.id)).map((t) => ({ id: t.id, label: t.label, color: t.color, counts: s.tiers[t.id].latency_counts, total: s.pairs }))} />
          <div className="mt-4">
            <DataTable testid="lat-table" align={["l", "r", "r", "r", "r", "r", "r"]} head={["Decoder", "mean [95%]", "median", "p95", "p99", "max", "not converged"]}
              rows={tiers.map((t) => { const r = s.tiers[t.id]; return [t.label,
                <span key="m" data-testid={`lat-mean-${t.id}`}>{fmtMs(r.ms_mean)} [{fmtMs(r.ms_mean_ci95[0])}, {fmtMs(r.ms_mean_ci95[1])}]</span>,
                fmtMs(r.ms_median), fmtMs(r.ms_p95), <span key="p" data-testid={`lat-p99-${t.id}`}>{fmtMs(r.ms_p99)}</span>, fmtMs(r.ms_max), fmtPct(r.unconverged, 2)]; })} />
          </div>
        </>
      )}
    </Figure>
  );
}

// ---------------------------------------------------------------- Fig 7.3 accuracy against cost
export function FrontierFigure() {
  const rec = useRecords();
  const tr = useGet<{ available: boolean; caveat: string; chosen: Record<string, { tier1: string; tier2: string; model: string; threshold: number; per_setting: Record<string, { failures_pair: number; ler: number; ms_mean: number; escalated: number; relay_failures: number; relay_ms: number }> }> }>(`${AEGIS}/training`);
  const [p, setP] = useState(0.004);
  if (!rec.data) return rec.error ? <ErrorBox error={rec.error} what="Records" /> : <Loading />;
  const s = rec.data.settings.find((x) => x.split === "val" && x.p === p && x.f === 0);
  const ps = [...new Set(rec.data.settings.filter((x) => x.split === "val" && x.f === 0).map((x) => x.p))].sort();
  const tiers = TIERS.filter((t) => s?.tiers[t.id]);
  const routed: Series[] = tr.data?.available ? Object.entries(tr.data.chosen).flatMap(([mode, c], k) => {
    const ps = c.per_setting[`p=${p} f=0.0`];
    if (!ps || !s) return [];
    const [lo, hi] = wilson(ps.failures_pair, s.pairs).map((x) => perCycle(x));
    return [{ id: `aegis-${mode}`, label: `QEC-Aegis (${mode}) ${c.tier1}→${c.tier2}`, color: ["var(--ink)", "var(--ink-2)", "var(--muted)"][k] ?? "var(--ink)", line: false, hollow: k > 0,
      points: [{ x: ps.ms_mean, y: ps.ler, lo, hi, note: `${ps.failures_pair} failed pairs; tier 2 on ${fmtPct(ps.escalated, 2)} of shots; threshold ${c.threshold.toPrecision(3)}` }] }];
  }) : [];
  return (
    <Figure n="7.3" title="Accuracy against mean decode time" testid="fig-7-3"
      source={<Provenance source="stored" detail="records + training.json" />}
      assumptions={<>Same shots and conventions as Fig. 7.1. QEC-Aegis points are routed policies scored exactly from the cached per-shot tier results (aegis.policy): tier-1 time + model time + tier-2 time when escalated.</>}
      sample={<>{s ? `${s.pairs.toLocaleString()} validation pairs at p = ${p}.` : "—"}</>}
      uncertainty={<>Vertical bars: 95% Wilson intervals per cycle. Horizontal positions are means; their bootstrap intervals are in Fig. 7.2.</>}
      limitations={<>{tr.data?.caveat ?? ""} QEC-Aegis points appear only where training evaluated them (p = 0.003, 0.004). Lower-left is better. Points are not independent: they share shots.</>}>
      <div className="mb-3"><Segmented label="p" value={p} onChange={setP} options={ps.map((v) => ({ value: v, label: String(v) }))} testid="fr-p" /></div>
      {s && <Plot testid="frontier-plot" xLabel="mean decode time per pair (ms)" yLabel="logical error rate per cycle"
        series={[...tiers.map((t) => ({ id: t.id, label: t.label, color: t.color, line: false, points: [{ x: s.tiers[t.id].ms_mean, y: s.tiers[t.id].ler, lo: s.tiers[t.id].ler_ci95[0], hi: s.tiers[t.id].ler_ci95[1], note: t.what }] })), ...routed]} />}
    </Figure>
  );
}

// ---------------------------------------------------------------- Fig 7.4 calibration
export function CalibrationFigure() {
  const c = useGet<{ available: boolean; predicted: number[]; observed: number[]; observed_ci95: [number, number][]; shots: number[]; split: string }>(`${AEGIS}/calibration`);
  if (!c.data) return c.error ? <ErrorBox error={c.error} what="Calibration" /> : <Loading />;
  if (!c.data.available) return <p className="font-sans text-[13px] text-muted">No calibration report stored yet.</p>;
  const d = c.data, total = d.shots.reduce((a, b) => a + b, 0);
  const pts = d.predicted.map((x, i) => ({ x, y: Math.max(d.observed[i], 1e-6), lo: Math.max(d.observed_ci95[i][0], 1e-6), hi: d.observed_ci95[i][1], note: `${d.shots[i].toLocaleString()} shots in this bin` }));
  return (
    <Figure n="7.4" title="Is the router's risk a probability? Reliability of the calibrated model" testid="fig-7-4"
      source={<Provenance source="stored" detail="experiments/reports/calibration.json" />}
      assumptions={<>Shots binned by predicted risk r(φ). Observed = fraction of shots in the bin whose tier-1 answer was logically wrong. Perfect calibration lies on the diagonal.</>}
      sample={<>{total.toLocaleString()} {d.split} shots in {d.shots.length} bins. The high-risk bins hold only {d.shots.slice(-3).join(", ")} shots.</>}
      uncertainty={<>95% intervals on each observed fraction, as stored. Bins with an observed rate of 0 are drawn at 10⁻⁶.</>}
      limitations={<>Most shots sit in the lowest bins, so the high-risk end is poorly constrained. Calibration was fitted on separate calibration shots (seed 4) but is shown here on validation shots.</>}>
      <Plot testid="calib-plot" xLabel="predicted risk" yLabel="observed tier-1 failure rate" xDomain={[3e-6, 0.6]} yDomain={[5e-7, 1]}
        series={[{ id: "cal", label: "calibrated GBM risk", color: "var(--s1)", points: pts }]}
        extra={(sx, sy) => <line x1={sx(3e-6)} y1={sy(3e-6)} x2={sx(0.6)} y2={sy(0.6)} stroke="var(--muted)" strokeDasharray="4 4" />} />
      <div className="mt-1 font-sans text-[12px] text-muted">Dashed line: perfect calibration.</div>
    </Figure>
  );
}

// ---------------------------------------------------------------- resources
type Run = { record: string; split: string; basis: string; p: number; f: number; shots: number; tiers: string[]; workers: number; wall_seconds: number; cpu_seconds: number; peak_worker_rss_mb: number; finished: string; environment: Record<string, string | number> };
export function ResourcesTable({ splits }: { splits?: string[] }) {
  const m = useGet<{ runs: Run[] }>(`${AEGIS}/manifest`);
  const runs = (m.data?.runs ?? []).filter((r) => !splits || splits.includes(r.split));
  const tot = useMemo(() => ({ cpu: runs.reduce((a, r) => a + (r.cpu_seconds ?? 0), 0), wall: runs.reduce((a, r) => a + (r.wall_seconds ?? 0), 0), rss: Math.max(0, ...runs.map((r) => r.peak_worker_rss_mb ?? 0)) }), [runs]);
  if (!m.data) return m.error ? <ErrorBox error={m.error} what="Manifest" /> : <Loading />;
  const env = runs[runs.length - 1]?.environment ?? {};
  return (
    <div data-testid={splits ? `resources-${splits.join("-")}` : "resources"}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Logged decoding runs" value={runs.length} testid="res-runs" />
        <Stat label="Total CPU time" value={`${(tot.cpu / 3600).toFixed(1)} h`} sub="sum over runs" testid="res-cpu" />
        <Stat label="Total wall time" value={`${(tot.wall / 3600).toFixed(1)} h`} />
        <Stat label="Peak worker memory" value={`${tot.rss.toFixed(0)} MB`} sub="largest single process" />
      </div>
      <p className="mt-2 font-sans text-[12px] text-muted">Environment of the latest run: {Object.entries(env).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
      <div className="mt-3 max-h-[380px] overflow-auto">
        <DataTable testid="res-table" align={["l", "l", "r", "r", "l", "r", "r", "r", "l"]} head={["Record", "Split", "p", "Shots", "Tiers", "Wall", "CPU", "Peak RSS", "Finished"]}
          rows={runs.slice().reverse().map((r) => [r.record?.split("/").pop(), r.split, r.p, r.shots?.toLocaleString(), (r.tiers ?? []).join(" "),
            `${(r.wall_seconds / 60).toFixed(1)} min`, `${(r.cpu_seconds / 3600).toFixed(2)} h`, `${r.peak_worker_rss_mb?.toFixed(0)} MB`, r.finished])} />
      </div>
    </div>
  );
}
