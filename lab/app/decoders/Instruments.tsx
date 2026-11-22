"use client";
import { useMemo, useState, type ReactNode } from "react";
import { Button, DataTable, ErrorBox, Loading, NumberField, Segmented, Select, Slider, Stat } from "@/components/Controls";
import { Panel } from "@/components/Layout";
import { Provenance } from "@/components/Provenance";
import { TeX } from "@/components/TeX";
import { AEGIS, useGet, useRun } from "@/lib/api";
import { llr, minSum, osd0, relayBP, solutionWeight } from "@/lib/bp";
import { matvec, weight, type Bits } from "@/lib/gf2";
import { fmtMs } from "@/lib/stats";
import { HAMMING, toric } from "@/lib/toycodes";

// ---------------------------------------------------------------- BP, OSD-0 and relay on small matrices (illustration)
type CodeKey = "hamming" | "toric";
const CODES: Record<CodeKey, { label: string; H: number[][]; note: string }> = {
  hamming: { label: "Hamming [7,4] (classical, H is 3×7)", H: HAMMING, note: "Tanner graph with short cycles but no degeneracy: one error pattern per syndrome up to weight 1." },
  toric: { label: "Toric code L = 3 (bit flips, H is 9×18)", H: toric(3), note: "A quantum code: many minimum-weight errors share a syndrome. That degeneracy is what breaks plain BP." },
};

export function BPIllustration() {
  const [code, setCode] = useState<CodeKey>("toric");
  const H = CODES[code].H, n = H[0].length;
  const [e, setE] = useState<Bits>(() => { const v = new Array(18).fill(0); v[0] = 1; v[9 + 1] = 1; return v; });
  const [p, setP] = useState(0.05);
  const [iters, setIters] = useState(30);
  const [gamma, setGamma] = useState(0);
  const [t, setT] = useState(1);
  const [seed, setSeed] = useState(1);
  const ee = e.length === n ? e : new Array(n).fill(0);
  const s = matvec(H, ee);
  const priors = new Array(n).fill(p);
  const hist = useMemo(() => minSum(H, s, priors, { iters, gamma: new Array(n).fill(gamma) }), [H, s.join(""), p, iters, gamma]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = hist[hist.length - 1];
  const step = hist[Math.min(t, hist.length) - 1];
  const osd = useMemo(() => osd0(H, s, last.posterior), [H, s.join(""), last]); // eslint-disable-line react-hooks/exhaustive-deps
  const relay = useMemo(() => relayBP(H, s, priors, { gamma0: 0.15, preIter: 20, legs: 30, legIter: 15, interval: [-0.226, 0.622], stopAfter: 3, seed }), [H, s.join(""), p, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxAbs = Math.max(...hist.flatMap((h) => h.posterior.map(Math.abs)), 1);
  const setCodeKey = (k: CodeKey) => { setCode(k); setE(new Array(CODES[k].H[0].length).fill(0)); setT(1); };
  const residualLogical = (sol: Bits | null) => {
    if (!sol) return "—";
    const r = sol.map((x, i) => x ^ ee[i]);
    return weight(r) === 0 ? "ê = e exactly" : `ê ⊕ e has weight ${weight(r)} and zero syndrome (${code === "toric" ? "a closed loop: a stabilizer if contractible, a logical if it wraps the torus" : "a nonzero codeword: a decoding error"})`;
  };

  return (
    <Panel title="Belief propagation, OSD-0 and relay legs on a small code" source={<Provenance source="illustration" detail="computed in your browser" />} testid="bp-illustration">
      <div className="flex flex-wrap items-end gap-4">
        <Segmented label="Code" value={code} onChange={setCodeKey} options={(Object.keys(CODES) as CodeKey[]).map((k) => ({ value: k, label: CODES[k].label }))} testid="bp-code" />
        {code === "toric" && <Button kind="secondary" onClick={() => { const v = new Array(18).fill(0); v[0] = 1; v[9 + 1] = 1; setE(v); setT(1); }} testid="bp-degenerate">Degenerate example</Button>}
        <Button kind="ghost" onClick={() => setE(new Array(n).fill(0))}>clear e</Button>
      </div>
      <p className="mt-2 font-sans text-[12.5px] text-muted">{CODES[code].note}</p>

      <div className="mt-3">
        <div className="mb-1 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Error e (click bits) and syndrome s = He</div>
        <div className="flex flex-wrap items-center gap-1">
          {ee.map((b, v) => (
            <button key={v} type="button" aria-pressed={!!b} aria-label={`error bit ${v}`} data-testid={`bp-e-${v}`}
              onClick={() => setE(ee.map((x, j) => (j === v ? x ^ 1 : x)))}
              className="num h-7 w-7 rounded-[4px] border text-[12px]" style={{ background: b ? "var(--fault)" : "var(--panel)", color: b ? "var(--paper)" : "var(--ink-2)", borderColor: "var(--rule-strong)" }}>{v}</button>
          ))}
        </div>
        <div className="num mt-2 text-[13px] text-ink-2" data-testid="bp-syndrome">s = {s.join("")} · weight {weight(s)}</div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
        <Slider label="prior p" value={p} min={0.01} max={0.2} step={0.01} onChange={setP} format={(v) => `${v.toFixed(2)} (λ = ${llr(v).toFixed(2)})`} />
        <Slider label="max iterations" value={iters} min={1} max={80} step={1} onChange={(v) => { setIters(v); setT((x) => Math.min(x, v)); }} />
        <Slider label="memory γ (0 = plain BP)" value={gamma} min={-0.3} max={0.7} step={0.05} onChange={setGamma} format={(v) => v.toFixed(2)} />
        <Slider label="show iteration" value={Math.min(t, hist.length)} min={1} max={hist.length} step={1} onChange={setT} testid="bp-t" />
      </div>

      <div className="mt-4">
        <div className="mb-1 flex justify-between font-sans text-[11.5px] uppercase tracking-[0.06em] text-muted">
          <span>Posterior log-likelihood ratio Λ<sub>v</sub> at iteration {step.t} (below zero: decide &quot;flipped&quot;)</span>
          <span className="num normal-case">residual |He + s| = {step.residual}{step.converged ? " · converged" : ""}</span>
        </div>
        <svg viewBox={`0 0 ${n * 32 + 10} 150`} className="w-full max-w-[720px]" role="img" aria-label={`Posterior LLRs at iteration ${step.t}`}>
          <line x1={0} x2={n * 32 + 10} y1={75} y2={75} stroke="var(--rule-strong)" />
          {step.posterior.map((x, v) => {
            const h = (Math.abs(x) / maxAbs) * 66;
            return (
              <g key={v}>
                <rect x={8 + v * 32} y={x >= 0 ? 75 - h : 75} width={22} height={Math.max(h, 0.5)} rx={2} fill={x < 0 ? "var(--fault)" : "var(--s1)"} opacity={ee[v] ? 1 : 0.65} />
                <text x={19 + v * 32} y={146} textAnchor="middle" fontSize="10" fill="var(--muted)" className="num">{v}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3" data-testid="bp-outcomes">
        <Outcome title="Min-sum BP" ok={last.converged} detail={last.converged ? `converged after ${last.t} iterations · ê = ${last.hard.join("")}` : `no solution in ${last.t} iterations: the hard decision leaves ${last.residual} unsatisfied checks`}
          extra={last.converged ? residualLogical(last.hard) : undefined} />
        <Outcome title="BP + OSD-0" ok={!!osd} detail={osd ? `ê = ${osd.e.join("")} · weight ${weight(osd.e)} · information set {${osd.pivots.join(", ")}}` : "s not in the column space"} extra={osd ? residualLogical(osd.e) : undefined} />
        <Outcome title="Relay-BP (memory legs)" ok={!!relay.best} detail={relay.best ? `best of ${relay.legs.filter((l) => l.converged).length} solutions after ${relay.legs.length} legs · ê = ${relay.best.solution!.join("")} · log-weight ${relay.best.weight!.toFixed(2)}` : `no leg converged in ${relay.legs.length} legs`}
          extra={<Button kind="ghost" onClick={() => setSeed((x) => x + 1)}>redraw γ (seed {seed})</Button>} />
      </div>
      <p className="mt-3 font-sans text-[12.5px] leading-relaxed text-ink-2">
        In the degenerate toric example, defects sit at vertices (0,0) and (1,1). Two weight-2 paths join them and are equally likely, so the messages for the
        two paths stay symmetric and the hard decision never satisfies the syndrome. OSD-0 breaks the tie with linear algebra: it trusts the most reliable
        columns and solves <TeX>{"H_S e_S = s"}</TeX> exactly. Relay-BP breaks it with memory. Each leg draws different <TeX>{"\\gamma_v"}</TeX> (some negative),
        which disturbs the symmetric fixed point. Either answer is fine here: the two paths differ by a stabilizer, so they correct the same logical class.
      </p>
    </Panel>
  );
}

function Outcome({ title, ok, detail, extra }: { title: string; ok: boolean; detail: string; extra?: ReactNode }) {
  return (
    <div className="rounded-[5px] border border-rule p-3 font-sans text-[12.5px]">
      <div className="flex items-center gap-2 font-semibold text-ink"><span style={{ color: ok ? "var(--s5)" : "var(--fault)" }}>{ok ? "✓" : "✗"}</span>{title}</div>
      <div className="num mt-1 break-all text-[12px] text-ink-2">{detail}</div>
      {extra && <div className="mt-1 text-muted">{extra}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- what the production decoders return on a real Gross shot (live)
type Shot = {
  source: string; basis: string; p: number; seed: number; syndrome: number[][]; true_observables: number[];
  decoders: Record<string, { logical_correct: boolean; ms: number; explains_syndrome: boolean; bp_iterations: number; predicted_observables: number[] }>;
  routing: null | { risk: number; threshold: number; escalated: boolean; tier1: string; tier2: string; tier1_converged: boolean; path: string; ms_tier1: number; ms_model: number; ms_tier2: number; model: string; trained_on: number[][] };
  features: Record<string, number> | null; feature_groups: Record<string, string[]>;
};

export function LiveDecode() {
  const [basis, setBasis] = useState<"X" | "Z">("X");
  const [p, setP] = useState(0.004);
  const [seed, setSeed] = useState(7);
  const r = useRun<object, Shot>(`${AEGIS}/decode`);
  const shot = r.data;
  return (
    <Panel title="The production decoders on one Gross-code shot" source={<Provenance source="live" detail="ldpc BP-OSD, relay-bp, QEC-Aegis · :8765" />} testid="live-decode">
      <div className="flex flex-wrap items-end gap-4">
        <Segmented label="Memory" value={basis} onChange={setBasis} options={[{ value: "X", label: "X" }, { value: "Z", label: "Z" }]} />
        <Select label="p" value={p} onChange={setP} options={[0.003, 0.004, 0.005].map((v) => ({ value: v, label: String(v) }))} />
        <NumberField label="Seed" value={seed} min={0} onChange={setSeed} testid="ld-seed" />
        <Button onClick={() => r.run({ basis, p, f: 0, seed, baselines: ["relay", "bposd"] })} disabled={r.loading} testid="ld-run">{r.loading ? "Decoding…" : "Sample and decode"}</Button>
      </div>
      <ErrorBox error={r.error} what="Gross backend" />
      {r.loading && !shot && <Loading what="Sampling with Stim and decoding" />}
      {shot && (
        <div className="mt-4 space-y-4" data-testid="ld-result">
          <DataTable testid="ld-table" align={["l", "l", "l", "r", "r"]}
            head={["Decoder", "Explains syndrome (Hê = s)", "Logical prediction", "BP iterations", "Time"]}
            rows={Object.entries(shot.decoders).map(([name, d]) => [
              <span key="n" className="font-medium text-ink">{name}</span>, d.explains_syndrome ? "yes" : "no",
              <span key="l" style={{ color: d.logical_correct ? "var(--s5)" : "var(--fault)" }}>{d.logical_correct ? "correct (12 of 12 observables)" : "WRONG"}</span>,
              d.bp_iterations, fmtMs(d.ms)])} />
          {shot.routing && shot.features && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Risk P(tier 1 wrong)" value={shot.routing.risk.toExponential(2)} sub={`threshold ${shot.routing.threshold.toFixed(3)}`} testid="ld-risk" />
                  <Stat label="Route" value={shot.routing.escalated ? "escalated" : "accepted"} sub={shot.routing.path} testid="ld-route" />
                  <Stat label="Fallback rule" value={shot.routing.tier1_converged ? "not triggered" : "triggered"} sub="tier 1 did not converge → always tier 2" testid="ld-fallback" />
                  <Stat label="Threshold τ" value={shot.routing.threshold.toPrecision(4)} sub="escalate when risk ≥ τ" testid="ld-threshold" />
                </div>
                <RiskBar risk={shot.routing.risk} threshold={shot.routing.threshold} />
                <p className="font-sans text-[12px] text-muted">
                  Tier 1 {shot.routing.tier1} took {fmtMs(shot.routing.ms_tier1)}, the {shot.routing.model} model {fmtMs(shot.routing.ms_model)}
                  {shot.routing.escalated ? `, tier 2 ${shot.routing.tier2} ${fmtMs(shot.routing.ms_tier2)}` : ""}. The model was trained at p ∈{" "}
                  {shot.routing.trained_on.map((x) => x[0]).join(", ")}.
                </p>
              </div>
              <div>
                <div className="mb-1 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">
                  Every feature the router read ({Object.values(shot.feature_groups).flat().length}, actual values)
                </div>
                <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2" data-testid="ld-features">
                  {Object.entries(shot.feature_groups).map(([group, names]) => (
                    <table key={group} className="mb-2 w-full font-sans text-[12px]">
                      <thead><tr><th colSpan={2} className="pt-1 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-accent">{group}</th></tr></thead>
                      <tbody>{names.map((k) => (
                        <tr key={k} className="border-b border-rule"><td className="num py-0.5 pr-2 text-ink-2">{k}</td>
                          <td className="num text-right text-ink" data-testid={`feat-${k}`}>{fmtFeature(shot.features![k])}</td></tr>
                      ))}</tbody>
                    </table>
                  ))}
                </div>
              </div>
            </div>
          )}
          <p className="font-sans text-[12px] text-muted">
            Seed {shot.seed}, p = {shot.p}, {shot.basis} memory, {shot.syndrome.flat().reduce((a, b) => a + b, 0)} detection events in 13 × 72 detectors. Times
            are single measurements on this machine and vary between clicks. The first call for a setting also builds the decoders.
          </p>
        </div>
      )}
    </Panel>
  );
}

const fmtFeature = (v: number) => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(1) : v.toPrecision(3));

function RiskBar({ risk, threshold }: { risk: number; threshold: number }) {
  // log axis from 1e-6 to 1
  const f = (x: number) => (100 * (Math.log10(Math.max(x, 1e-6)) + 6)) / 6;
  return (
    <div className="relative mt-1 h-7 rounded-sm bg-sunken" aria-label={`risk ${risk.toExponential(2)} against threshold ${threshold.toFixed(3)}`} role="img">
      <div className="absolute inset-y-0 right-0 rounded-r-sm" style={{ left: `${f(threshold)}%`, background: "color-mix(in srgb, var(--fault) 12%, transparent)" }} />
      <div className="absolute inset-y-0 w-[2px] bg-fault" style={{ left: `${f(threshold)}%` }} />
      <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel" style={{ left: `${f(risk)}%`, background: "var(--accent)" }} />
      <div className="num absolute -bottom-4 left-0 text-[10px] text-muted">10⁻⁶</div>
      <div className="num absolute -bottom-4 right-0 text-[10px] text-muted">1</div>
      <div className="num absolute -bottom-4 text-[10px] text-fault" style={{ left: `${f(threshold)}%` }}>escalate</div>
    </div>
  );
}

// ---------------------------------------------------------------- the deployed router's settings (live status)
type Status = { model: null | { name: string; kind: string; tier1: string; tier2: string; threshold: number; trained_on: number[][]; groups: string[]; inference_seconds: number; mode: string } };
export function RouterCard() {
  const st = useGet<Status>(`${AEGIS}/status`);
  if (st.error) return <ErrorBox error={st.error} what="Gross backend" />;
  if (!st.data) return <Loading />;
  const m = st.data.model;
  if (!m) return <p className="font-sans text-[13px] text-muted">No trained router on this machine yet: the backend runs the baselines only.</p>;
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5" data-testid="router-card">
      <Stat label="Tier 1" value={m.tier1} sub="relay-BP, first solution" />
      <Stat label="Tier 2" value={m.tier2} sub="the kit's relay-BP" />
      <Stat label="Risk model" value={m.kind} sub={`${m.groups.length} feature groups`} />
      <Stat label="Threshold" value={m.threshold.toFixed(4)} sub={`mode: ${m.mode}`} testid="router-threshold" />
      <Stat label="Model inference" value={fmtMs(m.inference_seconds * 1e3)} sub="per shot, measured at training" />
    </div>
  );
}

export { solutionWeight };
