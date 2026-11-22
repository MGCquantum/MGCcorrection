"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Plot, type Series } from "@/components/charts/Plot";
import { DataTable, ErrorBox, Loading, Segmented, Stat } from "@/components/Controls";
import { Figure, Panel } from "@/components/Layout";
import { Provenance } from "@/components/Provenance";
import { AEGIS, useGet } from "@/lib/api";
import { fmtMs, fmtPct, fmtSci } from "@/lib/stats";

type Dec = {
  pairs: number; failures_X: number; failures_Z: number; failures_pair: number; ler: number; ler_ci95: [number, number];
  ms_mean: number; ms_mean_ci95: [number, number]; ms_median: number; ms_p95: number; ms_p99: number; ms_max: number;
  escalated_fraction?: number; tiers?: string; model?: string; threshold?: number;
  escalated?: number; shots?: number; unconverged?: number; flagged_by_model?: number; tier1_wrong?: number; tier1_wrong_escalated?: number;
  hidden_failures?: number; hidden_failures_caught?: number; fixed_by_tier2?: number; broken_by_tier2?: number; needless?: number;
};
type Cmp = { both_fail: number; only_a_fails: number; only_b_fails: number; mcnemar_p: number; ler_ratio: number | null; ler_ratio_ci95: [number, number] | null; speedup_mean?: number; speedup_mean_ci95?: [number, number] };
type FrontierPt = { threshold: number; failures_pair: number; ler: number; ms_mean: number; escalated: number };
type Setting = { decoders: Record<string, Dec>; comparisons: Record<string, Cmp>; model_quality: Record<string, number>; frontier?: FrontierPt[]; pareto?: FrontierPt[]; online_agrees_with_cached?: { decisions: number; failures: number } };
type Report = { fixture?: string; model: Record<string, unknown>; loss_model?: Record<string, unknown>; sweep: Record<string, Setting>; timing: Record<string, Setting>; loss: Record<string, Setting> };
type Artifact = { kind: string; label: string; state: string; shots: number; bases: Record<string, { state: string; chunks: number; of: number }> };
type Pipeline = { artifacts: Artifact[]; loss_model: boolean; figures: string[]; runner: null | { state: string; started: string; updated: string; steps: { name: string; state: string; started?: string; finished?: string; exit_code?: number; load_average_at_start?: number[] }[] };
  processes: { pid: number; command: string }[]; start_command: string; evaluation_written: string | null };
export type Evaluation = { state: "pending" | "running" | "failed" | "partial" | "completed"; final: boolean; gaps: string[]; written: string | null; pipeline: Pipeline; report: Report | null };

/** Fixed decoder order and colours (identity, never rank). */
const DEC: { id: string; color: string; dashed?: boolean; hollow?: boolean }[] = [
  { id: "relay", color: "var(--s1)" }, { id: "bposd", color: "var(--s3)" }, { id: "tier 1 alone", color: "var(--s2)" },
  { id: "rule (no ML)", color: "var(--s5)" }, { id: "heuristic", color: "var(--s6)" }, { id: "aegis", color: "var(--s4)" },
  { id: "aegis (online)", color: "var(--ink)" }, { id: "aegis (accuracy mode)", color: "var(--muted)", dashed: true },
  { id: "bp200 -> relay (rule)", color: "var(--s6)", dashed: true, hollow: true }, { id: "tier 2 alone", color: "var(--s1)", dashed: true, hollow: true },
  { id: "relay (flags ignored)", color: "var(--s1)", dashed: true }, { id: "bposd (flags ignored)", color: "var(--s3)", dashed: true },
  { id: "relay+flags", color: "var(--s1)" }, { id: "bposd+flags", color: "var(--s3)" },
  // Uses the truth to route: a bound on what any router with these two tiers could reach, not a decoder.
  { id: "oracle router (knows the truth; unattainable)", color: "var(--muted)", dashed: true, hollow: true },
];
const colorOf = (name: string) => DEC.find((d) => d.id === name) ?? { id: name, color: "var(--muted)" };

const STATE: Record<Evaluation["state"], { label: string; glyph: string; color: string }> = {
  pending: { label: "Not run yet", glyph: "○", color: "var(--muted)" },
  running: { label: "Running", glyph: "◐", color: "var(--accent)" },
  failed: { label: "Failed", glyph: "✗", color: "var(--fault)" },
  partial: { label: "Incomplete: not final", glyph: "◑", color: "var(--prov-hardware)" },
  completed: { label: "Final", glyph: "●", color: "var(--s5)" },
};

export function useEvaluation() {
  const ev = useGet<Evaluation>(`${AEGIS}/evaluation`);
  const running = ev.data?.state === "running";
  const { reload } = ev;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [running, reload]);
  return ev;
}

export function FrozenEvaluation() {
  const ev = useEvaluation();
  if (ev.error) return <ErrorBox error={ev.error} what="Evaluation" />;
  if (!ev.data) return <Loading what="Reading the evaluation state" />;
  const e = ev.data;
  return (
    <div className="space-y-8" data-testid="frozen-evaluation" data-state={e.state}>
      <StateBanner e={e} />
      {e.report?.fixture && <div role="alert" className="rounded-md border-2 border-fault p-3 font-sans text-[13px] text-fault">TEST FIXTURE, NOT A RESULT: {e.report.fixture}</div>}
      {e.state !== "completed" && <PipelineProgress p={e.pipeline} />}
      {e.report && (e.state === "completed" || e.state === "partial" || (e.state === "running" && e.report)) && <ReportView r={e.report} final={e.final} written={e.written} figures={e.pipeline.figures} />}
    </div>
  );
}

function StateBanner({ e }: { e: Evaluation }) {
  const s = STATE[e.state];
  const step = e.pipeline.runner?.steps.find((x) => x.state === "running" || x.state === "failed");
  const text: Record<Evaluation["state"], ReactNode> = {
    pending: <>No frozen-test evaluation exists on this machine yet, so this page shows <strong>no final results</strong>. The validation figures further down are preliminary. The pipeline below has to run first: start it with <code className="num">{e.pipeline.start_command}</code> (or <code className="num">make evaluate-frozen</code>). It takes several hours on 8 cores and resumes from its checkpoints.</>,
    running: <>The pipeline is running{step ? <> (step <strong>{step.name}</strong> since {step.started})</> : null}. Results appear here when <span className="num">aegis.evaluate</span> has covered every setting. This page refreshes every 30 s.</>,
    failed: <>The pipeline stopped at step <strong>{step?.name ?? "?"}</strong> with exit code {step?.exit_code ?? "?"} at {step?.finished}. See <code className="num">logs/frozen_evaluation.log</code>. Resume with <code className="num">./scripts/run_frozen_evaluation.sh --from {step?.name ?? "train"}</code>.</>,
    partial: <>A report exists (written {e.written}), but it is <strong>not final</strong>: {e.gaps.join("; ")}. Shown below for inspection, marked as incomplete.</>,
    completed: <>Every planned setting is evaluated on the frozen test shots (seed 2), and no record changed after the report was written ({e.written}). The model, its threshold and the tiers were fixed on validation data before these shots were decoded.</>,
  };
  return (
    <div className="rounded-md border-2 p-5" style={{ borderColor: s.color }} data-testid="eval-state">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-sans text-[15px] font-semibold" style={{ color: s.color }} data-testid="eval-state-label"><span aria-hidden>{s.glyph} </span>Frozen-test evaluation: {s.label}</span>
        <Provenance source="stored" detail="experiments/reports/evaluation.json" />
      </div>
      <p className="mt-2 max-w-[60rem] font-sans text-[13.5px] leading-relaxed text-ink-2">{text[e.state]}</p>
    </div>
  );
}

function Bar({ done, of, state }: { done: number; of: number; state: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 rounded-sm bg-sunken"><div className="h-full rounded-sm" style={{ width: `${(100 * done) / of}%`, background: state === "done" ? "var(--s5)" : "var(--accent)" }} /></div>
      <span className="num text-[11.5px] text-muted">{done}/{of}</span>
    </div>
  );
}

function PipelineProgress({ p }: { p: Pipeline }) {
  return (
    <Panel title="Pipeline progress: every artifact the frozen evaluation needs" source={<Provenance source="live" detail="records, checkpoints, ps" />} testid="pipeline-progress">
      <DataTable testid="pipeline-table" align={["l", "l", "r", "l", "l"]} head={["Artifact", "State", "Shots / basis", "X memory (chunks)", "Z memory (chunks)"]}
        rows={p.artifacts.map((a) => [a.label, <span key="s" data-testid={`pa-${a.label}`} style={{ color: a.state === "done" ? "var(--s5)" : a.state === "partial" ? "var(--accent)" : "var(--muted)" }}>{a.state}</span>,
          a.shots.toLocaleString(), <Bar key="x" done={a.bases.X.chunks} of={a.bases.X.of} state={a.bases.X.state} />, <Bar key="z" done={a.bases.Z.chunks} of={a.bases.Z.of} state={a.bases.Z.state} />])} />
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Stat label="Erasure router model" value={p.loss_model ? "trained" : "not trained"} sub="models/aegis_router_loss.joblib" />
        <Stat label="Pipeline processes" value={p.processes.length} sub={p.processes.length ? p.processes.map((x) => x.pid).join(", ") : "none running"} testid="pipeline-procs" />
        <Stat label="Runner" value={p.runner?.state ?? "never started"} sub={p.runner ? `updated ${p.runner.updated}` : p.start_command} />
      </div>
      {p.runner && (
        <div className="mt-3">
          <DataTable testid="runner-steps" align={["l", "l", "l", "l", "l"]} head={["Step", "State", "Started", "Finished", "Load at start"]}
            rows={p.runner.steps.map((s) => [s.name, s.state + (s.exit_code ? ` (exit ${s.exit_code})` : ""), s.started ?? "", s.finished ?? "", s.load_average_at_start?.join(" / ") ?? ""])} />
        </div>
      )}
    </Panel>
  );
}

function NotFinal({ final }: { final: boolean }) {
  return final ? <Provenance source="stored" detail="final · frozen test, seed 2" /> : (
    <span className="rounded-full border border-[var(--prov-hardware)] px-2 py-[1px] font-sans text-[11.5px] font-semibold text-[var(--prov-hardware)]">NOT FINAL</span>
  );
}

function ReportView({ r, final, written, figures }: { r: Report; final: boolean; written: string | null; figures: string[] }) {
  const ps = Object.keys(r.sweep).sort();
  const [p, setP] = useState(ps.includes("0.004") ? "0.004" : ps[0]);
  const names = [...new Set(ps.flatMap((k) => Object.keys(r.sweep[k].decoders)))];
  const series: Series[] = names.map((n) => {
    const c = colorOf(n);
    return { id: n, label: n, color: c.color, dashed: c.dashed, hollow: c.hollow,
      points: ps.filter((k) => r.sweep[k].decoders[n]).map((k) => { const d = r.sweep[k].decoders[n]; return { x: +k, y: d.ler, lo: d.ler_ci95[0], hi: d.ler_ci95[1], note: `${d.failures_pair} of ${d.pairs.toLocaleString()} pairs` }; }) };
  });
  const s = r.sweep[p];
  const totalPairs = ps.map((k) => `${Object.values(r.sweep[k].decoders)[0]?.pairs.toLocaleString()} at p = ${k}`).join(", ");
  const model = r.model as { name?: string; tier1?: string; tier2?: string; threshold?: number };
  return (
    <div className="space-y-2" data-testid="eval-report" data-final={final ? 1 : 0}>
      <Figure n="7.F1" title="Frozen test set: logical error rate per cycle, every decoder and routing policy" testid="fig-eval-ler"
        source={<NotFinal final={final} />}
        assumptions={<>aegis.evaluate on the frozen test records (seed 2). Router {model.name}: {model.tier1} → {model.tier2}, τ = {Number(model.threshold).toPrecision(3)}, all fixed on validation data. A pair fails when either basis fails. LER per cycle = 1 − (1 − P)<sup>1/12</sup>.</>}
        sample={<>{totalPairs} shot pairs. Every decoder decodes the same shots.</>}
        uncertainty={<>95% Wilson intervals on the pair failure fraction (aegis.policy.summarize), drawn as bars. Paired comparisons below use McNemar&apos;s exact test and paired-bootstrap ratios.</>}
        limitations={<>Times in this figure&apos;s tables come from parallel workers; the single-worker latency table is the timing reference. Report written {written ?? "—"}.</>}>
        <Plot series={series} xLabel="physical error rate p" yLabel="logical error rate per cycle" xTicks={ps.map(Number)} xDomain={[0.0027, 0.0056]} testid="eval-ler-plot" />
        <div className="mt-4 mb-2"><Segmented label="Setting" value={p} onChange={setP} options={ps.map((k) => ({ value: k, label: `p = ${k}` }))} testid="eval-p" /></div>
        <DataTable testid="eval-table" align={["l", "r", "r", "r", "r", "r", "r", "r"]}
          head={["Decoder", "Failures X, Z", "Pair failures", "LER / cycle [95%]", "Mean [95%]", "Median", "p99", "Tier 2 used"]}
          rows={Object.entries(s.decoders).map(([n, d]) => [
            <span key="n" className="inline-flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(n).color }} />{n}</span>,
            `${d.failures_X}, ${d.failures_Z}`, <span key="f" data-testid={`ev-fail-${n}`}>{d.failures_pair} / {d.pairs.toLocaleString()}</span>,
            <span key="l" data-testid={`ev-ler-${n}`}>{fmtSci(d.ler, 2, true)} [{fmtSci(d.ler_ci95[0], 1, true)}, {fmtSci(d.ler_ci95[1], 1, true)}]</span>,
            `${fmtMs(d.ms_mean)} [${fmtMs(d.ms_mean_ci95[0])}, ${fmtMs(d.ms_mean_ci95[1])}]`, fmtMs(d.ms_median), fmtMs(d.ms_p99), d.escalated_fraction === undefined ? "—" : fmtPct(d.escalated_fraction, 2)])} />
        <div className="mt-5 mb-1 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Paired comparisons at p = {p}</div>
        <DataTable testid="eval-comparisons" align={["l", "r", "r", "r", "r"]} head={["Comparison", "Only A fails / only B fails", "McNemar p", "LER ratio A/B [95%]", "Speed-up B→A [95%]"]}
          rows={Object.entries(s.comparisons).map(([k, c]) => [k, `${c.only_a_fails} / ${c.only_b_fails}`, c.mcnemar_p.toFixed(3),
            c.ler_ratio === null ? "n/a" : `${c.ler_ratio.toFixed(2)} [${c.ler_ratio_ci95?.[0].toFixed(2)}, ${c.ler_ratio_ci95?.[1].toFixed(2)}]`,
            c.speedup_mean === undefined ? "—" : `${c.speedup_mean.toFixed(2)}× [${c.speedup_mean_ci95?.[0].toFixed(2)}, ${c.speedup_mean_ci95?.[1].toFixed(2)}]`])} />
        <div className="mt-5 mb-1 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">What each router did at p = {p} (pooled over both bases)</div>
        <DataTable testid="eval-diagnostics" align={["l", "r", "r", "r", "r", "r", "r", "r"]}
          head={["Policy", "Escalated", "Tier 1 not converged", "Tier 1 wrong", "…of which escalated", "Hidden failures caught", "Fixed / broken by tier 2", "Needless escalations"]}
          rows={Object.entries(s.decoders).filter(([, d]) => d.escalated !== undefined).map(([n, d]) => [n, `${d.escalated} (${fmtPct(d.escalated_fraction ?? 0, 2)})`, d.unconverged,
            d.tier1_wrong, d.tier1_wrong_escalated, `${d.hidden_failures_caught} of ${d.hidden_failures}`, `${d.fixed_by_tier2} / ${d.broken_by_tier2}`, d.needless])} />
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5" data-testid="eval-model-quality">
          {(["auc", "average_precision", "brier", "ece", "base_rate"] as const).map((k) => s.model_quality[k] !== undefined && (
            <Stat key={k} label={`Router ${k.replace("_", " ")}`} value={k === "auc" || k === "average_precision" ? s.model_quality[k].toFixed(3) : s.model_quality[k].toExponential(2)} sub="on these test shots" />))}
        </div>
        {s.online_agrees_with_cached && <p className="mt-3 font-sans text-[12.5px] text-ink-2">The online QEC-Aegis program agrees with the cached policy on {fmtPct(s.online_agrees_with_cached.decisions, 2)} of routing decisions and {fmtPct(s.online_agrees_with_cached.failures, 2)} of outcomes. Tier 2 is randomized, so outcomes agree statistically, not shot by shot.</p>}
      </Figure>

      {s.frontier && (
        <Figure n="7.F2" title="Accuracy against mean time across router thresholds" testid="fig-eval-frontier" source={<NotFinal final={final} />}
          assumptions={<>Each point is one threshold τ applied to the cached test records (aegis.policy.frontier). Pareto-optimal thresholds are joined. The chosen τ was fixed on validation data, not picked from this curve.</>}
          sample={<>The same test pairs as Fig. 7.F1 at p = {p}.</>}
          uncertainty={<>Points share shots, so their differences are correlated. Intervals for the deployed threshold are in the table above.</>}
          limitations={<>Times are sums of per-stage times measured with parallel workers.</>}>
          <Plot testid="eval-frontier-plot" xLabel="mean decode time per pair (ms)" yLabel="logical error rate per cycle"
            series={[
              { id: "frontier", label: "every threshold", color: "var(--muted)", line: false, points: s.frontier.map((f) => ({ x: f.ms_mean, y: Math.max(f.ler, 1e-7), note: `τ = ${f.threshold.toPrecision(3)}, ${f.failures_pair} failures, tier 2 on ${fmtPct(f.escalated, 2)}` })) },
              { id: "pareto", label: "Pareto front", color: "var(--s4)", points: (s.pareto ?? []).map((f) => ({ x: f.ms_mean, y: Math.max(f.ler, 1e-7), note: `τ = ${f.threshold.toPrecision(3)}` })) },
              ...["relay", "bposd", "aegis"].filter((n) => s.decoders[n]).map((n) => ({ id: `pt-${n}`, label: n, color: colorOf(n).color, line: false, points: [{ x: s.decoders[n].ms_mean, y: s.decoders[n].ler, lo: s.decoders[n].ler_ci95[0], hi: s.decoders[n].ler_ci95[1] }] })),
            ]} />
        </Figure>
      )}

      {Object.keys(r.timing).length > 0 && (
        <Figure n="7.F3" title="Decoding latency, single worker" testid="fig-eval-timing" source={<NotFinal final={final} />}
          assumptions={<>run_final.sh timing: one worker process, separate shots (seed 5). Each decoder&apos;s decode call is timed per shot, and a pair&apos;s time is X + Z.</>}
          sample={<>{Object.entries(r.timing).map(([k, t]) => `${Object.values(t.decoders)[0]?.pairs.toLocaleString()} pairs at p = ${k}`).join(", ")}. Too few for error rates: use Fig. 7.F1 for those.</>}
          uncertainty={<>Mean intervals are 1,000-sample bootstraps. p99 and max rest on a handful of pairs.</>}
          limitations={<>One machine. The benchmark assumes nothing else ran; the runner records the load average at the start of each step.</>}>
          <DataTable testid="eval-timing" align={["l", "l", "r", "r", "r", "r", "r"]} head={["p", "Decoder", "Mean [95%]", "Median", "p95", "p99", "Max"]}
            rows={Object.entries(r.timing).flatMap(([k, t]) => Object.entries(t.decoders).filter(([n]) => ["bposd", "relay", "aegis", "aegis (online)"].includes(n)).map(([n, d]) => [k, n,
              `${fmtMs(d.ms_mean)} [${fmtMs(d.ms_mean_ci95[0])}, ${fmtMs(d.ms_mean_ci95[1])}]`, fmtMs(d.ms_median), fmtMs(d.ms_p95), fmtMs(d.ms_p99), fmtMs(d.ms_max)]))} />
        </Figure>
      )}

      {Object.keys(r.loss).length > 0 && <ErasureView r={r} final={final} />}

      {figures.length > 0 && (
        <Panel title="Final figures written by aegis.figures" source={<NotFinal final={final} />} testid="eval-figures">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {figures.map((f) => (
              <figure key={f} className="rounded-[5px] border border-rule p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/aegis-figures/${f}`} alt={`Figure ${f} from docs/figures`} className="w-full" />
                <figcaption className="num mt-1 text-[11.5px] text-muted">docs/figures/{f}</figcaption>
              </figure>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function ErasureView({ r, final }: { r: Report; final: boolean }) {
  const fs = Object.keys(r.loss).sort();
  const names = [...new Set(fs.flatMap((f) => Object.keys(r.loss[f].decoders)))];
  const lm = r.loss_model as { name?: string; tier1?: string; tier2?: string; threshold?: number } | undefined;
  return (
    <Figure n="7.F4" title="Heralded erasure at p = 0.004: does knowing where errors happened help?" testid="fig-eval-erasure" source={<NotFinal final={final} />}
      assumptions={<>A fraction f of every depolarizing channel becomes a heralded erasure at fixed total noise (the team&apos;s lossy model). &quot;+flags&quot; decoders receive per-shot priors from the herald flags. The erasure router{lm ? ` (${lm.name}: ${lm.tier1} → ${lm.tier2}, τ = ${Number(lm.threshold).toPrecision(3)})` : ""} was trained on erasure data.</>}
      sample={<>{fs.map((f) => `${Object.values(r.loss[f].decoders)[0]?.pairs.toLocaleString()} pairs at f = ${f}`).join(", ")}.</>}
      uncertainty={<>95% Wilson intervals, drawn as bars.</>}
      limitations={<>A simplified heralded-erasure model, not a full neutral-atom loss model. One noise strength.</>}>
      <Plot testid="eval-erasure-plot" xLog={false} xLabel="erasure fraction f" yLabel="logical error rate per cycle" xTicks={fs.map(Number)} xDomain={[0.18, 0.82]}
        series={names.map((n) => ({ id: n, label: n, color: colorOf(n).color, dashed: colorOf(n).dashed,
          points: fs.filter((f) => r.loss[f].decoders[n]).map((f) => { const d = r.loss[f].decoders[n]; return { x: +f, y: Math.max(d.ler, 1e-7), lo: d.ler_ci95[0], hi: d.ler_ci95[1], note: `${d.failures_pair} of ${d.pairs}` }; }) }))} />
      <div className="mt-4">
        <DataTable testid="eval-erasure-table" align={["l", "l", "r", "r", "r"]} head={["f", "Decoder", "Pair failures", "LER / cycle [95%]", "Mean"]}
          rows={fs.flatMap((f) => Object.entries(r.loss[f].decoders).map(([n, d]) => [f, n, `${d.failures_pair} / ${d.pairs.toLocaleString()}`, `${fmtSci(d.ler, 2, true)} [${fmtSci(d.ler_ci95[0], 1, true)}, ${fmtSci(d.ler_ci95[1], 1, true)}]`, fmtMs(d.ms_mean)]))} />
      </div>
    </Figure>
  );
}

/** Renders its children only once the frozen evaluation is complete (final results only). */
export function WhenFinal({ children }: { children: ReactNode }) {
  const ev = useEvaluation();
  return ev.data?.state === "completed" ? <>{children}</> : null;
}
