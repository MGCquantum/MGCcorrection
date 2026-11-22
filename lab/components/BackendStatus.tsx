"use client";
import { useGet, AEGIS, SIM } from "@/lib/api";

type SimHealth = { status: string; pid: number; versions: Record<string, string>; hardware_submission: string };
type AegisStatus = { source: string; offline: boolean; model: { name: string; tier1: string; tier2: string } | null };

function Dot({ ok, loading }: { ok: boolean; loading: boolean }) {
  return <span aria-hidden className="mt-[5px] inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: loading ? "var(--rule-strong)" : ok ? "var(--s5)" : "var(--fault)" }} />;
}

export function BackendStatus() {
  const sim = useGet<SimHealth>(`${SIM}/health`);
  const aegis = useGet<AegisStatus>(`${AEGIS}/status`);
  return (
    <div className="space-y-3 font-sans text-[12px] leading-snug text-ink-2" data-testid="backend-status">
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Local backends</div>
      <div className="flex gap-2">
        <Dot ok={!!sim.data} loading={sim.loading} />
        <div>
          <div className="font-medium text-ink">Simulation · :8000</div>
          <div className="text-muted">{sim.data ? `Stim ${sim.data.versions.stim} · Aer ${sim.data.versions["qiskit-aer"]} · PyMatching ${sim.data.versions.pymatching}` : sim.loading ? "connecting…" : "unreachable"}</div>
        </div>
      </div>
      <div className="flex gap-2">
        <Dot ok={!!aegis.data} loading={aegis.loading} />
        <div>
          <div className="font-medium text-ink">Gross / QEC-Aegis · :8765</div>
          <div className="text-muted">{aegis.data ? (aegis.data.model ? `model ${aegis.data.model.name}: ${aegis.data.model.tier1} → ${aegis.data.model.tier2}` : "baselines only (no trained model)") : aegis.loading ? "connecting…" : "unreachable"}</div>
        </div>
      </div>
      <div className="text-[11.5px] text-muted">Hardware submission: none. Neither backend has an IBM Quantum job path.</div>
    </div>
  );
}
