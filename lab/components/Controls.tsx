"use client";
import type { ReactNode } from "react";

export function Segmented<T extends string | number>({ label, value, options, onChange, testid }: {
  label: string; value: T; options: { value: T; label: ReactNode; hint?: string }[]; onChange: (v: T) => void; testid?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} data-testid={testid} className="inline-flex flex-col gap-1">
      <span className="font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">{label}</span>
      <div className="inline-flex overflow-hidden rounded-[5px] border border-rule-strong">
        {options.map((o, i) => {
          const on = o.value === value;
          return (
            <button key={String(o.value)} type="button" role="radio" aria-checked={on} title={o.hint}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (step) { e.preventDefault(); onChange(options[(i + step + options.length) % options.length].value); }
              }}
              className={`px-3 py-1.5 font-sans text-[13px] transition-colors ${i ? "border-l border-rule-strong" : ""} ${on ? "bg-navy text-paper" : "bg-panel text-ink-2 hover:bg-sunken"}`}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, format, testid }: {
  label: ReactNode; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; testid?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">
        <span>{label}</span><span className="num text-[12.5px] normal-case tracking-normal text-ink">{format ? format(value) : value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} data-testid={testid}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
    </label>
  );
}

export function Select<T extends string | number>({ label, value, options, onChange, testid }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testid?: string;
}) {
  return (
    <label className="inline-flex flex-col gap-1">
      <span className="font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">{label}</span>
      <select value={String(value)} data-testid={testid}
        onChange={(e) => { const o = options.find((x) => String(x.value) === e.target.value); if (o) onChange(o.value); }}
        className="rounded-[5px] border border-rule-strong bg-panel px-2.5 py-1.5 font-sans text-[13px] text-ink">
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function NumberField({ label, value, onChange, min, max, step = 1, testid, width = "w-28" }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; testid?: string; width?: string;
}) {
  return (
    <label className="inline-flex flex-col gap-1">
      <span className="font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} data-testid={testid}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`num rounded-[5px] border border-rule-strong bg-panel px-2.5 py-1.5 text-[13px] text-ink ${width}`} />
    </label>
  );
}

export function Button({ children, onClick, disabled, kind = "primary", testid, type = "button" }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: "primary" | "secondary" | "ghost"; testid?: string; type?: "button" | "submit";
}) {
  const style = kind === "primary" ? "bg-navy text-paper hover:opacity-90 border-navy"
    : kind === "secondary" ? "bg-panel text-navy border-rule-strong hover:bg-sunken" : "bg-transparent text-accent border-transparent hover:underline";
  return (
    <button type={type} onClick={onClick} disabled={disabled} data-testid={testid}
      className={`inline-flex items-center gap-2 rounded-[5px] border px-3.5 py-1.5 font-sans text-[13px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${style}`}>
      {children}
    </button>
  );
}

export function Stat({ label, value, sub, testid }: { label: ReactNode; value: ReactNode; sub?: ReactNode; testid?: string }) {
  return (
    <div className="rounded-[5px] border border-rule bg-panel px-3.5 py-2.5">
      <div className="font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className="num mt-0.5 text-[1.25rem] text-ink" data-testid={testid}>{value}</div>
      {sub && <div className="mt-0.5 font-sans text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function ErrorBox({ error, what }: { error: string | null; what?: string }) {
  if (!error) return null;
  return (
    <div role="alert" className="my-3 rounded-sm border-l-2 border-fault bg-[color-mix(in_srgb,var(--fault)_7%,transparent)] px-4 py-2.5 font-sans text-[13px] text-ink-2">
      <span className="font-semibold text-fault">{what ?? "Request failed"}: </span>{error}
    </div>
  );
}

export function Loading({ what = "Computing" }: { what?: string }) {
  return <div role="status" className="font-sans text-[13px] text-muted">{what}…</div>;
}

export function DataTable({ head, rows, testid, align }: { head: ReactNode[]; rows: ReactNode[][]; testid?: string; align?: ("l" | "r")[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-sans text-[13px]" data-testid={testid}>
        <thead><tr className="border-b border-rule-strong text-left text-[11.5px] uppercase tracking-[0.05em] text-muted">
          {head.map((h, i) => <th key={i} className={`px-2.5 py-2 font-medium ${align?.[i] === "r" ? "text-right" : ""}`}>{h}</th>)}
        </tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} className="border-b border-rule">
            {r.map((cell, j) => <td key={j} className={`px-2.5 py-1.5 text-ink-2 ${align?.[j] === "r" ? "num text-right" : ""}`}>{cell}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
