"use client";
import { useState } from "react";
import { DataTable, ErrorBox, Loading, Segmented, Stat } from "@/components/Controls";
import { Figure, Panel } from "@/components/Layout";
import { Provenance } from "@/components/Provenance";
import { AEGIS, useGet } from "@/lib/api";
import { fmtMs, fmtPct, fmtSci } from "@/lib/stats";

type Row = { failures_X: number; failures_Z: number; failures_pair: number; ler: number; ms_mean: number; ms_p99: number; escalated?: number; unconverged?: number };
type Study = {
  p: number; split: string; pairs: number; written: string;
  paired_outcomes_bposd_relay: Record<string, { shots: number; bposd_ms: number; relay_ms: number }>;
  tiers: Record<string, Row>; bposd_relay_routing: Record<string, Row>; rule_based: Record<string, Row>;
  hidden_failures: Record<string, { converged_but_wrong: number; converged: number; shots: number }>;
};
type Predecoder = { p: number; basis: string; shots: number; split: string; train_shots: number; commit_level: number; committed_per_shot: number; table_max: number;
  results: Record<string, { failed: number; unconverged: number; ms_mean: number; iterations_mean: number }> };
type Results = { source: string; available: boolean; studies: Study[]; predecoder: Predecoder | null };
type Chosen = { tier1: string; tier2: string; model: string; file: string; threshold: number; failures: number; mean_ms: number;
  per_setting: Record<string, { threshold: number; failures_pair: number; ler: number; ms_mean: number; escalated: number; relay_failures: number; relay_ms: number }> };
type Training = { available: boolean; written: string; caveat: string; settings: number[][]; chosen: Record<string, Chosen>;
  ranking: Record<string, { shots: number; wrong: number; auc: number; average_precision: number; brier: number; ece: number; inference_us?: number }> };
type Methods = { docs: Record<string, string>; feature_groups: Record<string, string[]> };

const TIER_NOTE: Record<string, string> = {
  bposd: "kit BP-OSD", relay: "kit relay-BP", relay1: "relay-BP, first solution", fast: "relay-BP, first solution, ≤ 10 legs", fast0: "first leg only",
  strong: "lightest of 20, ≤ 600 legs", strong10: "lightest of 10, ≤ 600 legs", bp30: "min-sum, 30 it.", bp200: "min-sum, 200 it.",
};

export function useStudies() { return useGet<Results>(`${AEGIS}/results`); }

function StudyPicker({ studies, value, onChange }: { studies: Study[]; value: number; onChange: (p: number) => void }) {
  return <Segmented label="Validation study" value={value} onChange={onChange} options={studies.map((s) => ({ value: s.p, label: `p = ${s.p} (${s.pairs.toLocaleString()} pairs)` }))} testid="study-p" />;
}

// ---------------------------------------------------------------- 1. shot-by-shot BP-OSD vs relay-BP
export function PairedOutcomes() {
  const r = useStudies();
  const [p, setP] = useState(0.004);
  if (r.error) return <ErrorBox error={r.error} what="Studies" />;
  if (!r.data) return <Loading />;
  const s = r.data.studies.find((x) => x.p === p) ?? r.data.studies[0];
  if (!s) return <p className="font-sans text-[13px] text-muted">No decoder study stored yet.</p>;
  const cells = s.paired_outcomes_bposd_relay;
  const get = (k: string) => cells[k];
  return (
    <Figure n="5.1" title="BP-OSD against relay-BP, shot by shot" testid="paired-outcomes"
      source={<Provenance source="stored" detail={`complementarity_p${s.p}.json · written ${s.written}`} />}
      assumptions={<>Every validation shot (seed 3) decoded by both kit baselines at their published settings. A shot is &quot;correct&quot; when all 12 predicted observables match the simulator. Times are the mean decode time of the shots in that cell.</>}
      sample={<>{s.pairs.toLocaleString()} shot pairs = {(2 * s.pairs).toLocaleString()} shots (X and Z memories) at p = {s.p}.</>}
      uncertainty={<>Counts are exact. The off-diagonal cells are small, so their mean times rest on few shots.</>}
      limitations={<>Validation shots, not the frozen test set. Times come from 8 parallel workers.</>}>
      {r.data.studies.length > 1 && <div className="mb-3"><StudyPicker studies={r.data.studies} value={s.p} onChange={setP} /></div>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
        <table className="border-collapse font-sans text-[13px]" data-testid="paired-matrix">
          <thead><tr><th /><th className="px-3 pb-2 text-left font-medium text-muted">relay-BP correct</th><th className="px-3 pb-2 text-left font-medium text-muted">relay-BP wrong</th></tr></thead>
          <tbody>
            {[["BP-OSD correct", "both correct", "bposd correct, relay wrong"], ["BP-OSD wrong", "relay correct, bposd wrong", "both wrong"]].map(([rowLabel, a, b]) => (
              <tr key={rowLabel}>
                <th className="pr-3 text-left font-medium text-muted">{rowLabel}</th>
                {[a, b].map((k) => (
                  <td key={k} className="border border-rule p-3 align-top" style={{ background: k === "both correct" ? "var(--sunken)" : k === "both wrong" ? "color-mix(in srgb, var(--fault) 8%, transparent)" : "color-mix(in srgb, var(--accent) 8%, transparent)" }}>
                    <div className="num text-[1.25rem] text-ink" data-testid={`po-${k.replaceAll(" ", "-").replaceAll(",", "")}`}>{get(k)?.shots.toLocaleString() ?? "—"}</div>
                    <div className="num text-[11.5px] text-muted">BP-OSD {fmtMs(get(k)?.bposd_ms)} · relay {fmtMs(get(k)?.relay_ms)}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="font-sans text-[13px] leading-relaxed text-ink-2">
          <p>
            The two baselines disagree on <strong>{(get("bposd correct, relay wrong")?.shots ?? 0) + (get("relay correct, bposd wrong")?.shots ?? 0)}</strong> shots.
            relay-BP alone is right on <strong>{get("relay correct, bposd wrong")?.shots}</strong> of them and BP-OSD alone on <strong>{get("bposd correct, relay wrong")?.shots}</strong>.
            The decoders are only weakly complementary: an ideal switch between them would fix the second group only.
          </p>
          <p className="mt-2">
            The shots where one decoder fails are also its slow shots: compare each off-diagonal cell&apos;s times with the &quot;both correct&quot; cell. Hardness shows up in decode time,
            and decode time is something a router can observe.
          </p>
        </div>
      </div>
    </Figure>
  );
}

// ---------------------------------------------------------------- 2. every evaluated routing rule, with its perfect-router bound
export function RoutingRules() {
  const r = useStudies();
  const [p, setP] = useState(0.004);
  if (!r.data) return r.error ? <ErrorBox error={r.error} what="Studies" /> : <Loading />;
  const s = r.data.studies.find((x) => x.p === p) ?? r.data.studies[0];
  if (!s) return null;
  const rules = Object.keys(s.rule_based).filter((k) => !k.endsWith("(perfect router)"));
  const row = (name: string, d: Row, bound?: Row) => [
    <span key="n" className="font-medium text-ink">{name}</span>, `${d.failures_X}, ${d.failures_Z}`, d.failures_pair, fmtSci(d.ler, 2, true), fmtMs(d.ms_mean), fmtMs(d.ms_p99),
    d.escalated === undefined ? "—" : fmtPct(d.escalated, 1),
    bound ? <span key="b" data-testid={`rule-bound-${name}`}>{bound.failures_pair} · {fmtSci(bound.ler, 2, true)}</span> : "—",
  ];
  return (
    <Figure n="5.2" title="Every evaluated decoder and two-tier routing rule" testid="routing-rules"
      source={<Provenance source="stored" detail={`aegis.study · p = ${s.p}`} />}
      assumptions={<>Two-tier rules are scored exactly from cached per-shot records (aegis.policy.route): run the first stage, escalate when it did not converge, and keep the converged, lighter answer. The time is the first-stage time plus the second-stage time when escalated.</>}
      sample={<>{s.pairs.toLocaleString()} validation shot pairs at p = {s.p}; every row decodes the same shots.</>}
      uncertainty={<>Failure counts are exact on these shots. LER per cycle = 1 − (1 − F/N)<sup>1/12</sup>. The intervals for these validation rows appear in Module 7.</>}
      limitations={<>A perfect router escalates exactly the shots whose first-stage answer is wrong, so it uses the truth. It is an upper bound on what any router can reach with that pair of stages, not something a decoder can achieve.</>}>
      {r.data.studies.length > 1 && <div className="mb-3"><StudyPicker studies={r.data.studies} value={s.p} onChange={setP} /></div>}
      <DataTable testid="rules-table" align={["l", "r", "r", "r", "r", "r", "r", "r"]}
        head={["Decoder or rule", "Failures X, Z", "Pair failures", "LER / cycle", "Mean", "p99", "Tier 2 used", "Perfect router: failures · LER"]}
        rows={[
          ...Object.entries(s.tiers).map(([k, d]) => row(`${k} (${TIER_NOTE[k] ?? "tier"})`, d)),
          row("BP-OSD / relay-BP, keep lighter answer", s.bposd_relay_routing.lighter_answer),
          row("BP-OSD / relay-BP, perfect router", s.bposd_relay_routing.oracle),
          ...rules.map((k) => row(k, s.rule_based[k], s.rule_based[`${k} (perfect router)`])),
        ]} />
      <div className="mt-5">
        <div className="mb-1 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Wrong answers hidden behind a converged first stage</div>
        <DataTable testid="hidden-failures" align={["l", "r", "r", "r"]} head={["First stage", "Converged but logically wrong", "Converged", "Shots"]}
          rows={Object.entries(s.hidden_failures).map(([k, h]) => [k, <span key="h" data-testid={`hidden-${k}`}>{h.converged_but_wrong}</span>, h.converged.toLocaleString(), h.shots.toLocaleString()])} />
        <p className="mt-2 font-sans text-[12.5px] leading-relaxed text-ink-2">
          A non-converged first stage is always escalated: that is the fallback rule, and it needs no model. Only <em>converged but wrong</em> answers are invisible to it.
          Those are the only shots a learned router can add, and their count bounds what learning can buy over the rule.
        </p>
      </div>
    </Figure>
  );
}

// ---------------------------------------------------------------- 3. router models, thresholds and the chosen operating points
export function RouterSelection() {
  const t = useGet<Training>(`${AEGIS}/training`);
  if (t.error) return <ErrorBox error={t.error} what="Training report" />;
  if (!t.data) return <Loading />;
  if (!t.data.available) return <p className="font-sans text-[13px] text-muted">No training report stored yet.</p>;
  const ranking = Object.entries(t.data.ranking);
  return (
    <Figure n="5.3" title="How the router was chosen: candidate models and operating points" testid="router-selection"
      source={<Provenance source="stored" detail={`training.json · written ${t.data.written}`} />}
      assumptions={<>aegis.train fits each candidate on training shots (seed 1), calibrates it on separate calibration shots (seed 4) and scores it on validation shots (seed 3). Settings: {t.data.settings.map((x) => `p = ${x[0]}${x[1] ? `, f = ${x[1]}` : ""}`).join("; ")}.</>}
      sample={<>{ranking[0]?.[1].shots.toLocaleString()} validation tier-1 answers per candidate, of which {ranking[0]?.[1].wrong} were logically wrong.</>}
      uncertainty={<>With so few wrong answers, AUC and average precision vary noticeably between candidates by chance. The selection is a judgement, not a significance test.</>}
      limitations={<>{t.data.caveat}</>}>
      <div className="mb-1 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Every candidate risk model (validation)</div>
      <DataTable testid="ranking-table" align={["l", "r", "r", "r", "r", "r"]} head={["Tier 1 | model", "AUC", "Average precision", "Brier", "ECE", "Inference"]}
        rows={ranking.map(([k, v]) => [k, v.auc.toFixed(3), v.average_precision.toFixed(3), v.brier.toExponential(2), v.ece.toExponential(2), v.inference_us === undefined ? "—" : `${v.inference_us.toFixed(1)} µs`])} />
      <div className="mt-5 mb-1 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Chosen operating points and their thresholds</div>
      <DataTable testid="chosen-table" align={["l", "l", "l", "r", "l"]} head={["Mode", "Tiers", "Model", "Threshold τ", "Per setting (validation): failures (relay-BP) · mean ms (relay-BP) · tier 2 used"]}
        rows={Object.entries(t.data.chosen).map(([mode, c]) => [mode, `${c.tier1} → ${c.tier2}`, c.model, <span key="t" className="num" data-testid={`chosen-threshold-${mode}`}>{c.threshold.toPrecision(4)}</span>,
          <span key="s" className="num text-[12px]">{Object.entries(c.per_setting).map(([k, v]) => `${k}: ${v.failures_pair} (${v.relay_failures}) · ${v.ms_mean.toFixed(1)} (${v.relay_ms.toFixed(1)}) · ${fmtPct(v.escalated, 2)}`).join("  |  ")}</span>])} />
    </Figure>
  );
}

// ---------------------------------------------------------------- 4. the rejected learned predecoder
export function PredecoderStudy() {
  const r = useStudies();
  const m = useGet<Methods>(`${AEGIS}/methods`);
  if (!r.data) return r.error ? <ErrorBox error={r.error} what="Studies" /> : <Loading />;
  const p = r.data.predecoder;
  if (!p) return <p className="font-sans text-[13px] text-muted">No predecoder study stored.</p>;
  const names: Record<string, string> = { "tier 1": "tier 1 alone (baseline)", soft: "learned priors, then tier 1", hard: "commit confident mechanisms, tier 1 on the residual" };
  const doc = m.data?.docs["aegis.predecoder"] ?? "";
  return (
    <Figure n="5.4" title="Rejected: a learned predecoder in front of relay-BP" testid="predecoder"
      source={<Provenance source="stored" detail="predecoder_p0.004.json" />}
      assumptions={<>Model trained on {p.train_shots.toLocaleString()} labelled samples of the detector error model. Commit level {p.commit_level}; on average {p.committed_per_shot.toFixed(2)} mechanisms committed per shot; largest table probability {p.table_max.toFixed(3)}.</>}
      sample={<>{p.shots.toLocaleString()} {p.split === "val" ? "validation" : p.split} shots, {p.basis} memory, p = {p.p}.</>}
      uncertainty={<>Exact counts on one sample. The baseline and both variants decode the same shots.</>}
      limitations={<>One noise strength and one basis. The conclusion is about this model family (local, translation-invariant). Other predecoders were not tested.</>}>
      <DataTable testid="predecoder-table" align={["l", "r", "r", "r", "r"]} head={["Variant", "Failed shots", "Not converged", "Mean time", "Mean BP iterations"]}
        rows={Object.entries(p.results).map(([k, v]) => [names[k] ?? k, <span key="f" data-testid={`pre-${k.replace(" ", "-")}`}>{v.failed}</span>, v.unconverged, fmtMs(v.ms_mean), v.iterations_mean.toFixed(1)])} />
      <div className="mt-4 rounded-[5px] bg-sunken p-4">
        <div className="mb-1 flex items-center gap-2 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Methodology, as documented in the code <span className="num normal-case">aegis/predecoder.py</span></div>
        <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink-2" data-testid="predecoder-method">{doc || "…"}</pre>
      </div>
    </Figure>
  );
}

// ---------------------------------------------------------------- 5. why this architecture
export function ArchitectureRationale() {
  const r = useStudies();
  const t = useGet<Training>(`${AEGIS}/training`);
  if (!r.data || !t.data) return <Loading />;
  const s4 = r.data.studies.find((s) => s.p === 0.004), s3 = r.data.studies.find((s) => s.p === 0.003);
  const speed = t.data.chosen?.speed;
  const pre = r.data.predecoder;
  if (!s4 || !speed) return null;
  const ps = speed.per_setting["p=0.004 f=0.0"];
  return (
    <Panel title="Why QEC-Aegis is relay-BP → learned router → relay-BP" source={<Provenance source="stored" detail="numbers quoted from the studies above" />} testid="rationale">
      <ol className="list-decimal space-y-2.5 pl-5 font-serif text-[15px] leading-relaxed text-ink-2">
        <li><strong>The second tier is relay-BP, not BP-OSD.</strong> On the same {s4.pairs.toLocaleString()} pairs at p = 0.004, relay-BP failed {s4.tiers.relay.failures_pair} pairs and BP-OSD {s4.tiers.bposd.failures_pair} (Fig. 5.1–5.2). The few shots only BP-OSD gets right do not justify running both.</li>
        <li><strong>The first tier is relay-BP stopped at its first solution.</strong> relay1 failed {s4.tiers.relay1.failures_pair} pairs at a mean of {fmtMs(s4.tiers.relay1.ms_mean)}, against {fmtMs(s4.tiers.relay.ms_mean)} for the full kit relay-BP. Cheaper first stages (plain BP, one leg) fail far more often and escalate too much{s3 ? ` (bp200 escalated ${fmtPct(s3.rule_based["bp200 -> relay"]?.escalated ?? 0, 1)} of shots at p = 0.003)` : ""}.</li>
        <li><strong>A learned router is needed only for hidden failures.</strong> relay1 converged on {s4.hidden_failures.relay1?.converged.toLocaleString()} of {s4.hidden_failures.relay1?.shots.toLocaleString()} shots, so the convergence rule alone almost never escalates. Yet {s4.hidden_failures.relay1?.converged_but_wrong} of those converged answers were logically wrong. The perfect router bounds the gain: relay1 → relay reaches {s4.rule_based["relay1 -> relay (perfect router)"]?.failures_pair} failures at best.</li>
        <li><strong>The chosen router recovers relay-BP&apos;s accuracy at lower mean cost.</strong> In speed mode (τ = {speed.threshold.toPrecision(3)}) it failed {ps.failures_pair} pairs against relay-BP&apos;s {ps.relay_failures}, at a mean of {ps.ms_mean.toFixed(1)} ms against {ps.relay_ms.toFixed(1)} ms, escalating {fmtPct(ps.escalated, 2)} of shots. These are validation numbers: the threshold was tuned on them. Module 7 holds the frozen-test verdict.</li>
        {pre && <li><strong>A learned predecoder was tried and rejected.</strong> Neither variant beat plain tier 1 ({pre.results["tier 1"].failed} failures against {pre.results.soft?.failed} and {pre.results.hard?.failed}, Fig. 5.4). Learning was spent on routing instead of on priors.</li>}
      </ol>
    </Panel>
  );
}
