import type { Metadata } from "next";
import { Eq, TeX } from "@/components/TeX";
import { ModuleHeader, Prose, Section, SixQuestions } from "@/components/Layout";
import { CalibrationFigure, FrontierFigure, LatencyFigure, LerFigure, ResourcesTable } from "./Instruments";
import { FrozenEvaluation, WhenFinal } from "./Evaluation";

export const metadata: Metadata = { title: "Research Results" };

export default function Results() {
  return (
    <article className="max-w-[1180px]">
      <ModuleHeader n={7} sources={["stored", "reference"]}>
        <p>
          This is the research workspace. Every figure is computed on request from the per-shot records that the batch pipeline (<span className="num text-[0.92em]">aegis.collect</span>)
          wrote to disk: every shot&apos;s failure flag and decode time, for every decoder. Each caption states the assumptions, sample size, uncertainty and
          limitations. Nothing here is typed in by hand.
        </p>
      </ModuleHeader>

      <SixQuestions
        problem={<>How often does each decoder fail on the Gross-code memory at p = 0.003, 0.004 and 0.005, how long does it take, and what does adaptive routing buy?</>}
        equations={<>Pair failure <TeX>{"P"}</TeX>, rate per cycle <TeX>{"1-(1-P)^{1/12}"}</TeX>, a Wilson interval on <TeX>{"P"}</TeX>, and bootstrap intervals on means.</>}
        algorithm={<>The QEC-Aegis backend loads the record files, pairs X and Z shots, and summarizes them with the project&apos;s own <span className="num">aegis.policy.summarize</span>. The page plots the response.</>}
        controls={<>The noise strength and the decoders shown. Final numbers appear only once the frozen-test evaluation is complete; until then this page shows its live progress. Every chart has a data-table view.</>}
        demonstrates={<>On the same shots, relay-BP fails 3–7× less often than BP-OSD. A first-solution relay-BP is about 2.5× faster on average but fails more. On validation, the routed decoder matches relay-BP&apos;s failure count at about half its mean time (optimistic: its threshold was tuned on these shots).</>}
        limitations={<>The preliminary sections use validation shots, which also served for tuning. Their timing comes from parallel workers on a shared machine. Few failures at p = 0.003 make intervals wide.</>}
      />

      <Section id="final" kicker="7.0" title="Frozen-test evaluation (final results)">
        <Prose className="mb-6 max-w-[54rem]">
          <p>
            Final numbers come only from <span className="num">aegis.evaluate</span> on the frozen test shots (seed 2). Nothing in the decoder was tuned on those
            shots. This section reports the pipeline&apos;s real state: until every planned setting is evaluated, it says so and shows no final figures.
          </p>
        </Prose>
        <FrozenEvaluation />
        <WhenFinal>
          <LatencyFigure split="timing" n="7.F5" />
          <Section id="final-resources" kicker="7.F6" title="Resources used by the frozen evaluation"><ResourcesTable splits={["test", "timing"]} /></Section>
        </WhenFinal>
      </Section>

      <Section id="ler" kicker="7.1" title="Preliminary: logical error rate and the required p-sweep on validation shots">
        <Prose className="mb-6 max-w-[54rem]">
          <p>With <TeX>{"F"}</TeX> failed pairs out of <TeX>{"N"}</TeX>, the rate per cycle and its interval are</p>
          <Eq n="7.1">{"\\hat P = F/N,\\qquad \\varepsilon_{\\text{cycle}} = 1 - (1-\\hat P)^{1/12},\\qquad [\\varepsilon_-, \\varepsilon_+] = 1 - (1 - [P_-, P_+]_{\\text{Wilson}})^{1/12}"}</Eq>
          <p>
            The per-cycle form assumes cycles fail independently. It is the convention of the starter kit and of the relay-BP paper, so these numbers are
            comparable with theirs.
          </p>
        </Prose>
        <LerFigure />
      </Section>

      <Section id="latency" kicker="7.2" title="Preliminary: decoder latency distributions (validation)"><LatencyFigure /></Section>
      <Section id="frontier" kicker="7.3" title="Preliminary: what adaptive routing buys (validation)"><FrontierFigure /></Section>
      <Section id="calibration" kicker="7.4" title="Calibration of the learned risk"><CalibrationFigure /></Section>
      <Section id="resources" kicker="7.5" title="Resource usage of the measurements">
        <Prose className="mb-4 max-w-[54rem]"><p>Every decoding run is logged in <span className="num">experiments/manifest.json</span> with its settings, wall and CPU time, peak memory, package versions and commit. The table is that log.</p></Prose>
        <ResourcesTable />
      </Section>
    </article>
  );
}
