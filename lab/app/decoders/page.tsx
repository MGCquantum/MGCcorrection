import type { Metadata } from "next";
import { Eq, TeX } from "@/components/TeX";
import { ModuleHeader, Note, Prose, Section, SixQuestions } from "@/components/Layout";
import { BPIllustration, LiveDecode, RouterCard } from "./Instruments";
import { ArchitectureRationale, PairedOutcomes, PredecoderStudy, RouterSelection, RoutingRules } from "./Research";

export const metadata: Metadata = { title: "Decoder Mathematics" };

export default function Decoders() {
  return (
    <article className="max-w-[1180px]">
      <ModuleHeader n={5} sources={["illustration", "live"]}>
        <p>
          A decoder receives a syndrome and must output a correction that fixes the logical state. For the Gross code that means a 936 × 8,784 binary system,
          solved in milliseconds, thousands of times per second of operation. This module derives the algorithms in the order they were invented to fix each
          other&apos;s failures.
        </p>
      </ModuleHeader>

      <SixQuestions
        problem={<>Given <TeX>{"s"}</TeX>, choose <TeX>{"\\hat e"}</TeX> with <TeX>{"H\\hat e=s"}</TeX> such that <TeX>{"L(e\\oplus\\hat e)=0"}</TeX>, quickly enough to keep up with the hardware.</>}
        equations={<>The MAP problem (5.2), min-sum messages (5.3–5.5), OSD (5.6) and memory BP (5.7). The router escalates when <TeX>{"\\sigma(a\\,g(\\phi)+b)\\ge\\tau"}</TeX>.</>}
        algorithm={<>BP passes messages on the Tanner graph. OSD finishes with Gaussian elimination. Relay-BP chains BP runs with randomized memory. QEC-Aegis runs a cheap relay-BP and escalates only the shots a trained model flags.</>}
        controls={<>Error patterns, priors, iteration count and memory γ on small codes (in your browser). Basis, p and seed for live Gross-code decodes by the production libraries.</>}
        demonstrates={<>Degeneracy defeats plain BP and post-processing repairs it. The production decoders report convergence, iterations, timing and the router&apos;s risk for each shot.</>}
        limitations={<>The production libraries do not expose per-iteration messages, so iteration-level views run on small illustrative codes. The Gross decodes are single shots with machine-dependent timing.</>}
      />

      <Section id="problem" kicker="5.1" title="Syndrome decoding as an inference problem">
        <Prose className="max-w-[54rem]">
          <p>
            Let column <TeX>{"j"}</TeX> of <TeX>{"H\\in\\mathbb F_2^{m\\times N}"}</TeX> be fault mechanism <TeX>{"j"}</TeX> of the detector error model, firing
            independently with prior <TeX>{"p_j"}</TeX>. <TeX>{"L\\in\\mathbb F_2^{k\\times N}"}</TeX> records which logical observables it flips. A shot
            produces a hidden <TeX>{"e"}</TeX> and observes only
          </p>
          <Eq n="5.1">{"s = H e \\pmod 2"}</Eq>
          <p>The most likely error is a weighted minimum-weight problem:</p>
          <Eq n="5.2">{"\\hat e = \\arg\\max_{He=s}\\prod_j p_j^{e_j}(1-p_j)^{1-e_j} = \\arg\\min_{He=s}\\ \\sum_j \\lambda_j e_j,\\qquad \\lambda_j = \\log\\frac{1-p_j}{p_j}"}</Eq>
          <p>
            Success does not require <TeX>{"\\hat e = e"}</TeX>, only <TeX>{"L(e\\oplus\\hat e)=0"}</TeX>. Errors that differ by a stabilizer are equivalent. This{" "}
            <strong>degeneracy</strong> is what separates quantum from classical decoding: the optimal decoder maximizes the probability of a logical class
            (a sum over many <TeX>{"e"}</TeX>), not of a single error. (5.2) is NP-hard in general. Every practical decoder approximates it.
          </p>
        </Prose>
      </Section>

      <Section id="bp" kicker="5.2" title="Belief propagation, and how it fails">
        <Prose className="mb-6 max-w-[54rem]">
          <p>
            BP treats <TeX>{"H"}</TeX> as a factor graph and passes log-likelihood messages between variables <TeX>{"v"}</TeX> (fault mechanisms) and checks{" "}
            <TeX>{"c"}</TeX> (detectors). In the min-sum form used by both production libraries:
          </p>
          <Eq n="5.3" label="check to variable: the syndrome bit sets the sign">{"\\mu_{c\\to v} = (-1)^{s_c}\\ \\alpha \\prod_{v'\\in N(c)\\setminus v}\\mathrm{sgn}\\,\\nu_{v'\\to c}\\ \\cdot \\min_{v'\\in N(c)\\setminus v}|\\nu_{v'\\to c}|"}</Eq>
          <Eq n="5.4" label="posterior, and the hard decision">{"\\Lambda_v = \\lambda_v + \\sum_{c\\in N(v)}\\mu_{c\\to v},\\qquad \\hat e_v = [\\Lambda_v < 0]"}</Eq>
          <Eq n="5.5" label="variable to check (extrinsic)">{"\\nu_{v\\to c} = \\Lambda_v - \\mu_{c\\to v}"}</Eq>
          <p>
            BP stops when <TeX>{"H\\hat e = s"}</TeX>. It is exact on trees. Quantum LDPC Tanner graphs have many short cycles, and degeneracy creates
            symmetric equally likely solutions whose messages never commit. The toric example below fails for exactly this reason.
          </p>
          <p>
            <strong>BP-OSD</strong> (ordered-statistics decoding) post-processes BP&apos;s soft output. Sort columns by <TeX>{"\\Lambda_v"}</TeX>, most likely flipped
            first. Take the first <TeX>{"\\mathrm{rank}\\,H"}</TeX> independent columns <TeX>{"S"}</TeX>, and solve
          </p>
          <Eq n="5.6">{"H_S\\,\\hat e_S = s,\\qquad \\hat e_{\\bar S} = 0\\qquad\\text{(OSD-0)}"}</Eq>
          <p>
            This always yields a valid correction. Higher orders also try flipping up to <TeX>{"w"}</TeX> of the least reliable bits outside <TeX>{"S"}</TeX>{" "}
            and keep the lightest. The kit runs 80 min-sum iterations, then OSD with combination sweep of order 10. Elimination costs about{" "}
            <TeX>{"O(N^3)"}</TeX>, which is the slow, heavy tail of BP-OSD.
          </p>
          <p>
            <strong>Relay-BP</strong> (Müller et al., arXiv:2506.01779) replaces elimination with more BP. Memory BP mixes each variable&apos;s prior with its last posterior:
          </p>
          <Eq n="5.7">{"\\tilde\\lambda_v^{(t)} = (1-\\gamma_v)\\,\\lambda_v + \\gamma_v\\,\\Lambda_v^{(t-1)}"}</Eq>
          <p>
            A first leg uses uniform <TeX>{"\\gamma_0 = 0.15"}</TeX> for 80 iterations. Each further leg (up to 300, 60 iterations each) starts from the previous
            posteriors with <TeX>{"\\gamma_v"}</TeX> drawn from <TeX>{"[-0.226,\\,0.622]"}</TeX>. Negative memory pushes a stuck variable away from its last value.
            Every converged leg is a candidate. The kit stops after 5 and returns the one of least weight (5.2).
          </p>
        </Prose>
        <BPIllustration />
      </Section>

      <Section id="aegis" kicker="5.3" title="QEC-Aegis: spend effort only where it is needed">
        <Prose className="mb-6 max-w-[54rem]">
          <p>
            Most shots are easy: a relay-BP that stops at its first solution is right on almost all of them, at a fraction of the time. QEC-Aegis estimates
            per shot the probability that this cheap answer is logically wrong, from features <TeX>{"\\phi"}</TeX> available at decode time. These include
            syndrome weight and its temporal profile, whether tier 1 converged, its iteration count, the solution weight, posterior margins and a cheap
            BP+OSD-0 second opinion. None uses the true error. A gradient-boosted classifier <TeX>{"g"}</TeX> is calibrated by Platt scaling, so the score is
            a probability:
          </p>
          <Eq n="5.8">{"r(\\phi) = \\sigma\\big(a\\,g(\\phi) + b\\big),\\qquad \\text{escalate to tier 2} \\iff r(\\phi) \\ge \\tau\\ \\ \\text{or tier 1 did not converge}"}</Eq>
          <p>
            When it escalates, both answers are kept and the converged, lighter one wins. The threshold <TeX>{"\\tau"}</TeX> was chosen on validation shots, never on
            the frozen test shots. The router currently deployed on the backend:
          </p>
        </Prose>
        <RouterCard />
        <div className="mt-6"><LiveDecode /></div>
        <Note>
          What is real here: every row of the table and every risk value comes from the Python backend decoding a fresh Stim sample with the production
          libraries (ldpc 2.4.1, relay-bp 0.2.2). One shot shows the mechanism, not performance. Failure rates need thousands of shots and are in Module 7.
        </Note>
      </Section>

      <Section id="evidence" kicker="5.4" title="The evidence behind the architecture">
        <Prose className="mb-6 max-w-[54rem]">
          <p>
            The design was settled by measurement on validation shots (seed 3), never on the frozen test shots. The studies below are read from the reports
            that <span className="num">aegis.study</span>, <span className="num">aegis.train</span> and <span className="num">aegis.predecoder</span> wrote. Each figure
            states its assumptions and limits.
          </p>
        </Prose>
        <PairedOutcomes />
        <RoutingRules />
        <RouterSelection />
        <PredecoderStudy />
        <ArchitectureRationale />
      </Section>
    </article>
  );
}
