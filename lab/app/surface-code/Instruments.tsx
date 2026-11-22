"use client";
import { useEffect, useMemo, useState } from "react";
import { Plot, type Series } from "@/components/charts/Plot";
import { Button, ErrorBox, Loading, NumberField, Segmented, Select, Stat } from "@/components/Controls";
import { Panel } from "@/components/Layout";
import { Provenance } from "@/components/Provenance";
import { SIM, postJSON, useGet, useRun } from "@/lib/api";
import { fmtSci } from "@/lib/stats";
import { CircuitDiagram, CompileMetrics, type Drawing } from "@/components/Circuit";

type Qubit = { id: number; row: number; role: "data" | "ancilla_x" | "ancilla_z"; x: number; y: number };
type Detector = { index: number; qubit: number | null; round: number };
type CircuitResp = {
  drawing: Drawing;
  experiment: string; distance: number; rounds: number; protects_against: string;
  layout: { qubits: Qubit[]; detectors: Detector[]; data_qubits: number[]; boundaries: { index: number; label: string }[]; num_detectors: number; num_measurements: number };
  metrics: { qubits: number; depth: number; two_qubit_gates: number; measure: number; reset: number };
};
type Injection = {
  run_id: string; seed: number; computed_by: Record<string, string | number>;
  error: { type: string; qubit: number; when: string };
  syndrome: { fired: number[]; fired_detail: Detector[]; same_in_every_shot: boolean };
  decoder: { predicted_logical_flip: boolean };
  logical: { observable_flipped: boolean; outcome: string; shots: number; errors_before_decoding: number; errors_after_decoding: number };
  stim_reference: { syndrome_matches_aer: boolean }; timing_ms: Record<string, number>;
  circuit: { drawing: Drawing };
  measurements: { first_shot: string };
};
type Graph = { nodes: (Detector & { coords: number[] })[]; edges: { u: number; v: number | null; weight: number; p: number; flips_observable: boolean }[]; num_detectors: number; weights: string; decoder: string };
type Match = { pairs: [number, number | null][]; predicted_logical_flip: boolean; weight: number; fired: number[]; ms: number };

export function SurfaceLab() {
  const [d, setD] = useState(3);
  const [basis, setBasis] = useState<"Z" | "X">("Z");
  const [pauli, setPauli] = useState<"X" | "Y" | "Z">("X");
  const [boundary, setBoundary] = useState(1);
  const [shots, setShots] = useState(100);
  const [seed, setSeed] = useState(11);
  const [target, setTarget] = useState<number | null>(null);
  const rounds = d;
  const circ = useGet<CircuitResp>(`${SIM}/circuit?code=surface&basis=${basis}&distance=${d}&rounds=${rounds}`);
  const inj = useRun<object, Injection>(`${SIM}/simulate/injection`);
  const [fired, setFired] = useState<number[]>([]);
  useEffect(() => { inj.setData(null); setFired([]); setTarget(null); setBoundary(1); }, [d, basis]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (q: number) => {
    setTarget(q);
    const res = await inj.run({ code: "surface", basis, distance: d, rounds, error_type: pauli, qubit: q, boundary, shots, seed });
    if (res) setFired(res.syndrome.fired);
  };
  const lay = circ.data?.layout;
  const res = inj.data;

  return (
    <div className="space-y-6">
      <Panel title="Rotated surface code: inject an error on a data qubit" source={<Provenance source="live" detail="Stim → Qiskit Aer → PyMatching, :8000" />} testid="surface-lab">
        <div className="flex flex-wrap items-end gap-4">
          <Segmented label="Distance" value={d} onChange={setD} options={[3, 5].map((v) => ({ value: v, label: `d = ${v}` }))} testid="surf-d" />
          <Segmented label="Memory" value={basis} onChange={setBasis} options={[{ value: "Z", label: "logical |0⟩ (Z)" }, { value: "X", label: "logical |+⟩ (X)" }]} testid="surf-basis" />
          <Segmented label="Error" value={pauli} onChange={setPauli} options={(["X", "Y", "Z"] as const).map((p) => ({ value: p, label: p }))} testid="surf-pauli" />
          <Select label="Inserted" value={boundary} onChange={setBoundary} options={(lay?.boundaries ?? []).map((b) => ({ value: b.index, label: b.label }))} testid="surf-boundary" />
          <NumberField label="Shots" value={shots} min={1} max={1000} onChange={setShots} />
          <NumberField label="Seed" value={seed} min={0} onChange={setSeed} />
        </div>
        <ErrorBox error={circ.error ?? inj.error} what="Simulation backend" />
        {circ.loading && <Loading what="Building the circuit" />}
        {lay && (
          <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,420px)_1fr]">
            <div>
              <Lattice qubits={lay.qubits} detectors={lay.detectors} fired={new Set(res?.syndrome.fired ?? [])} target={target} pauli={pauli} onPick={run} busy={inj.loading} />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-sans text-[12px] text-muted">
                <span><Swatch c="var(--xcheck)" /> X-type stabilizer</span><span><Swatch c="var(--zcheck)" /> Z-type stabilizer</span>
                <span><Swatch c="var(--fired)" round /> check with a detection event</span><span><Swatch c="var(--fault)" round /> injected error</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 font-sans">
                <Stat label="Qubits" value={circ.data!.metrics.qubits} sub={`${lay.data_qubits.length} data`} />
                <Stat label="CNOTs" value={circ.data!.metrics.two_qubit_gates} sub={`${rounds} rounds`} />
                <Stat label="Detectors" value={lay.num_detectors} sub={`${lay.num_measurements} measurements`} />
              </div>
            </div>
            <div className="min-w-0 space-y-4">
              <SpaceTime detectors={lay.detectors} qubits={lay.qubits} fired={new Set(res?.syndrome.fired ?? [])} />
              {inj.loading && <Loading what="Running on Aer" />}
              {res ? (
                <div className="space-y-3" data-testid="surf-result" data-run-id={res.run_id}>
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <Stat label="Detection events" value={res.syndrome.fired.length} sub={res.syndrome.fired.join(", ") || "none"} testid="surf-fired" />
                    <Stat label="Observable flipped" value={res.logical.observable_flipped ? "yes" : "no"} testid="surf-obs" />
                    <Stat label="Decoder predicts" value={res.decoder.predicted_logical_flip ? "flip" : "no flip"} testid="surf-pred" />
                    <Stat label="Outcome" value={res.logical.outcome} testid="surf-outcome" />
                  </div>
                  <p className="font-sans text-[12.5px] text-ink-2">
                    {res.error.type} on qubit {res.error.qubit}, {res.error.when}. Wrong after decoding:{" "}
                    <span className="num">{res.logical.errors_after_decoding}/{res.logical.shots}</span> shots (before decoding{" "}
                    <span className="num">{res.logical.errors_before_decoding}</span>). Stim reproduces the Aer syndrome:{" "}
                    <strong>{res.stim_reference.syndrome_matches_aer ? "yes" : "no"}</strong>.
                  </p>
                  <div className="font-sans text-[11.5px] text-muted">{String(res.computed_by.simulator)} · seed {res.seed} · run {res.run_id} · {res.timing_ms.total} ms</div>
                  <div className="font-sans text-[11.5px] text-muted">First shot, raw bits: <span className="num break-all text-ink-2" data-testid="surf-raw">{res.measurements.first_shot}</span></div>
                </div>
              ) : <p className="font-sans text-[13px] text-muted">Click a data qubit (or focus one and press Enter) to insert a {pauli} error and run the circuit.</p>}
            </div>
          </div>
        )}
        {lay && circ.data && (
          <div className="mt-6 space-y-5 border-t border-rule pt-5">
            <div>
              <div className="mb-1.5 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">
                Syndrome-extraction circuit {res ? `with the ${res.error.type} error on qubit ${res.error.qubit}, ${res.error.when}` : "(click a data qubit to place an error)"}
              </div>
              <CircuitDiagram drawing={res ? res.circuit.drawing : circ.data.drawing} qubits={lay.qubits} rounds={rounds} fired={res?.syndrome.fired_detail} testid="surf-circuit" />
            </div>
            <CompileMetrics code="surface" basis={basis} distance={d} rounds={rounds} written={circ.data.metrics} />
          </div>
        )}
      </Panel>
      {lay && <MatchingView d={d} basis={basis} rounds={rounds} fired={fired} setFired={setFired} qubits={lay.qubits} />}
    </div>
  );
}

function Swatch({ c, round }: { c: string; round?: boolean }) {
  return <span className={`mr-1 inline-block h-2.5 w-2.5 align-middle ${round ? "rounded-full" : "rounded-[2px]"}`} style={{ background: c }} />;
}

function Lattice({ qubits, detectors, fired, target, pauli, onPick, busy }: {
  qubits: Qubit[]; detectors: Detector[]; fired: Set<number>; target: number | null; pauli: string; onPick: (q: number) => void; busy: boolean;
}) {
  const xs = qubits.map((q) => q.x), ys = qubits.map((q) => q.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const S = 44, pad = 26;
  const px = (x: number) => pad + (x - minX) * S, py = (y: number) => pad + (y - minY) * S;
  const data = qubits.filter((q) => q.role === "data");
  const firedRounds = (id: number) => detectors.filter((dt) => dt.qubit === id && fired.has(dt.index)).map((dt) => dt.round);
  return (
    <svg viewBox={`0 0 ${2 * pad + (maxX - minX) * S} ${2 * pad + (maxY - minY) * S}`} className="w-full max-w-[420px]" role="group" aria-label="Surface code lattice">
      {qubits.filter((q) => q.role !== "data").map((a) => {
        const nb = data.filter((q) => Math.abs(q.x - a.x) === 1 && Math.abs(q.y - a.y) === 1);
        const pts = (nb.length === 2 ? [...nb, a] : nb).map((q) => [px(q.x), py(q.y)] as const);
        const c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
        pts.sort((p1, p2) => Math.atan2(p1[1] - c[1], p1[0] - c[0]) - Math.atan2(p2[1] - c[1], p2[0] - c[0]));
        const col = a.role === "ancilla_x" ? "var(--xcheck)" : "var(--zcheck)";
        return <polygon key={"p" + a.id} points={pts.map((p) => p.join(",")).join(" ")} fill={col} opacity={0.14} stroke={col} strokeOpacity={0.5} />;
      })}
      {qubits.filter((q) => q.role !== "data").map((a) => {
        const r = firedRounds(a.id), col = a.role === "ancilla_x" ? "var(--xcheck)" : "var(--zcheck)";
        return (
          <g key={a.id} data-testid={`anc-${a.id}`} data-fired={r.length ? 1 : 0}>
            <rect x={px(a.x) - 9} y={py(a.y) - 9} width={18} height={18} rx={3} fill={r.length ? "var(--fired)" : "var(--panel)"} stroke={col} strokeWidth="2" />
            {r.length > 0 && <text x={px(a.x)} y={py(a.y)} dy="0.35em" textAnchor="middle" fontSize="9.5" fill="var(--paper)" fontFamily="var(--font-jetbrains)">t{r.join(",")}</text>}
          </g>
        );
      })}
      {data.map((q) => {
        const on = target === q.id;
        return (
          <g key={q.id} role="button" tabIndex={0} aria-label={`data qubit ${q.id}${on ? `, ${pauli} error injected` : ""}`} data-testid={`data-${q.id}`}
            onClick={() => !busy && onPick(q.id)} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) { e.preventDefault(); onPick(q.id); } }} style={{ cursor: busy ? "wait" : "pointer" }}>
            <circle className="focus-ring" cx={px(q.x)} cy={py(q.y)} r={11} fill={on ? "var(--fault)" : "var(--panel)"} stroke="var(--ink-2)" strokeWidth="1.5" />
            <text x={px(q.x)} y={py(q.y)} dy="0.35em" textAnchor="middle" fontSize="9.5" fill={on ? "var(--paper)" : "var(--muted)"} fontFamily="var(--font-jetbrains)">{on ? pauli : q.id}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** One row per check, one column per detector round. */
function SpaceTime({ detectors, qubits, fired }: { detectors: Detector[]; qubits: Qubit[]; fired: Set<number> }) {
  const anc = [...new Set(detectors.map((d) => d.qubit).filter((q): q is number => q !== null))].sort((a, b) => {
    const qa = qubits.find((q) => q.id === a)!, qb = qubits.find((q) => q.id === b)!;
    return qa.role === qb.role ? a - b : qa.role === "ancilla_z" ? -1 : 1;
  });
  const T = Math.max(...detectors.map((d) => d.round));
  return (
    <div>
      <div className="mb-1 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Detector record in space-time (shot 1)</div>
      <div className="overflow-x-auto">
        <table className="border-collapse font-sans text-[11px]" data-testid="spacetime">
          <thead><tr><th className="pr-2 text-left font-normal text-muted">check</th>{Array.from({ length: T + 1 }, (_, t) => <th key={t} className="num px-0.5 font-normal text-muted">{t === T ? "final" : `t${t}`}</th>)}</tr></thead>
          <tbody>{anc.map((a) => {
            const role = qubits.find((q) => q.id === a)!.role;
            return (
              <tr key={a}>
                <td className="num pr-2" style={{ color: role === "ancilla_x" ? "var(--xcheck)" : "var(--zcheck)" }}>{role === "ancilla_x" ? "X" : "Z"}{a}</td>
                {Array.from({ length: T + 1 }, (_, t) => {
                  const det = detectors.find((d) => d.qubit === a && d.round === t);
                  const on = det && fired.has(det.index);
                  return <td key={t} className="p-[2px]"><div title={det ? `detector ${det.index}` : "no detector here"} className="h-[18px] w-[26px] rounded-[2px] border"
                    style={{ background: !det ? "repeating-linear-gradient(45deg, transparent 0 3px, var(--rule) 3px 4px)" : on ? "var(--fired)" : "var(--sunken)", borderColor: det ? "var(--rule-strong)" : "var(--rule)" }} /></td>;
                })}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <p className="mt-1.5 font-sans text-[11.5px] text-muted">
        Hatched cells have no detector. In a Z memory the X-type checks start in a random state, so their first round is not compared with anything,
        and they are not compared with the Z-basis final readout.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- minimum-weight perfect matching
function MatchingView({ d, basis, rounds, fired, setFired, qubits }: {
  d: number; basis: string; rounds: number; fired: number[]; setFired: (f: number[]) => void; qubits: Qubit[];
}) {
  const g = useGet<Graph>(`${SIM}/matching-graph?code=surface&basis=${basis}&distance=${d}&rounds=${rounds}`);
  const [match, setMatch] = useState<Match | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    postJSON<Match>(`${SIM}/decode-syndrome`, { code: "surface", basis, distance: d, rounds, fired })
      .then((m) => { if (live) { setMatch(m); setErr(null); } }).catch((e: Error) => live && setErr(e.message));
    return () => { live = false; };
  }, [fired, d, basis, rounds]);

  const layout = useMemo(() => {
    if (!g.data) return null;
    const anc = [...new Set(g.data.nodes.map((n) => n.qubit).filter((q): q is number => q !== null))];
    const role = (id: number) => qubits.find((q) => q.id === id)?.role;
    anc.sort((a, b) => (role(a) === role(b) ? a - b : role(a) === "ancilla_z" ? -1 : 1));
    const T = Math.max(...g.data.nodes.map((n) => n.round));
    const colW = 74, rowH = 22, left = 64, top = 18;
    const pos = new Map(g.data.nodes.map((n) => [n.index, { x: left + n.round * colW, y: top + anc.indexOf(n.qubit!) * rowH }]));
    return { anc, T, colW, rowH, left, top, pos, W: left + T * colW + 110, H: top + anc.length * rowH + 14, role };
  }, [g.data, qubits]);

  if (g.error) return <ErrorBox error={g.error} what="Matching graph" />;
  if (!g.data || !layout) return <Loading what="Loading the matching graph" />;
  const firedSet = new Set(fired);
  const matched = new Set((match?.pairs ?? []).map(([u, v]) => `${u}-${v}`));
  const isMatched = (u: number, v: number | null) => matched.has(`${u}-${v}`) || (v !== null && matched.has(`${v}-${u}`));
  const bx = layout.W - 40;
  const toggle = (i: number) => setFired(firedSet.has(i) ? fired.filter((x) => x !== i) : [...fired, i].sort((a, b) => a - b));

  return (
    <Panel title="Minimum-weight perfect matching on the detector graph" source={<Provenance source="live" detail={g.data.decoder} />} testid="matching">
      <p className="mb-3 max-w-[60rem] font-sans text-[13px] leading-relaxed text-ink-2">
        Each node is a detector: one row per check, one column per round. Each edge is a class of circuit faults that flips exactly the two detectors it joins,
        or one detector and the code boundary (the stub on the right). Edge weights are <span className="num">w = log((1−p)/p)</span>. PyMatching pairs the
        detection events, or sends them to the boundary, so that the total weight is minimal. A correction that crosses the logical operator an odd number of times
        flips the prediction. Click nodes to build any syndrome. The run above fills it in.
      </p>
      <div className="flex flex-wrap items-center gap-3 font-sans text-[12.5px]">
        <Button kind="secondary" onClick={() => setFired([])}>clear syndrome</Button>
        <span className="text-ink-2">Detection events: <span className="num" data-testid="match-fired">{fired.join(", ") || "none"}</span></span>
        {match && <span className="text-ink-2">Matched: <span className="num" data-testid="match-pairs">{match.pairs.map(([u, v]) => `${u}–${v ?? "B"}`).join("  ") || "nothing"}</span></span>}
        {match && <span className="text-ink-2">Weight <span className="num">{match.weight.toFixed(2)}</span> · predicts <strong data-testid="match-pred">{match.predicted_logical_flip ? "logical flip" : "no logical flip"}</strong> · {match.ms} ms</span>}
      </div>
      <ErrorBox error={err} what="Decoder" />
      <div className="mt-3 overflow-x-auto">
        <svg width={layout.W} height={layout.H} role="group" aria-label="Space-time detector graph" className="block">
          <line x1={bx} x2={bx} y1={layout.top - 10} y2={layout.H - 8} stroke="var(--rule-strong)" strokeWidth="3" />
          <text x={bx + 8} y={layout.top} fontSize="11" fill="var(--muted)">boundary</text>
          {Array.from({ length: layout.T + 1 }, (_, t) => <text key={t} x={layout.left + t * layout.colW} y={10} textAnchor="middle" fontSize="10.5" fill="var(--muted)" className="num">t{t}</text>)}
          {layout.anc.map((a, i) => <text key={a} x={8} y={layout.top + i * layout.rowH} dy="0.35em" fontSize="10.5" className="num" fill={layout.role(a) === "ancilla_x" ? "var(--xcheck)" : "var(--zcheck)"}>{layout.role(a) === "ancilla_x" ? "X" : "Z"}{a}</text>)}
          {g.data.edges.map((e, k) => {
            const a = layout.pos.get(e.u)!, on = isMatched(e.u, e.v);
            if (e.v === null) return <line key={k} x1={a.x} y1={a.y} x2={bx} y2={a.y} stroke={on ? "var(--accent)" : "var(--rule)"} strokeWidth={on ? 3 : 0.8} strokeDasharray={on ? undefined : "2 3"} opacity={on ? 1 : 0.5} />;
            const b = layout.pos.get(e.v)!;
            const mx = (a.x + b.x) / 2 + (a.x === b.x ? Math.min(28, Math.abs(a.y - b.y) * 0.4) : 0), my = (a.y + b.y) / 2;
            return <path key={k} d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`} fill="none" stroke={on ? "var(--accent)" : e.flips_observable ? "var(--s4)" : "var(--rule-strong)"} strokeWidth={on ? 3 : 0.9} opacity={on ? 1 : 0.55} />;
          })}
          {g.data.nodes.map((n) => {
            const p = layout.pos.get(n.index)!, on = firedSet.has(n.index);
            return (
              <g key={n.index} role="button" tabIndex={0} aria-pressed={on} aria-label={`detector ${n.index}, round ${n.round}`} data-testid={`det-${n.index}`}
                onClick={() => toggle(n.index)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(n.index); } }} style={{ cursor: "pointer" }}>
                <circle className="focus-ring" cx={p.x} cy={p.y} r={on ? 7 : 5} fill={on ? "var(--fired)" : "var(--panel)"} stroke="var(--ink-2)" strokeWidth="1.2" />
                <title>detector {n.index} · check {n.qubit} · round {n.round}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 font-sans text-[12px] text-muted">
        <span><span className="mr-1 inline-block h-[3px] w-5 align-middle" style={{ background: "var(--accent)" }} />matched edge</span>
        <span><span className="mr-1 inline-block h-[2px] w-5 align-middle" style={{ background: "var(--s4)" }} />edge whose faults flip the logical observable</span>
        <span>{g.data.nodes.length} detectors · {g.data.edges.length} edges · {g.data.weights}</span>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- stored 2,000,000-shot study
type Ref = { generated: string; seed: number; noise_model: string; points: { code: string; p: number; distance: number; rounds: number; errors: number; shots: number; rate: number; ci95: [number, number]; vs_d3?: string }[] };

export function StoredStudy() {
  const ref = useGet<Ref>(`${SIM}/reference`);
  if (ref.error) return <ErrorBox error={ref.error} what="Stored study" />;
  if (!ref.data) return <Loading what="Loading the stored study" />;
  const pick = (code: string, d: number, color: string, dashed = false): Series => ({
    id: `${code}${d}`, label: `${code === "surface" ? "surface Z" : code === "surface_x" ? "surface X" : "repetition"}, d = ${d}`, color, dashed,
    points: ref.data!.points.filter((r) => r.code === code && r.distance === d).sort((a, b) => a.p - b.p)
      .map((r) => ({ x: r.p, y: r.rate, lo: r.ci95[0], hi: r.ci95[1], note: `${r.errors.toLocaleString()} of ${r.shots.toLocaleString()} shots${r.vs_d3 ? ` · ${r.vs_d3}` : ""}` })),
  });
  return (
    <div data-testid="stored-study" data-generated={ref.data.generated}>
      <Plot series={[pick("surface", 3, "var(--s1)"), pick("surface", 5, "var(--s2)"), pick("repetition", 3, "var(--s3)", true), pick("repetition", 5, "var(--s4)", true)]}
        xLabel="physical error rate p (circuit-level depolarizing)" yLabel="logical error per experiment (rounds = d)" xDomain={[7e-4, 1.4e-2]} />
      <div className="mt-3 font-sans text-[12px] text-muted">
        Read from <span className="num">results/qec_validation/data.json</span>, generated {ref.data.generated}, seed {ref.data.seed}. At p = 0.01 the surface code at d = 5 is{" "}
        {fmtSci(ref.data.points.find((r) => r.code === "surface" && r.p === 0.01 && r.distance === 5)?.rate)} against{" "}
        {fmtSci(ref.data.points.find((r) => r.code === "surface" && r.p === 0.01 && r.distance === 3)?.rate)} at d = 3: above threshold, more distance hurts.
      </div>
    </div>
  );
}
