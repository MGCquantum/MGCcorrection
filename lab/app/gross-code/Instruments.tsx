"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, ErrorBox, Loading, NumberField, Segmented, Select, Stat } from "@/components/Controls";
import { Panel } from "@/components/Layout";
import { Provenance } from "@/components/Provenance";
import { TeX } from "@/components/TeX";
import { AEGIS, getJSON, useRun } from "@/lib/api";

export type Structure = {
  source: string; computed_by: string; ell: number; m: number; rounds: number; n: number; k: number; rank_hx: number; rank_hz: number;
  A: { terms: string[] }; B: { terms: string[] }; checks_per_type: number; commute: boolean;
  row_weights: { hx: number[]; hz: number[] }; column_weights: { hx: number[]; hz: number[] };
  distance: { value: number; computed_here: boolean; source: string };
  x_checks: number[][]; z_checks: number[][]; neighbour_labels: string[];
  schedule: { x: (number | null)[]; z: (number | null)[] };
  logical_x: number[][]; logical_z: number[][];
  circuits: Record<"X" | "Z", { file: string; qubits: number; measurements: number; detectors_total: number; detectors_decoded: number; observables: number;
    noise_p_used_for_dem: number; H_shape: [number, number]; H_nonzeros: number; column_weight_histogram: Record<string, number>; columns_flipping_a_logical: number;
    prior_range: [number, number]; H_block_counts: number[][]; H_block_shape: [number, number] }>;
  seconds: number;
};

let shared: Promise<Structure> | null = null;
/** The code's structure, fetched once per page load and shared by every panel. */
export function useStructure() {
  const [state, setState] = useState<{ data: Structure | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    shared ??= getJSON<Structure>(`${AEGIS}/gross/structure`);
    shared.then((data) => live && setState({ data, error: null })).catch((e: Error) => { shared = null; if (live) setState({ data: null, error: e.message }); });
    return () => { live = false; };
  }, []);
  return state;
}

const Z_LABELS = ["B1ᵀ", "B2ᵀ", "B3ᵀ", "A1ᵀ", "A2ᵀ", "A3ᵀ"];

export function CodeFacts({ s }: { s: Structure }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" data-testid="gross-facts">
      <Stat label="n (data qubits)" value={s.n} sub={`2ℓm = 2·${s.ell}·${s.m}`} testid="gf-n" />
      <Stat label="rank H_X, rank H_Z" value={`${s.rank_hx}, ${s.rank_hz}`} sub="over GF(2)" testid="gf-rank" />
      <Stat label="k (logical qubits)" value={s.k} sub={`${s.n} − ${s.rank_hx} − ${s.rank_hz}`} testid="gf-k" />
      <Stat label="H_X H_Zᵀ = 0" value={s.commute ? "true" : "FALSE"} sub="checked on the matrices" testid="gf-commute" />
      <Stat label="check weight" value={s.row_weights.hx.join(",")} sub={`qubit degree ${s.column_weights.hx.join(",")} per type`} />
      <Stat label="d (distance)" value={s.distance.value} sub="published, not recomputed" />
    </div>
  );
}

// ---------------------------------------------------------------- Tanner graph on the torus
type Sel = { kind: "X" | "Z" | "data"; i: number } | null;

export function TannerTorus({ s }: { s: Structure }) {
  const [sel, setSel] = useState<Sel>({ kind: "X", i: 0 });
  const [all, setAll] = useState<"none" | "X" | "Z">("none");
  const [logical, setLogical] = useState<number>(-1);
  const [logicalType, setLogicalType] = useState<"X" | "Z">("X");
  const shot = useRun<object, { syndrome: number[][]; seed: number; basis: string; p: number; source: string }>(`${AEGIS}/decode`);
  const [shotSeed, setShotSeed] = useState(7);
  const [shotP, setShotP] = useState(0.004);
  const [round, setRound] = useState(5);

  const { ell, m } = s, n2 = ell * m, S = 31, pad = 22;
  const cell = (idx: number) => ({ i: Math.floor((idx % n2) / m), j: idx % m });
  const pos = (kind: "X" | "L" | "R" | "Z", idx: number) => {
    const { i, j } = cell(idx), ox = pad + i * 2 * S, oy = pad + j * 2 * S;
    return { X: { x: ox, y: oy }, L: { x: ox + S, y: oy }, R: { x: ox, y: oy + S }, Z: { x: ox + S, y: oy + S } }[kind];
  };
  const dataPos = (q: number) => pos(q < n2 ? "L" : "R", q);
  const W = pad * 2 + 2 * S * ell - S, H = pad * 2 + 2 * S * m - S;
  /** Shortest torus displacement from a check to one of its data qubits, in drawing units. */
  const edge = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const wrap = (dlt: number, L: number) => ((dlt + L / 2) % L + L) % L - L / 2;
    return { x2: from.x + wrap(to.x - from.x, 2 * S * ell), y2: from.y + wrap(to.y - from.y, 2 * S * m) };
  };

  const neighbours = useMemo(() => {
    if (!sel) return [];
    if (sel.kind === "X") return s.x_checks[sel.i].map((q, d) => ({ q, label: s.neighbour_labels[d] }));
    if (sel.kind === "Z") return s.z_checks[sel.i].map((q, d) => ({ q, label: Z_LABELS[d] }));
    return [];
  }, [sel, s]);
  const dataChecks = useMemo(() => {
    if (sel?.kind !== "data") return { x: [] as number[], z: [] as number[] };
    return { x: s.x_checks.flatMap((row, c) => (row.includes(sel.i) ? [c] : [])), z: s.z_checks.flatMap((row, c) => (row.includes(sel.i) ? [c] : [])) };
  }, [sel, s]);
  const support = new Set(logical >= 0 ? (logicalType === "X" ? s.logical_x : s.logical_z)[logical] : []);
  const syn = shot.data?.syndrome;
  const firedChecks = new Set(syn ? syn[round].flatMap((v, c) => (v ? [c] : [])) : []);
  const synType = shot.data?.basis ?? "X";

  const node = (kind: "X" | "Z" | "L" | "R", idx: number) => {
    const p = pos(kind, idx);
    const isCheck = kind === "X" || kind === "Z";
    const q = kind === "L" ? idx : kind === "R" ? idx + n2 : idx;
    const selected = sel && ((isCheck && sel.kind === kind && sel.i === idx) || (!isCheck && sel.kind === "data" && sel.i === q));
    const nb = !isCheck && neighbours.some((x) => x.q === q);
    const nbCheck = isCheck && ((kind === "X" && dataChecks.x.includes(idx)) || (kind === "Z" && dataChecks.z.includes(idx)));
    const fired = isCheck && kind === synType && firedChecks.has(idx);
    const inSupport = !isCheck && support.has(q);
    const color = kind === "X" ? "var(--xcheck)" : kind === "Z" ? "var(--zcheck)" : "var(--ink-2)";
    const fill = fired ? "var(--fired)" : selected ? color : inSupport ? "var(--s4)" : nb || nbCheck ? `color-mix(in srgb, ${color} 35%, var(--panel))` : "var(--panel)";
    const label = isCheck ? `${kind} check ${idx}` : `data qubit ${q} (${kind === "L" ? "left" : "right"} block)`;
    const pick = () => setSel(isCheck ? { kind: kind as "X" | "Z", i: idx } : { kind: "data", i: q });
    return (
      <g key={kind + idx} role="button" tabIndex={-1} aria-label={label} onClick={pick} style={{ cursor: "pointer" }} data-testid={`tn-${kind}${idx}`} data-fired={fired ? 1 : 0}>
        {isCheck ? <rect className="focus-ring" x={p.x - 6.5} y={p.y - 6.5} width={13} height={13} rx={2} fill={fill} stroke={color} strokeWidth={selected ? 2.4 : 1.4} />
          : <circle className="focus-ring" cx={p.x} cy={p.y} r={6.5} fill={fill} stroke={selected ? "var(--fault)" : color} strokeWidth={selected ? 2.4 : 1.1} />}
        <title>{label}</title>
      </g>
    );
  };

  const selPos = sel ? (sel.kind === "data" ? dataPos(sel.i) : pos(sel.kind, sel.i)) : null;

  return (
    <Panel title="Tanner graph of the [[144,12,12]] code, drawn on its 12 × 6 torus" source={<Provenance source="live" detail="H_X, H_Z from make_circuit.py" />} testid="tanner">
      <div className="flex flex-wrap items-end gap-4">
        <Segmented label="Show all edges" value={all} onChange={setAll} options={[{ value: "none", label: "selected only" }, { value: "X", label: "all X-check edges" }, { value: "Z", label: "all Z-check edges" }]} />
        <Select label="Highlight a logical operator" value={logical} onChange={setLogical}
          options={[{ value: -1, label: "none" }, ...Array.from({ length: s.k }, (_, k) => ({ value: k, label: `${logicalType === "X" ? "X̄" : "Z̄"}${k + 1} (weight ${(logicalType === "X" ? s.logical_x : s.logical_z)[k].length})` }))]} testid="tn-logical" />
        <Segmented label="Logical type" value={logicalType} onChange={setLogicalType} options={[{ value: "X", label: "X̄" }, { value: "Z", label: "Z̄" }]} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <svg width={W} height={H} className="block" role="group" aria-label="Torus layout: each cell holds an X check, a left data qubit, a right data qubit and a Z check. Edges wrap around the torus.">
          <defs><clipPath id="torus"><rect x={pad - 14} y={pad - 14} width={W - 2 * pad + 28} height={H - 2 * pad + 28} /></clipPath></defs>
          {Array.from({ length: ell }, (_, i) => Array.from({ length: m }, (_, j) => (
            <rect key={`${i}-${j}`} x={pad + i * 2 * S - 12} y={pad + j * 2 * S - 12} width={S + 24} height={S + 24} rx={4} fill="var(--sunken)" opacity={0.6} />
          )))}
          <g clipPath="url(#torus)">
            {all !== "none" && (all === "X" ? s.x_checks : s.z_checks).flatMap((row, c) => row.map((q, d) => {
              const a = pos(all, c), e = edge(a, dataPos(q));
              return <line key={`${c}-${d}`} x1={a.x} y1={a.y} {...e} stroke={all === "X" ? "var(--xcheck)" : "var(--zcheck)"} strokeWidth="0.6" opacity="0.35" />;
            }))}
            {selPos && sel?.kind !== "data" && neighbours.map(({ q, label }) => {
              const e = edge(selPos, dataPos(q));
              return (
                <g key={q}>
                  <line x1={selPos.x} y1={selPos.y} {...e} stroke={sel!.kind === "X" ? "var(--xcheck)" : "var(--zcheck)"} strokeWidth="2" />
                  <circle cx={e.x2} cy={e.y2} r="3" fill="var(--ink-2)" />
                  <text x={(selPos.x + e.x2) / 2} y={(selPos.y + e.y2) / 2 - 4} fontSize="10" fill="var(--ink)" fontFamily="var(--font-jetbrains)" textAnchor="middle" paintOrder="stroke" stroke="var(--panel)" strokeWidth="3">{label}</text>
                </g>
              );
            })}
            {selPos && sel?.kind === "data" && [...dataChecks.x.map((c) => ["X", c] as const), ...dataChecks.z.map((c) => ["Z", c] as const)].map(([k, c]) => {
              const e = edge(selPos, pos(k, c));
              return <line key={k + c} x1={selPos.x} y1={selPos.y} {...e} stroke={k === "X" ? "var(--xcheck)" : "var(--zcheck)"} strokeWidth="2" />;
            })}
          </g>
          {Array.from({ length: n2 }, (_, c) => [node("X", c), node("L", c), node("R", c), node("Z", c)])}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-sans text-[12px] text-muted">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-[2px] border-2 align-middle" style={{ borderColor: "var(--xcheck)" }} />X check (72)</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border align-middle" style={{ borderColor: "var(--ink-2)" }} />data qubit (144: left block top-right of a cell, right block bottom-left)</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-[2px] border-2 align-middle" style={{ borderColor: "var(--zcheck)" }} />Z check (72)</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: "var(--s4)" }} />logical support</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-[2px] align-middle" style={{ background: "var(--fired)" }} />detection event</span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="font-sans text-[13px] leading-relaxed text-ink-2" data-testid="tn-selection">
          {sel?.kind === "X" || sel?.kind === "Z" ? (
            <>
              <div className="font-semibold text-ink">{sel.kind} check {sel.i} (torus cell {cell(sel.i).i}, {cell(sel.i).j})</div>
              <div className="num mt-1">{neighbours.map((x) => `${x.label}→q${x.q}`).join("  ")}</div>
              <p className="mt-1">
                Weight 6: three qubits from one data block and three from the other. Edges that leave the panel wrap around the torus.
                Only the <span className="num">x</span> and <span className="num">y</span> terms are local. <span className="num">x²</span>,{" "}
                <span className="num">x³</span>, <span className="num">y²</span> and <span className="num">y³</span> reach 2–3 cells away. That is why this
                code cannot be laid out on a planar nearest-neighbour chip the way the surface code can.
              </p>
            </>
          ) : sel?.kind === "data" ? (
            <>
              <div className="font-semibold text-ink">Data qubit {sel.i} ({sel.i < n2 ? "left" : "right"} block)</div>
              <div className="num mt-1">X checks {dataChecks.x.join(", ")} · Z checks {dataChecks.z.join(", ")}</div>
              <p className="mt-1">Every data qubit is in exactly 3 X checks and 3 Z checks, so its Tanner degree is 6.</p>
            </>
          ) : null}
          {logical >= 0 && <p className="mt-2">Logical {logicalType === "X" ? "X̄" : "Z̄"}{logical + 1} acts on {support.size} qubits. These representatives come from GF(2) elimination and are not of minimum weight. The minimum over each logical class is 12.</p>}
        </div>
        <div className="rounded-[5px] border border-rule p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-sans text-[13px] font-semibold text-ink">Overlay one live memory shot</span>
            <Provenance source="live" detail="Stim sample, :8765" />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Select label="p" value={shotP} onChange={setShotP} options={[0.003, 0.004, 0.005].map((v) => ({ value: v, label: String(v) }))} />
            <NumberField label="Seed" value={shotSeed} min={0} onChange={setShotSeed} />
            <Button onClick={() => shot.run({ basis: "X", p: shotP, f: 0, seed: shotSeed, baselines: [] })} disabled={shot.loading} testid="tn-sample">{shot.loading ? "Sampling…" : "Sample X-memory shot"}</Button>
          </div>
          <ErrorBox error={shot.error} what="Gross backend" />
          {syn && (
            <div className="mt-3">
              <label className="block font-sans text-[12px] text-muted">Syndrome row {round} of {syn.length - 1} ({round === syn.length - 1 ? "final data readout vs last cycle" : `cycle ${round + 1}`}): <span className="num text-ink" data-testid="tn-row-count">{firedChecks.size}</span> X-check detection events
                <input type="range" min={0} max={syn.length - 1} value={round} onChange={(e) => setRound(+e.target.value)} className="mt-1 w-full accent-[var(--accent)]" data-testid="tn-round" />
              </label>
              <div className="font-sans text-[11.5px] text-muted">Seed {shot.data!.seed}, p = {shot.data!.p}. Total detection events in this shot: <span className="num">{syn.flat().reduce((a, b) => a + b, 0)}</span>. Decoding of this shot happens in Modules 5 and 6.</div>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- parity-check matrices
export function CheckMatrices({ s }: { s: Structure }) {
  const [which, setWhich] = useState<"X" | "Z">("X");
  const rows = which === "X" ? s.x_checks : s.z_checks, n2 = s.checks_per_type, px = 4;
  return (
    <Panel title={<>Parity-check matrix <TeX>{which === "X" ? "H_X = [A\\,|\\,B]" : "H_Z = [B^{\\mathsf T}\\,|\\,A^{\\mathsf T}]"}</TeX></>} source={<Provenance source="live" />} testid="check-matrix">
      <Segmented label="Matrix" value={which} onChange={setWhich} options={[{ value: "X", label: "H_X" }, { value: "Z", label: "H_Z" }]} />
      <div className="mt-3 overflow-x-auto">
        <svg width={2 * n2 * px + 2 * 20} height={n2 * px + 30} className="block" role="img" aria-label={`${n2} by ${2 * n2} parity-check matrix, ${rows.length * 6} ones`}>
          <rect x={20} y={10} width={2 * n2 * px} height={n2 * px} fill="var(--sunken)" />
          {rows.flatMap((r, c) => r.map((q) => <rect key={`${c}-${q}`} x={20 + q * px} y={10 + c * px} width={px} height={px} fill={which === "X" ? "var(--xcheck)" : "var(--zcheck)"} />))}
          <line x1={20 + n2 * px} x2={20 + n2 * px} y1={6} y2={14 + n2 * px} stroke="var(--ink)" strokeWidth="1.2" />
          <text x={20 + (n2 * px) / 2} y={n2 * px + 26} textAnchor="middle" fontSize="11" fill="var(--muted)">left data block (72)</text>
          <text x={20 + 1.5 * n2 * px} y={n2 * px + 26} textAnchor="middle" fontSize="11" fill="var(--muted)">right data block (72)</text>
        </svg>
      </div>
      <p className="mt-2 font-sans text-[12.5px] leading-relaxed text-ink-2">
        {n2} rows (checks) × {2 * n2} columns (qubits), {rows.length * 6} ones. Each half is a sum of three permutation matrices, so every row has three ones in
        each half. Each permutation shows up as a family of parallel diagonals, broken where the cyclic shift wraps.
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------- syndrome-extraction schedule
export function Schedule({ s }: { s: Structure }) {
  const layers = [0, 1, 2, 3, 4, 5, 6];
  const lab = (v: number | null, kind: "x" | "z") => (v === null ? "idle" : kind === "x" ? s.neighbour_labels[v] : Z_LABELS[v]);
  return (
    <Panel title="One syndrome cycle: 7 CNOT layers + measure/reset" source={<Provenance source="live" detail="S_X, S_Z from make_circuit.py" />} testid="schedule">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-sans text-[12.5px]">
          <thead><tr className="border-b border-rule-strong text-left text-muted"><th className="py-1.5 pr-3 font-medium">Layer</th>{layers.map((l) => <th key={l} className="num px-2 font-medium">{l}</th>)}<th className="px-2 font-medium">7</th></tr></thead>
          <tbody>
            <tr className="border-b border-rule"><td className="py-1.5 pr-3" style={{ color: "var(--xcheck)" }}>X checks (control)</td>{layers.map((l) => <td key={l} className="num px-2">{lab(s.schedule.x[l], "x")}</td>)}<td className="px-2">measure X (re-prepared before layer 0)</td></tr>
            <tr className="border-b border-rule"><td className="py-1.5 pr-3" style={{ color: "var(--zcheck)" }}>Z checks (target)</td>{layers.map((l) => <td key={l} className="num px-2">{lab(s.schedule.z[l], "z")}</td>)}<td className="px-2">reset (measured after layer 5)</td></tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-sans text-[12.5px] leading-relaxed text-ink-2">
        In each layer every X check does a CNOT onto its neighbour of that label and every Z check receives one from its neighbour. The ordering is the
        depth-8 schedule of Bravyi et al. (Nature 627, 778): each qubit takes part in at most one gate per layer, and the interleaving of X and Z checks
        still measures every stabilizer correctly. Faults inside this circuit spread through the CNOTs (hook errors). That is why decoders work on the
        circuit-level detector error model below rather than on H_X alone.
      </p>
    </Panel>
  );
}

export function DemView({ s }: { s: Structure }) {
  const [basis, setBasis] = useState<"X" | "Z">("X");
  const c = s.circuits[basis];
  const [rb, cb] = c.H_block_shape, max = Math.max(...c.H_block_counts.flat());
  const hist = Object.entries(c.column_weight_histogram).map(([w, n]) => [+w, n] as const);
  const hmax = Math.max(...hist.map(([, n]) => n));
  const cw = 7, ch = 5;
  return (
    <Panel title="Detector error model: the matrix every decoder solves" source={<Provenance source="live" detail={`Stim DEM at p = ${c.noise_p_used_for_dem}`} />} testid="dem">
      <Segmented label="Memory basis" value={basis} onChange={setBasis} options={[{ value: "X", label: "X memory" }, { value: "Z", label: "Z memory" }]} />
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Circuit qubits" value={c.qubits} sub="144 data + 144 check" testid="dem-qubits" />
        <Stat label="Measurements" value={c.measurements.toLocaleString()} sub={`${s.rounds} cycles + data readout`} />
        <Stat label="Detectors decoded" value={`${c.detectors_decoded} of ${c.detectors_total.toLocaleString()}`} sub={`13 rows × 72 ${basis} checks`} testid="dem-dets" />
        <Stat label="H (detectors × faults)" value={`${c.H_shape[0]} × ${c.H_shape[1].toLocaleString()}`} sub={`${c.H_nonzeros.toLocaleString()} nonzeros`} testid="dem-shape" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
        <div className="min-w-0">
          <div className="mb-1 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Where H&apos;s nonzeros are (binned {Math.round(c.H_shape[0] / rb)} rows × {Math.round(c.H_shape[1] / cb)} columns)</div>
          <div className="overflow-x-auto"><svg width={cb * cw + 40} height={rb * ch + 24} className="block" role="img" aria-label="Density of the detector error model matrix: a band from the first syndrome round (top left) to the final readout (bottom right).">
            {c.H_block_counts.flatMap((row, i) => row.map((v, j) => v ? <rect key={`${i}-${j}`} x={30 + j * cw} y={4 + i * ch} width={cw} height={ch} fill="var(--s1)" opacity={0.15 + 0.85 * Math.sqrt(v / max)} /> : null))}
            <rect x={30} y={4} width={cb * cw} height={rb * ch} fill="none" stroke="var(--rule-strong)" />
            <text x={26} y={10} textAnchor="end" fontSize="10" fill="var(--muted)">t=1</text>
            <text x={26} y={rb * ch + 2} textAnchor="end" fontSize="10" fill="var(--muted)">final</text>
            <text x={30 + (cb * cw) / 2} y={rb * ch + 18} textAnchor="middle" fontSize="10.5" fill="var(--muted)">fault mechanisms (columns)</text>
          </svg></div>
        </div>
        <div className="min-w-0">
          <div className="mb-1 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Detectors flipped per fault (column weight)</div>
          <div className="space-y-1">
            {hist.map(([w, n]) => (
              <div key={w} className="grid grid-cols-[28px_1fr_56px] items-center gap-2 font-sans text-[12.5px]">
                <span className="num">{w}</span>
                <div className="h-3 rounded-sm bg-sunken"><div className="h-full rounded-sm" style={{ width: `${(100 * n) / hmax}%`, background: "var(--s2)" }} /></div>
                <span className="num text-right">{n.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 font-sans text-[12.5px] leading-relaxed text-ink-2">
            Of the {c.H_shape[1].toLocaleString()} fault classes, the lightest flips {hist[0][0]} detectors, and{" "}
            {(100 * hist.filter(([w]) => w >= 3).reduce((a, [, n]) => a + n, 0) / c.H_shape[1]).toFixed(0)}% flip three or more. A surface-code fault
            (Module 3, split into its X and Z parts) flips at most two. With three or more the decoding graph becomes a hypergraph and minimum-weight matching does not apply. This is why
            the Gross code needs belief propagation (Module 5). {c.columns_flipping_a_logical.toLocaleString()} of the columns also flip at least one of the{" "}
            {c.observables} logical observables. Priors range from {c.prior_range[0].toExponential(2)} to {c.prior_range[1].toExponential(2)}.
          </p>
        </div>
      </div>
    </Panel>
  );
}

function withStructure(Inner: (p: { s: Structure }) => ReactNode) {
  return function Loaded() {
    const st = useStructure();
    if (st.error) return <ErrorBox error={st.error} what="Gross-code backend (:8765)" />;
    if (!st.data) return <Loading what="Computing the code from make_circuit.py (about 2 s the first time)" />;
    return <Inner s={st.data} />;
  };
}
export const FactsPanel = withStructure(CodeFacts);
export const TannerPanel = withStructure(TannerTorus);
export const MatricesPanel = withStructure(CheckMatrices);
export const SchedulePanel = withStructure(Schedule);
export const DemPanel = withStructure(DemView);
