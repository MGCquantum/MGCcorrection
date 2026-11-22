import type { Metadata } from "next";
import Link from "next/link";
import { Eq, TeX } from "@/components/TeX";
import { Figure, ModuleHeader, Note, Prose, Section, SixQuestions } from "@/components/Layout";
import { Provenance } from "@/components/Provenance";
import { StoredStudy, SurfaceLab } from "./Instruments";

export const metadata: Metadata = { title: "Surface Codes" };

export default function SurfaceCode() {
  return (
    <article className="max-w-[1180px]">
      <ModuleHeader n={3} sources={["live", "stored"]}>
        <p>
          The repetition code is blind to one error type. The surface code fixes this by placing two families of commuting checks on a 2-D lattice, one
          for each Pauli type. It is the reference point for every newer code. This module uses the validated distance-3 and distance-5 implementations
          of the MidQwest simulation backend: Stim circuits, run on Qiskit Aer, decoded by PyMatching.
        </p>
      </ModuleHeader>

      <SixQuestions
        problem={<>Protect one logical qubit against X, Y and Z errors and against faulty measurements, using only nearest-neighbour checks.</>}
        equations={<>Stabilizers <TeX>{"A_v=\\prod X"}</TeX> and <TeX>{"B_f=\\prod Z"}</TeX> of weight 4. Detectors <TeX>{"D_{j,t}=m_{j,t}\\oplus m_{j,t-1}"}</TeX>. MWPM minimizes <TeX>{"\\sum_{e}w_e"}</TeX> with <TeX>{"w_e=\\log\\frac{1-p_e}{p_e}"}</TeX>.</>}
        algorithm={<>Repeat syndrome extraction for <TeX>{"d"}</TeX> rounds, turn measurements into detection events, and pair events on the space-time graph with minimum total weight (PyMatching, sparse blossom).</>}
        controls={<>Distance 3 or 5, memory basis, error type, which data qubit, when the error is inserted, shots and seed. You can also click detectors to build any syndrome.</>}
        demonstrates={<>A data error lights the checks around it at the moment it happened. The decoder corrects any single error. Below threshold d = 5 beats d = 3; at p = 1% it does not.</>}
        limitations={<>Rotated planar memory only, with no lattice surgery or logical gates. Injection runs add one error to an otherwise noiseless circuit. The circuit-noise study is stored, at three values of p.</>}
      />

      <Section id="stabilizers" kicker="3.1" title="Two commuting families of checks">
        <Prose className="max-w-[54rem]">
          <p>
            Place <TeX>{"d^2"}</TeX> data qubits on a square grid. Each face carries either an X-type check <TeX>{"X^{\\otimes 4}"}</TeX> or a Z-type check{" "}
            <TeX>{"Z^{\\otimes 4}"}</TeX> on its corners, in a checkerboard. Along the boundary the checks have weight 2. An X check and a Z check share either
            zero or two qubits, so they commute:
          </p>
          <Eq n="3.1">{"[A_v, B_f] = 0 \\iff |\\mathrm{supp}(A_v)\\cap \\mathrm{supp}(B_f)| \\equiv 0 \\pmod 2"}</Eq>
          <p>
            There are <TeX>{"d^2-1"}</TeX> independent checks on <TeX>{"d^2"}</TeX> qubits, so <TeX>{"k = d^2-(d^2-1) = 1"}</TeX> logical qubit. The logical{" "}
            <TeX>{"\\bar Z"}</TeX> is a string of Z running between the two Z-type boundaries, and <TeX>{"\\bar X"}</TeX> a string of X in the other direction.
            Each has minimum weight <TeX>{"d"}</TeX>, so the code is <TeX>{"[[d^2, 1, d]]"}</TeX>. A Y error anticommutes with both families and lights both
            colours. An error on a corner qubit fires only the one or two checks it touches.
          </p>
        </Prose>
      </Section>

      <Section id="lab" kicker="3.2" title="Inject an error, watch it in space-time">
        <SurfaceLab />
      </Section>

      <Section id="matching" kicker="3.3" title="Why matching decodes the surface code">
        <Prose className="max-w-[54rem]">
          <p>
            With the error model split into its X and Z parts, every elementary fault flips at most two detectors of one type. A data error flips the two
            checks on either side of it in the same round. A measurement error flips the same check in two consecutive rounds. A fault at the edge flips one
            detector. A set of faults therefore produces detection events exactly at the <em>endpoints</em> of the chains it forms, and decoding becomes:
          </p>
          <Eq n="3.2">{"\\hat E = \\arg\\min_{E:\\ \\partial E = S}\\ \\sum_{e\\in E} w_e,\\qquad w_e = \\log\\frac{1-p_e}{p_e}"}</Eq>
          <p>
            Here <TeX>{"\\partial E"}</TeX> is the set of endpoints. Equation (3.2) is a minimum-weight perfect matching on the detection events, with the boundary
            allowed to absorb any of them. It is the maximum-likelihood <em>error</em> (not the most likely logical class), and it is solvable in polynomial time.
            The decoder fails when <TeX>{"E\\oplus\\hat E"}</TeX> wraps from one boundary to the other: a logical operator. That needs about{" "}
            <TeX>{"\\lceil d/2\\rceil"}</TeX> faults, hence equation (2.6).
          </p>
        </Prose>
        <Note>
          The graph below is PyMatching&apos;s own decoding graph, built from the circuit&apos;s detector error model at p = 0.001. It is not a drawing of the lattice. The
          matching shown is the decoder&apos;s output for exactly the detection events listed. For the Gross code in <Link className="underline" href="/gross-code">Module 4</Link>{" "}
          a single fault can flip many detectors, the graph becomes a hypergraph, and matching no longer applies.
        </Note>
      </Section>

      <Section id="threshold" kicker="3.4" title="Distance helps only below threshold">
        <Figure n="3.1" title="Logical error rate of the d = 3 and d = 5 memories under circuit-level depolarizing noise" testid="fig-3-1"
          source={<Provenance source="stored" detail="2,000,000 shots per point" />}
          assumptions={<>Z-basis memory, rounds = d, noise of strength p after every gate and reset, before every measurement, and on every data qubit before each round. Decoded by PyMatching with weights from the same model.</>}
          sample={<>2,000,000 shots for each code, distance and p (three values of p), sampled with Stim from a fixed seed.</>}
          uncertainty={<>Exact Clopper–Pearson 95% intervals, drawn as bars. Most are narrower than the markers. The study calls d = 5 lower or higher only when the intervals are disjoint.</>}
          limitations={<>Three values of p do not locate the threshold precisely: it lies between 0.003 and 0.01 for this circuit. The repetition curves count bit-flip failures only and are not comparable as quantum memories.</>}>
          <StoredStudy />
        </Figure>
      </Section>
    </article>
  );
}
