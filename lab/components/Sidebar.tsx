"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MODULES } from "@/lib/modules";
import { BackendStatus } from "./BackendStatus";

export function Sidebar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="lab-nav"
        className="fixed right-3 top-3 z-40 rounded border border-rule-strong bg-panel px-3 py-1.5 font-sans text-[13px] lg:hidden">
        {open ? "Close" : "Modules"}
      </button>
      <aside id="lab-nav"
        className={`${open ? "fixed inset-0 z-30 block overflow-y-auto bg-paper" : "hidden"} w-[17rem] shrink-0 border-r border-rule lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto`}>
        <div className="px-6 pb-6 pt-9">
          <Link href="/" className="block">
            <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">MidQwest · QEC</div>
            <div className="mt-1 font-serif text-[1.3rem] font-semibold leading-tight text-navy">Error Correction<br />Research Laboratory</div>
          </Link>
          <nav aria-label="Modules" className="mt-8">
            <ol className="space-y-0.5">
              {MODULES.map((m) => {
                const on = path === `/${m.slug}`;
                return (
                  <li key={m.slug}>
                    <Link href={`/${m.slug}`} aria-current={on ? "page" : undefined}
                      className={`group flex items-baseline gap-3 rounded-[5px] px-2.5 py-1.5 font-sans text-[13.5px] transition-colors ${on ? "bg-navy text-paper" : "text-ink-2 hover:bg-sunken"}`}>
                      <span className={`num text-[11.5px] ${on ? "text-paper/70" : "text-muted"}`}>{String(m.n).padStart(2, "0")}</span>
                      <span>{m.short}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </nav>
          <div className="mt-8 border-t border-rule pt-5"><BackendStatus /></div>
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => {
    try { const t = localStorage.getItem("lab-theme"); if (t) { document.documentElement.dataset.theme = t; setTheme(t); } } catch { /* storage unavailable */ }
  }, []);
  const set = (t: string | null) => {
    setTheme(t);
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    try { if (t) localStorage.setItem("lab-theme", t); else localStorage.removeItem("lab-theme"); } catch { /* ignore */ }
  };
  return (
    <div className="mt-5 flex items-center gap-1 font-sans text-[12px] text-muted" role="group" aria-label="Colour theme">
      {[["System", null], ["Light", "light"], ["Dark", "dark"]].map(([label, v]) => (
        <button key={label} type="button" onClick={() => set(v)} aria-pressed={theme === v}
          className={`rounded px-2 py-0.5 ${theme === v ? "bg-sunken text-ink" : "hover:text-ink"}`}>{label}</button>
      ))}
    </div>
  );
}
