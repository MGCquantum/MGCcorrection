"use client";
import { useState } from "react";
import { r2, useWidth } from "@/lib/useWidth";

/** Overlaid step histograms on a log-x axis (counts per bin, one series per decoder). */
export function LogHistogram({ edges, series, xLabel, testid }: {
  edges: number[]; series: { id: string; label: string; color: string; counts: number[]; total: number }[]; xLabel: string; testid?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth<HTMLDivElement>();
  const H = 300, m = { l: 56, r: 16, t: 10, b: 44 };
  const l0 = Math.log10(edges[0]), l1 = Math.log10(edges[edges.length - 1]);
  // Trim to the populated range so the shape is readable.
  const used = series.flatMap((s) => s.counts.map((c, i) => (c ? i : -1))).filter((i) => i >= 0);
  const i0 = Math.max(0, Math.min(...used) - 1), i1 = Math.min(edges.length - 2, Math.max(...used) + 1);
  const a = Math.log10(edges[i0]), b = Math.log10(edges[i1 + 1]);
  const fx = (v: number) => r2(m.l + ((Math.log10(v) - a) / (b - a)) * (W - m.l - m.r));
  const frac = series.map((s) => s.counts.map((c) => c / Math.max(s.total, 1)));
  const ymax = Math.max(...frac.flat(), 1e-9) * 1.08;
  const fy = (v: number) => r2(H - m.b - (v / ymax) * (H - m.t - m.b));
  const ticks = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].filter((t) => Math.log10(t) >= a && Math.log10(t) <= b);
  const yt = [0, 0.25, 0.5, 0.75, 1].map((k) => k * ymax);
  void l0; void l1;
  return (
    <div data-testid={testid} ref={box}>
      <div className="mb-2 flex flex-wrap gap-x-4 font-sans text-[12.5px] text-ink-2">
        {series.map((s) => <span key={s.id} className="inline-flex items-center gap-1.5"><span className="inline-block h-[3px] w-5 rounded" style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={`Distribution of ${xLabel}`} onMouseLeave={() => setHover(null)}>
          {yt.map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={fy(t)} y2={fy(t)} stroke="var(--rule)" />
            <text x={m.l - 8} y={fy(t)} dy="0.32em" textAnchor="end" fontSize="11.5" fill="var(--muted)" className="num">{(100 * t).toFixed(t < 0.1 ? 1 : 0)}%</text></g>)}
          {ticks.map((t) => <g key={t}><line x1={fx(t)} x2={fx(t)} y1={H - m.b} y2={H - m.b + 5} stroke="var(--rule-strong)" />
            <text x={fx(t)} y={H - m.b + 18} textAnchor="middle" fontSize="11.5" fill="var(--muted)" className="num">{t >= 1000 ? `${t / 1000} s` : `${t} ms`}</text></g>)}
          <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} stroke="var(--rule-strong)" />
          <text x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle" fontSize="12.5" fill="var(--ink-2)">{xLabel} (log scale)</text>
          <text transform={`translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12.5" fill="var(--ink-2)">share of shot pairs</text>
          {series.map((s, k) => {
            const pts: string[] = [];
            for (let i = i0; i <= i1; i++) { pts.push(`${fx(edges[i])},${fy(frac[k][i])}`, `${fx(edges[i + 1])},${fy(frac[k][i])}`); }
            return <polyline key={s.id} points={`${fx(edges[i0])},${fy(0)} ${pts.join(" ")} ${fx(edges[i1 + 1])},${fy(0)}`} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />;
          })}
          {Array.from({ length: i1 - i0 + 1 }, (_, j) => i0 + j).map((i) => (
            <rect key={i} x={fx(edges[i])} y={m.t} width={fx(edges[i + 1]) - fx(edges[i])} height={H - m.t - m.b} fill={hover === i ? "var(--ink)" : "transparent"} opacity={hover === i ? 0.05 : 1}
              onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute z-10 rounded-[5px] border border-rule-strong bg-panel px-3 py-2 font-sans text-[12px] shadow-sm"
            style={{ left: `${(fx(edges[hover + 1]) / W) * 100}%`, top: "8%" }}>
            <div className="num font-semibold text-ink">{edges[hover].toPrecision(3)} – {edges[hover + 1].toPrecision(3)} ms</div>
            {series.map((s, k) => <div key={s.id} className="num text-ink-2">{s.label}: {s.counts[hover]} pairs ({(100 * frac[k][hover]).toFixed(1)}%)</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
