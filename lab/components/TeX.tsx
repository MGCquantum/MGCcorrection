import katex from "katex";

/** KaTeX math. Rendered to a string, so it works in server and client components alike. */
export function TeX({ children, block = false, className = "" }: { children: string; block?: boolean; className?: string }) {
  const html = katex.renderToString(children, { displayMode: block, throwOnError: false, strict: "ignore", output: "htmlAndMathml" });
  const Tag = block ? "div" : "span";
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A numbered display equation with an optional label column. */
export function Eq({ children, n, label }: { children: string; n?: string; label?: string }) {
  return (
    <div className="my-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-sm border-l-2 border-rule-strong bg-sunken/60 px-4 py-1">
      <div className="min-w-0">
        <TeX block>{children}</TeX>
        {label && <div className="pb-2 font-sans text-[12.5px] text-muted">{label}</div>}
      </div>
      {n && <span className="num text-[12px] text-muted">({n})</span>}
    </div>
  );
}
