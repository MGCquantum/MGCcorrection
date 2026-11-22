export type Source = "theory" | "live" | "stored" | "reference" | "hardware" | "illustration" | "account";

const META: Record<Source, { label: string; glyph: string; color: string; title: string }> = {
  theory: { label: "Exact theory", glyph: "∑", color: "var(--prov-theory)", title: "Closed-form mathematics computed in your browser. No sampling." },
  live: { label: "Live simulation", glyph: "▶", color: "var(--prov-live)", title: "Computed just now by a local Python backend (Stim, Aer, PyMatching, ldpc, relay-bp)." },
  stored: { label: "Stored measurement", glyph: "▣", color: "var(--prov-stored)", title: "Read from result files written earlier by this project's simulation runs." },
  reference: { label: "Published reference", glyph: "❝", color: "var(--prov-stored)", title: "Copied from a cited source. Not measured on this machine." },
  hardware: { label: "Archived hardware", glyph: "◆", color: "var(--prov-hardware)", title: "Measured once on IBM Quantum hardware and archived with checksums. Never re-run." },
  account: { label: "IBM account check", glyph: "◎", color: "var(--prov-live)", title: "Read-only metadata from IBM Quantum (authentication, backend list and status), fetched by a local script. No job submitted." },
  illustration: { label: "Illustration", glyph: "◇", color: "var(--prov-theory)", title: "A worked mathematical example on a small code, computed in your browser. Not the production decoder." },
};

export function Provenance({ source, detail }: { source: Source; detail?: string }) {
  const m = META[source];
  return (
    <span title={m.title} data-provenance={source}
      className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-full border px-2 py-[1px] align-middle font-sans text-[11.5px] font-medium sm:whitespace-nowrap"
      style={{ color: m.color, borderColor: `color-mix(in srgb, ${m.color} 40%, transparent)` }}>
      <span aria-hidden className="text-[10px]">{m.glyph}</span>
      {m.label}{detail ? <span className="font-normal opacity-80">· {detail}</span> : null}
    </span>
  );
}

export function ProvenanceLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(META) as Source[]).map((s) => <Provenance key={s} source={s} />)}
    </div>
  );
}
