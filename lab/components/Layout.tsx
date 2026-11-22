import type { ReactNode } from "react";
import { MODULES } from "@/lib/modules";
import { Provenance, type Source } from "./Provenance";

export function ModuleHeader({ n, children, sources }: { n: number; children?: ReactNode; sources?: Source[] }) {
  const m = MODULES.find((x) => x.n === n)!;
  return (
    <header className="mb-10 border-b border-rule pb-8">
      <div className="mb-3 font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Module {n}</div>
      <h1 className="font-serif text-[2.5rem] font-semibold leading-[1.1] tracking-[-0.01em] text-navy">{m.title}</h1>
      <div className="prose-lab mt-4 max-w-[46rem] text-[1.15rem]">{children ?? <p>{m.blurb}</p>}</div>
      {sources && <div className="mt-5 flex flex-wrap gap-2">{sources.map((s) => <Provenance key={s} source={s} />)}</div>}
    </header>
  );
}

export type SixQ = { problem: ReactNode; equations: ReactNode; algorithm: ReactNode; controls: ReactNode; demonstrates: ReactNode; limitations: ReactNode };

/** The six questions every module answers, in one scannable frame. */
export function SixQuestions(q: SixQ) {
  const rows: [string, keyof SixQ][] = [
    ["What problem are we studying?", "problem"], ["Governing equations", "equations"],
    ["How the algorithm works", "algorithm"], ["What you can manipulate", "controls"],
    ["What the experiment demonstrates", "demonstrates"], ["Limitations", "limitations"],
  ];
  return (
    <section aria-label="Summary of this module" className="mb-14 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-rule bg-rule md:grid-cols-2 xl:grid-cols-3">
      {rows.map(([title, key], i) => (
        <div key={key} className="bg-panel p-5">
          <div className="mb-2 flex items-baseline gap-2 font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
            <span className="num text-accent">{i + 1}</span>{title}
          </div>
          <div className="font-serif text-[15px] leading-relaxed text-ink-2">{q[key]}</div>
        </div>
      ))}
    </section>
  );
}

export function Section({ id, kicker, title, children, aside }: { id?: string; kicker?: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} className="mb-16 scroll-mt-8">
      {kicker && <div className="mb-1 font-sans text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{kicker}</div>}
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-[1.7rem] font-semibold leading-tight text-navy">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Two columns: derivation (prose + equations) beside a working instrument. */
export function Split({ left, right, ratio = "even" }: { left: ReactNode; right: ReactNode; ratio?: "even" | "wide-right" | "wide-left" | "stack" }) {
  if (ratio === "stack") return <div className="space-y-6"><div className="min-w-0">{left}</div><div className="min-w-0">{right}</div></div>;
  const cols = ratio === "even" ? "lg:grid-cols-2" : ratio === "wide-right" ? "lg:grid-cols-[5fr_7fr]" : "lg:grid-cols-[7fr_5fr]";
  return <div className={`grid grid-cols-1 gap-8 ${cols}`}><div className="min-w-0">{left}</div><div className="min-w-0">{right}</div></div>;
}

export function Panel({ title, source, children, className = "", testid }: { title?: ReactNode; source?: ReactNode; children: ReactNode; className?: string; testid?: string }) {
  return (
    <div className={`rounded-md border border-rule bg-panel ${className}`} data-testid={testid}>
      {(title || source) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
          <div className="font-sans text-[13px] font-semibold text-ink">{title}</div>
          {source}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Prose({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`prose-lab max-w-[44rem] ${className}`}>{children}</div>;
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div className={`my-4 rounded-sm border-l-2 px-4 py-2.5 font-sans text-[13.5px] leading-relaxed ${tone === "warn" ? "border-[var(--prov-hardware)] bg-[color-mix(in_srgb,var(--prov-hardware)_8%,transparent)]" : "border-accent bg-accent-soft"} text-ink-2`}>
      {children}
    </div>
  );
}

/** Figure with the caption fields every research figure must state. */
export function Figure({ n, title, children, source, assumptions, sample, uncertainty, limitations, testid }: {
  n: string; title: string; children: ReactNode; source: ReactNode; assumptions: ReactNode; sample: ReactNode; uncertainty: ReactNode; limitations: ReactNode; testid?: string;
}) {
  return (
    <figure className="mb-14 rounded-md border border-rule bg-panel" data-testid={testid}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-3">
        <div className="font-sans text-[14px] font-semibold text-ink"><span className="num mr-2 text-accent">Fig. {n}</span>{title}</div>
        {source}
      </div>
      <div className="p-5">{children}</div>
      <figcaption className="grid grid-cols-1 gap-x-8 gap-y-3 border-t border-rule bg-sunken/50 px-5 py-4 font-sans text-[12.75px] leading-relaxed text-ink-2 md:grid-cols-2">
        <div><span className="font-semibold text-ink">Assumptions. </span>{assumptions}</div>
        <div><span className="font-semibold text-ink">Sample size. </span>{sample}</div>
        <div><span className="font-semibold text-ink">Uncertainty. </span>{uncertainty}</div>
        <div><span className="font-semibold text-ink">Limitations. </span>{limitations}</div>
      </figcaption>
    </figure>
  );
}
