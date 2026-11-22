import type { Metadata } from "next";
import { Eq, TeX } from "@/components/TeX";
import { ModuleHeader, Note, Prose, Section, SixQuestions } from "@/components/Layout";
import { DemPanel, FactsPanel, MatricesPanel, SchedulePanel, TannerPanel } from "./Instruments";

export const metadata: Metadata = { title: "The Gross [[144,12,12]] Code" };

export default function GrossCode() {
  return (
    <article className="max-w-[1180px]">
      <ModuleHeader n={4} sources={["live", "reference"]}>
        <p>
          The surface code stores one logical qubit per patch. The Gross code stores <strong>twelve</strong> in 144 data qubits at distance 12. It belongs
          to the bivariate bicycle family of quantum LDPC codes introduced by Bravyi et al. (Nature 627, 778, 2024). Its checks still have weight 6, but its
          connectivity is not planar. Every matrix, rank, logical operator and graph on this page is computed from the starter kit&apos;s own{" "}
          <span className="num text-[0.92em]">make_circuit.py</span> by the QEC-Aegis backend.
        </p>
      </ModuleHeader>

      <SixQuestions
        problem={<>Encode many logical qubits with few physical qubits while keeping checks of bounded weight and a large distance.</>}
        equations={<><TeX>{"H_X=[A|B]"}</TeX>, <TeX>{"H_Z=[B^{\\mathsf T}|A^{\\mathsf T}]"}</TeX> with <TeX>{"A=x^3+y+y^2"}</TeX> and <TeX>{"B=y^3+x+x^2"}</TeX>. Then <TeX>{"k=n-\\mathrm{rk}H_X-\\mathrm{rk}H_Z"}</TeX>.</>}
        algorithm={<>Commuting shift matrices on a 12 × 6 torus build two circulant blocks. A depth-8 CNOT schedule measures all 144 checks every cycle, and Stim turns 12 noisy cycles into a detector error model.</>}
        controls={<>Select any check or qubit on the real Tanner graph, overlay a logical operator or a sampled syndrome round, switch between H_X and H_Z, and between the X and Z memory experiments.</>}
        demonstrates={<>k = 12 and <TeX>{"H_XH_Z^{\\mathsf T}=0"}</TeX>, verified live. Each check touches 6 qubits, 4 of them non-locally. Circuit faults flip up to 6 detectors, which rules out matching decoders.</>}
        limitations={<>The distance 12 is quoted from the paper, not recomputed (finding it is a hard minimum-weight search). The logical operators shown are a valid basis, not minimum-weight representatives. Memory experiments only.</>}
      />

      <Section id="construction" kicker="4.1" title="The bivariate bicycle construction">
        <Prose className="max-w-[54rem]">
          <p>
            Let <TeX>{"S_\\ell"}</TeX> be the <TeX>{"\\ell\\times\\ell"}</TeX> cyclic shift. On the torus <TeX>{"\\mathbb Z_\\ell\\times\\mathbb Z_m"}</TeX> define two
            commuting permutation matrices of size <TeX>{"\\ell m"}</TeX>:
          </p>
          <Eq n="4.1">{"x = S_\\ell \\otimes I_m,\\qquad y = I_\\ell \\otimes S_m,\\qquad xy = yx,\\qquad x^\\ell = y^m = I"}</Eq>
          <p>For the Gross code, <TeX>{"\\ell = 12"}</TeX> and <TeX>{"m = 6"}</TeX>. Pick two trinomials in these commuting variables,</p>
          <Eq n="4.2">{"A = x^3 + y + y^2,\\qquad B = y^3 + x + x^2 \\qquad (\\text{over } \\mathbb F_2)"}</Eq>
          <p>and define the two check matrices on <TeX>{"n = 2\\ell m = 144"}</TeX> data qubits, split into a left and a right block:</p>
          <Eq n="4.3">{"H_X = \\big[\\,A \\;\\big|\\; B\\,\\big],\\qquad H_Z = \\big[\\,B^{\\mathsf T} \\;\\big|\\; A^{\\mathsf T}\\,\\big]"}</Eq>
          <p>
            The X and Z checks must commute. <TeX>{"A"}</TeX> and <TeX>{"B"}</TeX> are polynomials in commuting matrices, so they commute, and therefore
          </p>
          <Eq n="4.4">{"H_X H_Z^{\\mathsf T} = A B + B A = 2AB = 0 \\pmod 2"}</Eq>
          <p>
            Each row of <TeX>{"A"}</TeX> and of <TeX>{"B"}</TeX> has three ones, so every check has weight 6 and every qubit lies in 3 X and 3 Z checks. The
            number of logical qubits is <TeX>{"k = n - \\mathrm{rank}\\,H_X - \\mathrm{rank}\\,H_Z"}</TeX>. The ranks are not full: 6 of the 72 X checks are
            products of others. This redundancy is what leaves room for 12 logical qubits.
          </p>
        </Prose>
        <div className="mt-6"><FactsPanel /></div>
        <Note>
          The comparison that motivates the code: 12 logical qubits in separate rotated surface-code patches at distance 12 need{" "}
          <TeX>{"12 \\times (12^2 + 12^2 - 1) = 3{,}444"}</TeX> physical qubits. The Gross code uses 144 data and 144 check qubits, 288 in all, about 12 times
          fewer. The price is long-range connectivity and a harder decoding problem.
        </Note>
      </Section>

      <Section id="tanner" kicker="4.2" title="Its real connectivity">
        <Prose className="mb-5 max-w-[54rem]">
          <p>
            The Tanner graph has a node for every qubit and check and an edge wherever <TeX>{"H"}</TeX> has a one: 288 nodes and 144 × 6 = 864 edges. Bravyi et al.
            draw it on the torus itself. Each cell <TeX>{"(i,j)"}</TeX> holds one X check, one left data qubit, one right data qubit and one Z check, and a
            monomial <TeX>{"x^a y^b"}</TeX> connects cells <TeX>{"(a, b)"}</TeX> apart. This is not a square surface-code lattice. The torus has no
            boundary, and four of the six edges of every check skip over intermediate cells. Click any node to see its neighbourhood.
          </p>
        </Prose>
        <TannerPanel />
      </Section>

      <Section id="matrices" kicker="4.3" title="Parity-check matrices">
        <MatricesPanel />
      </Section>

      <Section id="circuit" kicker="4.4" title="The 12-cycle memory experiment">
        <Prose className="mb-5 max-w-[54rem]">
          <p>
            The experiment follows the relay-BP paper (arXiv:2506.01779). Data qubits start in <TeX>{"|0\\rangle^{\\otimes144}"}</TeX> (Z memory) or{" "}
            <TeX>{"|+\\rangle^{\\otimes144}"}</TeX> (X memory). Twelve noisy syndrome cycles follow, then a noiseless readout of every data qubit. A detector
            compares each check with its previous value:
          </p>
          <Eq n="4.5">{"D_{j,1}=m_{j,1}\\ \\text{(memory-basis checks only)},\\qquad D_{j,t}=m_{j,t}\\oplus m_{j,t-1},\\qquad D_{j,\\mathrm{final}}=\\Big(\\bigoplus_{q\\in\\mathrm{supp}\\,h_j}r_q\\Big)\\oplus m_{j,12}"}</Eq>
          <p>
            With 72 checks per type that is 72 + 11 × 144 + 72 = 1,728 detectors. A decoder for the X memory uses the 13 × 72 = 936 detectors on X checks. The
            12 observables are the X logical operators evaluated on the final readout. Every gate, idle step, reset and measurement carries noise of strength{" "}
            <TeX>{"p"}</TeX>.
          </p>
        </Prose>
        <SchedulePanel />
        <div className="mt-6"><DemPanel /></div>
      </Section>
    </article>
  );
}
