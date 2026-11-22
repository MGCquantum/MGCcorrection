"use client";
import { DataTable, ErrorBox, Loading, Stat } from "@/components/Controls";
import { Panel } from "@/components/Layout";
import { Provenance } from "@/components/Provenance";
import { SIM, useGet } from "@/lib/api";

/** Older than this, the last check no longer says anything about the connection now. */
export const STALE_AFTER_S = 24 * 3600;

export type Backend = { name: string; qubits: number | null; operational: boolean | null; status: string | null; pending_jobs: number | null; processor: string | null; simulator: boolean | null };
export type IbmConnection = {
  source: string; live: false; refresh_command: string; hardware_execution: "disabled"; server_contacts_ibm: false;
  authentication: "connected" | "disconnected" | "unknown"; reason: string | null;
  checked_at: string | null; age_seconds?: number | null; last_successful_verification?: string | null;
  channel?: string | null; credential_source?: string;
  instance?: { name?: string | null; plan?: string | null; region?: string | null; instance_id_suffix?: string | null } | null;
  usage?: { usage_consumed_seconds?: number; usage_limit_seconds?: number; usage_remaining_seconds?: number; usage_limit_reached?: boolean; error?: string } | null;
  backends?: Backend[]; watched?: Record<string, { accessible: boolean } & Partial<Backend>>; operational_qpus?: number;
  transpile_check?: { backend: string; depth?: number; two_qubit_gates?: number; physical_qubits?: number[]; all_ops_in_target?: boolean; all_2q_gates_on_coupling_map?: boolean; submitted: false; error?: string } | null;
  submission_entry_points_blocked?: string[];
};

export function ago(s: number | null | undefined) {
  if (s == null) return "never";
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** What the panel may claim. A stale or missing check is Unknown, never Connected. */
export function authState(c: Pick<IbmConnection, "authentication" | "age_seconds" | "checked_at">): { label: string; tone: "ok" | "bad" | "unknown"; note: string } {
  if (!c.checked_at) return { label: "Unknown", tone: "unknown", note: "no check has been run" };
  const stale = c.age_seconds == null || c.age_seconds > STALE_AFTER_S;
  if (c.authentication === "connected")
    return stale ? { label: "Unknown", tone: "unknown", note: `last check connected, but it is ${ago(c.age_seconds)}` } : { label: "Connected", tone: "ok", note: `verified ${ago(c.age_seconds)}` };
  if (c.authentication === "disconnected") return { label: "Disconnected", tone: "bad", note: `at the check ${ago(c.age_seconds)}` };
  return { label: "Unknown", tone: "unknown", note: `check ${ago(c.age_seconds)} could not decide` };
}

const TONE = { ok: "var(--s5)", bad: "var(--fault)", unknown: "var(--muted)" } as const;

export function LiveConnection() {
  const r = useGet<IbmConnection>(`${SIM}/ibm-connection`);
  if (r.error) return <ErrorBox error={r.error} what="IBM connection status" />;
  if (!r.data) return <Loading what="Reading the last connection check" />;
  const c = r.data, a = authState(c), inst = c.instance ?? {};
  const stale = a.tone === "unknown" && c.authentication === "connected";
  const qpus = (c.backends ?? []).filter((b) => !b.simulator);
  const online = qpus.filter((b) => b.operational).length;
  return (
    <Panel testid="ibm-live" title="Live IBM Quantum connection (read-only)"
      source={<Provenance source="account" detail={c.checked_at ? `checked ${c.checked_at.replace("T", " ").slice(0, 16)}` : "not checked"} />}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat testid="ibm-auth" label="Authentication" value={<span style={{ color: TONE[a.tone] }} data-state={a.label.toLowerCase()}>{a.label}</span>} sub={a.note} />
        <Stat testid="ibm-instance" label="IBM Quantum instance" value={<span className="text-[15px]">{inst.name ?? "—"}</span>}
          sub={[inst.plan && `${inst.plan} plan`, inst.region, inst.instance_id_suffix && `id ${inst.instance_id_suffix}`].filter(Boolean).join(" · ") || "—"} />
        <Stat testid="ibm-qpus" label="Operational QPUs" value={c.checked_at ? `${online} / ${qpus.length}` : "—"} sub={stale ? "as of the last check (stale)" : "at the last check"} />
        <Stat testid="ibm-exec" label="Hardware execution" value={<span style={{ color: "var(--fault)" }}>Disabled</span>} sub="no submission path in the lab or its APIs" />
      </div>

      {qpus.length > 0 && (
        <div className="mt-4">
          <DataTable testid="ibm-backends" align={["l", "r", "l", "r", "l"]} head={["QPU", "Qubits", "Status", "Queue (pending jobs)", "Processor"]}
            rows={qpus.map((b) => [<span key="n" className="num" data-testid={`ibm-be-${b.name}`}>{b.name}</span>, b.qubits ?? "—",
              <span key="s" style={{ color: b.operational ? "var(--s5)" : "var(--fault)" }}>{b.operational ? "online" : "offline"}{b.status && b.status !== "active" ? ` · ${b.status}` : ""}</span>,
              b.pending_jobs ?? "—", b.processor ?? "—"])} />
        </div>
      )}

      <div className="mt-3 space-y-1.5 font-sans text-[12.5px] text-ink-2">
        {c.watched && <p data-testid="ibm-watched">Devices this project has used or targeted: {Object.entries(c.watched).map(([n, w]) => `${n} ${w.accessible ? "accessible" : "not accessible"}`).join(" · ")}.</p>}
        {c.transpile_check && !c.transpile_check.error && (
          <p data-testid="ibm-transpile">Local compile check on {c.transpile_check.backend}: a 3-qubit GHZ circuit compiled at optimization level 3 to physical qubits {c.transpile_check.physical_qubits?.join(", ")}, depth {c.transpile_check.depth}, {c.transpile_check.two_qubit_gates} two-qubit gates; instructions in the device target {c.transpile_check.all_ops_in_target ? "✓" : "✗"}, two-qubit gates on the coupling map {c.transpile_check.all_2q_gates_on_coupling_map ? "✓" : "✗"}. Compiled on this laptop, <strong>not submitted</strong>.</p>
        )}
        {c.usage && c.usage.usage_limit_seconds != null && <p>Open Plan quota this period: {c.usage.usage_consumed_seconds ?? 0} s used of {c.usage.usage_limit_seconds} s.</p>}
        <p>Last successful verification: <span className="num" data-testid="ibm-last-ok">{c.last_successful_verification?.replace("T", " ").slice(0, 19) ?? "never"}</span>. {c.reason}</p>
        <p className="text-muted">
          This panel shows the snapshot written by a read-only script that authenticates with the saved account, lists backends and reads their status. The lab and its
          servers never contact IBM and never see the API key. Refresh from a terminal in ~/MidQwest: <span className="num">{c.refresh_command}</span>
        </p>
      </div>
    </Panel>
  );
}
