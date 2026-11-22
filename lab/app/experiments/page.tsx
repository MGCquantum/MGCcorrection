import type { Metadata } from "next";
import { TeX } from "@/components/TeX";
import { ModuleHeader, Note, Section, SixQuestions } from "@/components/Layout";
import { GrossExperiment, RateSweep, SimCompare } from "./Instruments";

export const metadata: Metadata = { title: "Interactive Experiments" };

export default function Experiments() {
  return (
    <article className="max-w-[1180px]">
      <ModuleHeader n={6} sources={["live"]}>
        <p>
          Three bounded experiments run on the real backends. Every request is validated server-side against fixed limits, so each one finishes in seconds
          on a laptop. Everything you see in a result panel is the backend&apos;s response, shown as returned. The run id and seed let you reproduce it.
        </p>
      </ModuleHeader>

      <SixQuestions
        problem={<>Does a decoder recover the logical state on a sampled shot? How does the logical error rate scale with p and d? Do two independent simulators agree?</>}
        equations={<>Failure means <TeX>{"L\\hat e\\ne Le"}</TeX>. Rates come with Clopper–Pearson intervals, and the simulators are compared with Fisher&apos;s exact test on the two error counts.</>}
        algorithm={<>Stim samples the circuit (and Aer in C). The backend decodes with relay-BP, BP-OSD and QEC-Aegis (A) or PyMatching (B, C). The page renders the JSON response.</>}
        controls={<>Basis, p, erasure fraction and seed for the Gross code. Code, basis, noise model, rounds, p range, shots and seed for the sweep. Distance, p and shots for the comparison.</>}
        demonstrates={<>Single shots show the mechanism. Sweeps show suppression below threshold and growth above it, with honest error bars. Aer and Stim agree within statistics.</>}
        limitations={<>Interactive bounds: one Gross shot per request, at most 100,000 shots per sweep point and 20,000 per comparison. Gross-code p is limited to the trained range 0.003–0.005.</>}
      />

      <Section id="gross" kicker="6.1" title="Decode a Gross-code memory experiment"><GrossExperiment /></Section>
      <Section id="sweep" kicker="6.2" title="Sweep the physical error rate"><RateSweep /></Section>
      <Section id="compare" kicker="6.3" title="Cross-check the simulators"><SimCompare /></Section>
      <Note>
        Bounded on purpose: the backends refuse oversized requests with a clear message (HTTP 422) and allow two simulations at a time on the FastAPI
        server (HTTP 429 beyond that). Long, statistically meaningful runs are the batch pipelines whose stored results appear in Module 7.
      </Note>
    </article>
  );
}
