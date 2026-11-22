"use client";
import { useMemo, useState, type ReactNode } from "react";
import { r2, useWidth } from "@/lib/useWidth";

export type Pt = { x: number; y: number; lo?: number; hi?: number; note?: string };
export type Series = { id: string; label: string; color: string; points: Pt[]; line?: boolean; dashed?: boolean; hollow?: boolean; width?: number };

type Scale = { f: (v: number) => number; ticks: number[]; minor: number[]; fmt: (v: number) => string };

const sup = (n: number) => String(n).replace(/-/g, "⁻").replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[+d]);

function logScale(lo: number, hi: number, a: number, b: number): Scale {
  const l0 = Math.log10(lo), l1 = Math.log10(hi);
  const f = (v: number) => r2(a + ((Math.log10(Math.max(v, 1e-300)) - l0) / (l1 - l0)) * (b - a));
  const ticks: number[] = [], minor: number[] = [];
  for (let e = Math.floor(l0); e <= Math.ceil(l1); e++) {
    const t = Math.pow(10, e);
    if (t >= lo * 0.999 && t <= hi * 1.001) ticks.push(t);
    for (const k of [2, 3, 4, 5, 6, 7, 8, 9]) { const m = k * t; if (m > lo && m < hi) minor.push(m); }
  }
  // Short ranges: label 2x and 5x too.
  if (ticks.length < 2) for (const m of minor) if ([2, 5].includes(Math.round(m / Math.pow(10, Math.floor(Math.log10(m)))))) ticks.push(m);
  ticks.sort((x, y) => x - y);
  const fmt = (v: number) => {
    const e = Math.floor(Math.log10(v) + 1e-9), m = Math.round(v / Math.pow(10, e));
    if (e >= -2 && e <= 3) return String(+v.toPrecision(2));
    return m === 1 ? `10${sup(e)}` : `${m}×10${sup(e)}`;
  };
  return { f, ticks, minor, fmt };
}

function linScale(lo: number, hi: number, a: number, b: number, fmt?: (v: number) => string): Scale {
  const f = (v: number) => r2(a + ((v - lo) / (hi - lo)) * (b - a));
  const span = hi - lo, raw = span / 5, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= 6) ?? mag * 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) ticks.push(+t.toPrecision(12));
  return { f, ticks, minor: [], fmt: fmt ?? ((v) => String(+v.toPrecision(4))) };
}

export function Plot({ series, xLog = true, yLog = true, xLabel, yLabel, xDomain, yDomain, height = 340, xFmt, yFmt, tooltip, extra, testid, ariaLabel, xTicks }: {
  series: Series[]; xLog?: boolean; yLog?: boolean; xLabel: string; yLabel: string; xDomain?: [number, number]; yDomain?: [number, number];
  height?: number; xFmt?: (v: number) => string; yFmt?: (v: number) => string; tooltip?: (s: Series, p: Pt) => ReactNode;
  extra?: (sx: (v: number) => number, sy: (v: number) => number) => ReactNode; testid?: string; ariaLabel?: string; xTicks?: number[];
}) {
  const [hover, setHover] = useState<{ s: Series; p: Pt } | null>(null);
  const [table, setTable] = useState(false);
  const [box, W] = useWidth<HTMLDivElement>();
  const H = height, m = { l: 64, r: 18, t: 12, b: 46 };

  const dom = useMemo(() => {
    const xs = series.flatMap((s) => s.points.map((p) => p.x));
    const ys = series.flatMap((s) => s.points.flatMap((p) => [p.y, p.lo ?? p.y, p.hi ?? p.y])).filter((v) => !yLog || v > 0);
    const pad = (lo: number, hi: number, log: boolean): [number, number] => log ? [lo / 1.35, hi * 1.35] : [lo - (hi - lo) * 0.06, hi + (hi - lo) * 0.06];
    return {
      x: xDomain ?? pad(Math.min(...xs), Math.max(...xs), xLog),
      y: yDomain ?? pad(Math.min(...ys), Math.max(...ys), yLog),
    };
  }, [series, xDomain, yDomain, xLog, yLog]);

  if (!series.some((s) => s.points.length)) return <div className="font-sans text-[13px] text-muted">No data.</div>;
  const X0 = xLog ? logScale(dom.x[0], dom.x[1], m.l, W - m.r) : linScale(dom.x[0], dom.x[1], m.l, W - m.r, xFmt);
  const X = xTicks ? { ...X0, ticks: xTicks, fmt: (v: number) => String(+v.toPrecision(3)) } : X0;
  const Y = yLog ? logScale(dom.y[0], dom.y[1], H - m.b, m.t) : linScale(dom.y[0], dom.y[1], H - m.b, m.t, yFmt);
  const fx = xFmt ?? X.fmt, fy = yFmt ?? Y.fmt;
  const clampY = (v: number) => Math.max(m.t, Math.min(H - m.b, Y.f(yLog ? Math.max(v, dom.y[0]) : v)));

  return (
    <div data-testid={testid} ref={box}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-[12.5px] text-ink-2">
        {series.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <svg width="22" height="10" aria-hidden>
              {s.line !== false && <line x1="1" x2="21" y1="5" y2="5" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} />}
              <circle cx="11" cy="5" r="3.5" fill={s.hollow ? "var(--panel)" : s.color} stroke={s.color} strokeWidth="1.6" />
            </svg>{s.label}
          </span>
        ))}
        <button type="button" onClick={() => setTable((t) => !t)} className="ml-auto text-[12px] text-accent underline-offset-2 hover:underline">
          {table ? "Show chart" : "Show data table"}
        </button>
      </div>
      {table ? (
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full font-sans text-[12.5px]">
            <thead><tr className="border-b border-rule-strong text-left text-muted"><th className="py-1 pr-3">Series</th><th className="pr-3">{xLabel}</th><th className="pr-3">{yLabel}</th><th>95% interval</th></tr></thead>
            <tbody>{series.flatMap((s) => s.points.map((p, i) => (
              <tr key={s.id + i} className="border-b border-rule"><td className="py-1 pr-3">{s.label}</td><td className="num pr-3">{fx(p.x)}</td><td className="num pr-3">{p.y.toPrecision(3)}</td>
                <td className="num">{p.lo !== undefined ? `${p.lo.toPrecision(3)} – ${p.hi!.toPrecision(3)}` : "—"}</td></tr>)))}</tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={ariaLabel ?? `${yLabel} against ${xLabel}`} onMouseLeave={() => setHover(null)}>
            {Y.minor.map((t) => <line key={"ym" + t} x1={m.l} x2={W - m.r} y1={Y.f(t)} y2={Y.f(t)} stroke="var(--rule)" strokeWidth="0.5" opacity="0.6" />)}
            {Y.ticks.map((t) => (
              <g key={"y" + t}>
                <line x1={m.l} x2={W - m.r} y1={Y.f(t)} y2={Y.f(t)} stroke="var(--rule)" strokeWidth="1" />
                <text x={m.l - 8} y={Y.f(t)} dy="0.32em" textAnchor="end" className="num" fontSize="11.5" fill="var(--muted)">{fy(t)}</text>
              </g>
            ))}
            {X.ticks.map((t) => (
              <g key={"x" + t}>
                <line x1={X.f(t)} x2={X.f(t)} y1={H - m.b} y2={H - m.b + 5} stroke="var(--rule-strong)" />
                <text x={X.f(t)} y={H - m.b + 18} textAnchor="middle" className="num" fontSize="11.5" fill="var(--muted)">{fx(t)}</text>
              </g>
            ))}
            <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} stroke="var(--rule-strong)" />
            <text x={(m.l + W - m.r) / 2} y={H - 8} textAnchor="middle" fontSize="12.5" fill="var(--ink-2)">{xLabel}</text>
            <text transform={`translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12.5" fill="var(--ink-2)">{yLabel}</text>
            {extra?.(X.f, Y.f)}
            {series.map((s) => (
              <g key={s.id}>
                {s.line !== false && s.points.length > 1 && (
                  <polyline fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round"
                    points={s.points.map((p) => `${X.f(p.x)},${clampY(p.y)}`).join(" ")} />
                )}
                {s.points.map((p, i) => p.lo !== undefined && (
                  <g key={i} stroke={s.color} strokeWidth="1.4">
                    <line x1={X.f(p.x)} x2={X.f(p.x)} y1={clampY(p.lo)} y2={clampY(p.hi!)} />
                    <line x1={X.f(p.x) - 4} x2={X.f(p.x) + 4} y1={clampY(p.lo)} y2={clampY(p.lo)} />
                    <line x1={X.f(p.x) - 4} x2={X.f(p.x) + 4} y1={clampY(p.hi!)} y2={clampY(p.hi!)} />
                  </g>
                ))}
                {s.points.map((p, i) => (yLog && p.y <= 0) ? null : (
                  <g key={"p" + i}>
                    <circle cx={X.f(p.x)} cy={clampY(p.y)} r="4.2" fill={s.hollow ? "var(--panel)" : s.color} stroke={hover?.p === p ? "var(--ink)" : s.hollow ? s.color : "var(--panel)"} strokeWidth="1.8" />
                    <circle cx={X.f(p.x)} cy={clampY(p.y)} r="12" fill="transparent" onMouseEnter={() => setHover({ s, p })} onFocus={() => setHover({ s, p })} tabIndex={-1} />
                  </g>
                ))}
              </g>
            ))}
          </svg>
          {hover && (
            <div className="pointer-events-none absolute z-10 rounded-[5px] border border-rule-strong bg-panel px-3 py-2 font-sans text-[12px] shadow-sm"
              style={{ left: `${(X.f(hover.p.x) / W) * 100}%`, top: `${(clampY(hover.p.y) / H) * 100}%`, transform: "translate(12px, -110%)" }}>
              {tooltip ? tooltip(hover.s, hover.p) : (
                <>
                  <div className="font-semibold text-ink">{hover.s.label}</div>
                  <div className="num text-ink-2">{xLabel}: {fx(hover.p.x)}</div>
                  <div className="num text-ink-2">{yLabel}: {hover.p.y.toPrecision(3)}</div>
                  {hover.p.lo !== undefined && <div className="num text-muted">95%: {hover.p.lo.toPrecision(3)} – {hover.p.hi!.toPrecision(3)}</div>}
                  {hover.p.note && <div className="text-muted">{hover.p.note}</div>}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
