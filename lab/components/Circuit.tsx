"use client";
import { useState } from "react";
import { DataTable, ErrorBox } from "./Controls";
import { Provenance } from "./Provenance";
import { SIM, useGet } from "@/lib/api";

/**
 * The syndrome-extraction circuit exactly as the MidQwest backend lays it out (`drawing` from
 * /api/circuit, or from an injection response, where the injected fault is a real ERR gate).
 * Port of the legacy :8000 dashboard's drawCircuit: same columns, same gate glyphs, same rules
 * for marking measurements whose check fired.
 */
export type Drawing = { ops: { g: string; rows: number[]; col: number; pauli?: string }[]; columns: number; ticks: number[]; round_ends: { round: number; col: number }[] };
export type CQubit = { id: number; row: number; role: string };
type Fired = { qubit: number | null; round: number };

const TEXT: Record<string, string> = { R: "|0⟩", RX: "|+⟩", H: "H", M: "M", MX: "Mx", MR: "MR" };
const TIP: Record<string, string> = { R: "Reset to |0⟩", RX: "Reset to |+⟩", H: "Hadamard", M: "Measure (Z basis)", MX: "Measure (X basis)", MR: "Measure, then reset" };

export function rowName(q: CQubit) {
  return q.role === "data" ? `d${q.id}` : q.role === "ancilla_x" ? `x${q.id}` : `z${q.id}`;
}

export function CircuitDiagram({ drawing, qubits, rounds, fired, testid = "circuit" }: {
  drawing: Drawing; qubits: CQubit[]; rounds: number; fired?: Fired[]; testid?: string;
}) {
  const [tip, setTip] = useState<string | null>(null);
  const qs = [...qubits].sort((a, b) => a.row - b.row);
  const byRow = new Map(qs.map((q) => [q.row, q]));
  const cw = 26, rh = 24, left = 46, top = 22;
  const W = left + drawing.columns * cw + 16, H = top + qs.length * rh + 8;
  const cx = (c: number) => left + c * cw + cw / 2, cy = (r: number) => top + r * rh + rh / 2;
  const firedMR = new Set<string>();
  (fired ?? []).forEach((d) => { const q = qs.find((x) => x.id === d.qubit); if (q && d.round < rounds) firedMR.add(`${q.row}:${d.round}`); });
  const mrSeen: Record<number, number> = {};
  let prev = 0;
  const errOps = drawing.ops.filter((o) => o.g === "ERR");
  return (
    <div data-testid={testid}>
      <div className="overflow-x-auto rounded-[5px] border border-rule bg-panel p-2">
        <svg width={W} height={H} role="img" aria-label="Circuit diagram, time runs left to right" className="block">
          {drawing.round_ends.map((r) => {
            const x = left + r.col * cw, mid = left + ((prev + r.col) / 2) * cw;
            const el = (
              <g key={r.round}>
                <line x1={x} y1={top - 6} x2={x} y2={H - 4} stroke="var(--rule-strong)" strokeDasharray="3 3" />
                <text x={mid} y={12} textAnchor="middle" fontSize="10.5" fill="var(--muted)">round {r.round}</text>
              </g>
            );
            prev = r.col;
            return el;
          })}
          {drawing.columns > prev && <text x={left + ((prev + drawing.columns) / 2) * cw} y={12} textAnchor="middle" fontSize="10.5" fill="var(--muted)">readout</text>}
          {qs.map((q) => (
            <g key={q.id}>
              <line x1={left} y1={cy(q.row)} x2={W - 8} y2={cy(q.row)} stroke="var(--rule-strong)" />
              <text x={left - 8} y={cy(q.row)} dy="0.35em" textAnchor="end" fontSize="10.5" fill={q.role === "data" ? "var(--ink-2)" : q.role === "ancilla_x" ? "var(--xcheck)" : "var(--zcheck)"} fontFamily="var(--font-jetbrains)">{rowName(q)}</text>
            </g>
          ))}
          {drawing.ops.map((op, i) => {
            const x = cx(op.col);
            if (op.g === "CX") {
              const [c, t] = op.rows;
              const tipText = `CNOT: control ${rowName(byRow.get(c)!)}, target ${rowName(byRow.get(t)!)}`;
              return (
                <g key={i} onMouseEnter={() => setTip(tipText)} onMouseLeave={() => setTip(null)}>
                  <line x1={x} y1={cy(c)} x2={x} y2={cy(t)} stroke="var(--ink-2)" strokeWidth="1.2" />
                  <circle cx={x} cy={cy(c)} r={3} fill="var(--ink-2)" />
                  <circle cx={x} cy={cy(t)} r={6} fill="var(--panel)" stroke="var(--ink-2)" strokeWidth="1.2" />
                  <line x1={x - 6} x2={x + 6} y1={cy(t)} y2={cy(t)} stroke="var(--ink-2)" strokeWidth="1.2" />
                  <line x1={x} x2={x} y1={cy(t) - 6} y2={cy(t) + 6} stroke="var(--ink-2)" strokeWidth="1.2" />
                </g>
              );
            }
            const r = op.rows[0], y = cy(r), q = byRow.get(r)!;
            let kind: "plain" | "err" | "fired" = "plain", text = TEXT[op.g] ?? op.g, tipText = `${TIP[op.g] ?? op.g} on ${rowName(q)}`;
            if (op.g === "ERR") { kind = "err"; text = op.pauli ?? "E"; tipText = `Injected ${op.pauli} error on ${rowName(q)} (column ${op.col})`; }
            if (op.g === "MR") {
              const n = mrSeen[r] ?? 0; mrSeen[r] = n + 1;
              if (firedMR.has(`${r}:${n}`)) { kind = "fired"; tipText += `. This check fired in round ${n + 1}`; }
            }
            const fill = kind === "err" ? "var(--fault)" : kind === "fired" ? "var(--fired)" : "var(--panel)";
            return (
              <g key={i} onMouseEnter={() => setTip(tipText)} onMouseLeave={() => setTip(null)}
                data-testid={kind === "err" ? "circuit-error" : kind === "fired" ? "circuit-fired" : undefined} data-col={op.col} data-row={r}>
                <rect x={x - 10} y={y - 9} width={20} height={18} rx={3} fill={fill} stroke={kind === "plain" ? "var(--ink-2)" : fill} strokeWidth="1.1" />
                <text x={x} y={y} dy="0.35em" textAnchor="middle" fontSize="9.5" fill={kind === "plain" ? "var(--ink)" : "var(--paper)"} fontFamily="var(--font-jetbrains)">{text}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1.5 min-h-[18px] font-sans text-[12px] text-ink-2" aria-live="polite">
        {tip ?? (errOps.length ? `Injected error: ${errOps.map((o) => `${o.pauli} on ${rowName(byRow.get(o.rows[0])!)} at column ${o.col}`).join(", ")}. Hover any gate for details.` : "Hover any gate for details. Time runs left to right; dashed lines close each syndrome round.")}
      </div>
    </div>
  );
}

type Metrics = { qubits: number; depth: number; two_qubit_gates: number; measure: number; reset: number };
type Compiled = { target: string; optimization_level: number; logical: Metrics; compiled: Metrics; two_qubit_overhead: number; compile_seconds: number };

/** Circuit size as written and after local compilation for IBM heavy-hex (an estimate, never an execution). */
export function CompileMetrics({ code, basis, distance, rounds, written }: { code: string; basis: string; distance: number; rounds: number; written: Metrics }) {
  const c = useGet<Compiled>(`${SIM}/compile?code=${code}&basis=${basis}&distance=${distance}&rounds=${rounds}`);
  const cell = (k: keyof Metrics) => (c.data ? c.data.compiled[k] : c.loading ? "…" : "–");
  return (
    <div data-testid="compile-metrics">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Circuit size</span>
        <Provenance source="live" detail="local Qiskit transpile" />
        <span className="rounded-full border border-[var(--prov-hardware)] px-2 py-[1px] font-sans text-[11px] text-[var(--prov-hardware)]">hardware-target estimate, not executed</span>
      </div>
      <DataTable testid="compile-table" align={["l", "r", "r"]} head={["", "As written", "Compiled for IBM heavy-hex (estimate)"]}
        rows={[
          ["Qubits", <span key="a" data-testid="cm-qubits">{written.qubits}</span>, cell("qubits")],
          ["Depth", <span key="a" data-testid="cm-depth">{written.depth}</span>, <span key="b" data-testid="cm-depth-compiled">{cell("depth")}</span>],
          ["Two-qubit gates", <span key="a" data-testid="cm-2q">{written.two_qubit_gates}</span>, <span key="b" data-testid="cm-2q-compiled">{cell("two_qubit_gates")}</span>],
          ["Measurements", written.measure, cell("measure")],
          ["Resets", written.reset, cell("reset")],
        ]} />
      <ErrorBox error={c.error} what="Compilation" />
      {c.data && (
        <p className="mt-2 font-sans text-[12px] leading-relaxed text-ink-2">
          Two-qubit overhead from routing: <strong className="num" data-testid="cm-overhead">{c.data.two_qubit_overhead}</strong>×. Target: {c.data.target}, optimization
          level {c.data.optimization_level}, compiled locally in {c.data.compile_seconds} s. FakeKingston is an offline snapshot of the device&apos;s coupling map and
          calibration, so these numbers estimate the cost on hardware. Nothing was sent to IBM and nothing ran on a quantum processor.
        </p>
      )}
    </div>
  );
}
