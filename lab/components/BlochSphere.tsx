"use client";
import { useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { Vec3 } from "@/lib/quantum";
import { r2 } from "@/lib/useWidth";

type Arrow = { r: Vec3; color: string; label?: string; dashed?: boolean };

/**
 * Orthographic Bloch sphere. View: rotate about z by `az`, then tilt by `el`.
 * Drag (or focus + arrow keys) to turn it. `ellipsoid` draws the image of the sphere under the
 * affine channel map r -> diag * r + shift.
 */
export function BlochSphere({ arrows, trail, ellipsoid, size = 300, label }: {
  arrows: Arrow[]; trail?: Vec3[]; ellipsoid?: { diag: Vec3; shift: Vec3 }; size?: number; label: string;
}) {
  const [view, setView] = useState({ az: -0.95, el: 0.32 });
  const drag = useRef<{ x: number; y: number; az: number; el: number } | null>(null);
  const R = size * 0.36, cx = size / 2, cy = size / 2 + 4;

  const proj = (p: Vec3) => {
    const ca = Math.cos(view.az), sa = Math.sin(view.az), ce = Math.cos(view.el), se = Math.sin(view.el);
    const x1 = p[0] * ca - p[1] * sa, y1 = p[0] * sa + p[1] * ca, z1 = p[2];
    // screen right = y1, up = z1 tilted toward the viewer; depth = x1 (positive is toward the viewer)
    const depth = x1 * ce + z1 * se;
    const up = z1 * ce - x1 * se;
    return { u: r2(cx + R * y1), v: r2(cy - R * up), depth: r2(depth) };
  };

  const circle = (f: (t: number) => Vec3, key: string, color = "var(--rule-strong)", w = 1) => {
    const pts = Array.from({ length: 97 }, (_, i) => proj(f((i / 96) * 2 * Math.PI)));
    const segs: ReactElement[] = [];
    for (let i = 0; i < 96; i++) {
      const a = pts[i], b = pts[i + 1], front = a.depth + b.depth >= 0;
      segs.push(<line key={key + i} x1={a.u} y1={a.v} x2={b.u} y2={b.v} stroke={color} strokeWidth={w} strokeDasharray={front ? undefined : "2 3"} opacity={front ? 1 : 0.55} />);
    }
    return segs;
  };

  const axes: [Vec3, string][] = [[[0, 0, 1], "|0⟩"], [[0, 0, -1], "|1⟩"], [[1, 0, 0], "|+⟩"], [[-1, 0, 0], "|−⟩"], [[0, 1, 0], "|+i⟩"], [[0, -1, 0], "|−i⟩"]];
  const axisNames: [Vec3, string][] = [[[1.32, 0, 0], "x"], [[0, 1.32, 0], "y"], [[0, 0, 1.32], "z"]];
  const o = proj([0, 0, 0]);

  const onKey = (e: KeyboardEvent) => {
    const d = 0.12;
    const m: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] };
    if (m[e.key]) { e.preventDefault(); setView((v) => ({ az: v.az + m[e.key][0], el: Math.max(-1.3, Math.min(1.3, v.el + m[e.key][1])) })); }
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size, touchAction: "none", cursor: "grab" }}
      role="img" aria-label={`${label} Drag or use the arrow keys to rotate the view.`} tabIndex={0} onKeyDown={onKey}
      onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ...view }; }}
      onPointerMove={(e) => { const d = drag.current; if (d) setView({ az: d.az + (e.clientX - d.x) * 0.012, el: Math.max(-1.3, Math.min(1.3, d.el + (e.clientY - d.y) * 0.012)) }); }}
      onPointerUp={() => { drag.current = null; }}>
      <circle cx={cx} cy={cy} r={R} fill="var(--sunken)" stroke="var(--rule-strong)" />
      {circle((t) => [Math.cos(t), Math.sin(t), 0], "eq")}
      {circle((t) => [Math.cos(t), 0, Math.sin(t)], "mxz")}
      {circle((t) => [0, Math.cos(t), Math.sin(t)], "myz", "var(--rule)")}
      {ellipsoid && (() => {
        const { diag: d, shift: s } = ellipsoid;
        const map = (p: Vec3): Vec3 => [d[0] * p[0] + s[0], d[1] * p[1] + s[1], d[2] * p[2] + s[2]];
        return [
          ...circle((t) => map([Math.cos(t), Math.sin(t), 0]), "e1", "var(--s3)", 1.6),
          ...circle((t) => map([Math.cos(t), 0, Math.sin(t)]), "e2", "var(--s3)", 1.6),
          ...circle((t) => map([0, Math.cos(t), Math.sin(t)]), "e3", "var(--s3)", 1.6),
        ];
      })()}
      {axisNames.map(([p, n]) => { const q = proj(p); const z = proj([0, 0, 0]); return (
        <g key={n}><line x1={z.u} y1={z.v} x2={q.u} y2={q.v} stroke="var(--muted)" strokeWidth="0.8" strokeDasharray="1 2" />
          <text x={q.u} y={q.v} dy="0.35em" textAnchor="middle" fontSize="11" fontStyle="italic" fill="var(--muted)" fontFamily="var(--font-source-serif)">{n}</text></g>); })}
      {axes.map(([p, n]) => { const q = proj([p[0] * 1.13, p[1] * 1.13, p[2] * 1.13]); return (
        <text key={n} x={q.u} y={q.v} dy="0.35em" textAnchor="middle" fontSize="11.5" fill="var(--ink-2)" fontFamily="var(--font-jetbrains)" opacity={q.depth < -0.2 ? 0.55 : 1}>{n}</text>); })}
      {trail && trail.length > 1 && <polyline fill="none" stroke="var(--s3)" strokeWidth="1.2" strokeDasharray="2 2" points={trail.map((p) => { const q = proj(p); return `${q.u},${q.v}`; }).join(" ")} />}
      {trail?.map((p, i) => { const q = proj(p); return <circle key={i} cx={q.u} cy={q.v} r="1.8" fill="var(--s3)" />; })}
      {arrows.map((a, i) => {
        const q = proj(a.r);
        const len = Math.hypot(q.u - o.u, q.v - o.v) || 1, ux = (q.u - o.u) / len, uy = (q.v - o.v) / len;
        return (
          <g key={i}>
            <line x1={o.u} y1={o.v} x2={r2(q.u - ux * 5)} y2={r2(q.v - uy * 5)} stroke={a.color} strokeWidth="2.4" strokeDasharray={a.dashed ? "4 3" : undefined} />
            <path d={`M${q.u},${q.v} L${r2(q.u - ux * 10 - uy * 4.5)},${r2(q.v - uy * 10 + ux * 4.5)} L${r2(q.u - ux * 10 + uy * 4.5)},${r2(q.v - uy * 10 - ux * 4.5)} z`} fill={a.color} />
            <circle cx={q.u} cy={q.v} r="3" fill={a.color} />
          </g>
        );
      })}
      <circle cx={o.u} cy={o.v} r="2" fill="var(--ink-2)" />
    </svg>
  );
}
