import type { Metadata } from "next";
import Link from "next/link";
import { Eq, TeX } from "@/components/TeX";
import { ModuleHeader, Note, Prose, Section, SixQuestions, Split } from "@/components/Layout";
import { RepetitionCurve, SyndromeBench } from "./Instruments";

export const metadata: Metadata = { title: "Error Correction from First Principles" };

export default function ErrorCorrection() {
  return (
    <article className="max-w-[1180px]">
      <ModuleHeader n={2} sources={["theory", "live"]}>
        <p>
          Copying protects classical bits, but quantum states cannot be copied and measuring them disturbs them. This module derives the way out:
          spread one logical qubit over many physical ones, measure only <em>parities</em> that commute with the stored information, and infer the error
          from those parities. Then it checks the derivation against a real circuit simulation.
        </p>
      </ModuleHeader>

      <SixQuestions
        problem={<>Protect one bit of quantum information against independent errors when the state can neither be copied nor read.</>}
        equations={<><TeX>{"P_L=\\sum_{k>d/2}\\binom dk p^k(1-p)^{d-k}"}</TeX>, the stabilizer conditions <TeX>{"S|\\bar\\psi\\rangle=|\\bar\\psi\\rangle"}</TeX>, and the syndrome <TeX>{"s=He\\bmod 2"}</TeX>.</>}
        algorithm={<>Measure the <TeX>{"d-1"}</TeX> neighbouring parities. Exactly two error patterns explain the syndrome, and the decoder applies the lighter one.</>}
        controls={<>Distance, bit-flip or phase-flip code, any pattern of X, Y and Z errors (exact bench). Then rounds, injection time, shots and seed for a circuit run on Aer.</>}
        demonstrates={<>Syndromes locate errors without measuring the data. Distance <TeX>{"d"}</TeX> corrects <TeX>{"\\lfloor (d-1)/2 \\rfloor"}</TeX> errors. A repetition code is blind to one Pauli type, so it is not a quantum memory.</>}
        limitations={<>The exact bench assumes perfect parity measurements (code capacity). The circuit run injects a single error with no other noise: it verifies syndrome extraction, not a logical error rate.</>}
      />

      <Section id="classical" kicker="2.1" title="Redundancy, and where it fails">
        <Split ratio="even"
          left={
            <Prose>
              <p>
                Encode a bit as <TeX>{"0\\mapsto 0\\cdots0"}</TeX>, <TeX>{"1\\mapsto 1\\cdots1"}</TeX> on <TeX>{"d"}</TeX> (odd) bits. Each bit flips
                independently with probability <TeX>{"p"}</TeX>. Majority vote fails when more than half flip:
              </p>
              <Eq n="2.1">{"P_L(d=3) = 3p^2(1-p) + p^3 = 3p^2 - 2p^3"}</Eq>
              <Eq n="2.2">{"P_L(d) = \\sum_{k=t+1}^{d}\\binom{d}{k}p^k(1-p)^{d-k} \\;\\approx\\; \\binom{d}{t+1}p^{\\,t+1},\\qquad t = \\tfrac{d-1}{2}"}</Eq>
              <p>
                Encoding helps exactly when <TeX>{"P_L(d) < p"}</TeX>. Here that holds for every <TeX>{"p<\\tfrac12"}</TeX>, and the suppression
                improves exponentially in <TeX>{"d"}</TeX>. Every later code shows the same structure: a threshold, and below it a logical error rate
                that falls as a power of <TeX>{"p"}</TeX> that grows with distance.
              </p>
              <p>
                Majority voting reads every bit. Doing that to <TeX>{"\\alpha|0\\rangle+\\beta|1\\rangle"}</TeX> would collapse it, and
                no-cloning forbids making the copies in the first place. The quantum version must store <TeX>{"\\alpha|0\\cdots0\\rangle + \\beta|1\\cdots1\\rangle"}</TeX>{" "}
                (entangled, not copied) and must vote without looking.
              </p>
            </Prose>
          }
          right={<RepetitionCurve />}
        />
      </Section>

      <Section id="stabilizers" kicker="2.2" title="Stabilizers: measuring parities, not data">
        <Prose className="mb-6 max-w-[52rem]">
          <p>
            The three-qubit code space is <TeX>{"\\mathcal C=\\mathrm{span}\\{|000\\rangle,|111\\rangle\\}"}</TeX>. It is the joint +1 eigenspace of two
            commuting operators, the <strong>stabilizer generators</strong>:
          </p>
          <Eq n="2.3">{"S_1 = Z_1Z_2,\\quad S_2 = Z_2Z_3,\\qquad S_j|\\bar\\psi\\rangle = +|\\bar\\psi\\rangle\\ \\ \\forall\\,|\\bar\\psi\\rangle\\in\\mathcal C"}</Eq>
          <p>
            <TeX>{"Z_1Z_2"}</TeX> asks whether qubits 1 and 2 agree. Both <TeX>{"|000\\rangle"}</TeX> and <TeX>{"|111\\rangle"}</TeX> answer yes, so the
            measurement cannot distinguish them and does not disturb <TeX>{"\\alpha,\\beta"}</TeX>. An ancilla qubit performs it: CNOTs from qubits 1 and 2
            into an ancilla prepared in <TeX>{"|0\\rangle"}</TeX>, then measure the ancilla. For an error <TeX>{"E"}</TeX>,
          </p>
          <Eq n="2.4">{"S_j\\,E|\\bar\\psi\\rangle = (-1)^{s_j}\\,E\\,S_j|\\bar\\psi\\rangle = (-1)^{s_j}\\,E|\\bar\\psi\\rangle,\\qquad s_j = \\begin{cases}0 & [S_j,E]=0\\\\ 1 & \\{S_j,E\\}=0\\end{cases}"}</Eq>
          <p>
            For X-type errors <TeX>{"E = X^{e_1}\\otimes\\cdots\\otimes X^{e_d}"}</TeX>, anticommutation with <TeX>{"Z_iZ_{i+1}"}</TeX> is the parity{" "}
            <TeX>{"e_i\\oplus e_{i+1}"}</TeX>. Collecting all checks gives the linear system that every decoder in this lab solves:
          </p>
          <Eq n="2.5" label="H: one row per check, one column per possible error; s: the measured syndrome.">{"s = H\\,e \\pmod 2,\\qquad H = \\begin{pmatrix}1&1&0&\\cdots\\\\0&1&1&\\cdots\\\\&&\\ddots&\\end{pmatrix}\\in\\mathbb F_2^{(d-1)\\times d}"}</Eq>
          <p>
            <strong>Logical operators</strong> commute with every stabilizer but are not themselves stabilizers. Here they are{" "}
            <TeX>{"\\bar X = X_1X_2\\cdots X_d"}</TeX> (weight <TeX>{"d"}</TeX>) and <TeX>{"\\bar Z = Z_1"}</TeX> (weight 1). The <strong>distance</strong>{" "}
            is the minimum weight of an undetectable error that acts nontrivially: <TeX>{"d"}</TeX> against bit flips, but <strong>1</strong> against phase
            flips. The bench below makes both facts tangible. Swapping <TeX>{"Z\\leftrightarrow X"}</TeX> gives the phase-flip code, with the opposite blindness.
          </p>
        </Prose>
        <SyndromeBench />
        <Note>
          What the two panels establish: the exact parity algebra above predicts which detectors fire, and an independent circuit simulation with ancilla
          qubits, CNOTs and mid-circuit measurement on Qiskit Aer reproduces it. Protecting against X and Z errors at once needs checks of both types that
          commute with each other. The smallest family that scales is the surface code in <Link className="underline" href="/surface-code">Module 3</Link>.
        </Note>
      </Section>

      <Section id="physical-logical" kicker="2.3" title="Physical versus logical error">
        <Prose className="max-w-[52rem]">
          <p>
            With noisy measurements a single round of checks cannot tell a data error from a measurement error, so checks are repeated. A{" "}
            <strong>detector</strong> is the XOR of a check's outcome with its previous outcome,{" "}
            <TeX>{"D_{j,t} = m_{j,t}\\oplus m_{j,t-1}"}</TeX>. It fires at the space-time location where something changed. The decoding problem keeps the
            form of (2.5), with <TeX>{"H"}</TeX> now mapping every possible circuit fault to the detectors it flips. That matrix is the{" "}
            <strong>detector error model</strong>. The logical error rate is then a property of the circuit, the noise strength and the decoder together:
          </p>
          <Eq n="2.6">{"P_L(p, d) \\;\\sim\\; A\\,\\big(p/p_{\\mathrm{th}}\\big)^{\\lceil d/2\\rceil}\\qquad (p < p_{\\mathrm{th}})"}</Eq>
          <p>
            Modules 3 and 4 build these matrices for real circuits. Module 7 measures <TeX>{"P_L"}</TeX> for the Gross code with confidence intervals.
          </p>
        </Prose>
      </Section>
    </article>
  );
}
