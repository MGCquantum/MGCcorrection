import type { Metadata } from "next";
import Link from "next/link";
import { Eq, TeX } from "@/components/TeX";
import { ModuleHeader, Note, Prose, Section, SixQuestions, Split } from "@/components/Layout";
import { BellLab, NoiseLab, QubitLab } from "./Instruments";

export const metadata: Metadata = { title: "Quantum Foundations" };

export default function Foundations() {
  return (
    <article className="max-w-[1180px]">
      <ModuleHeader n={1} sources={["theory", "illustration"]}>
        <p>
          Before correcting quantum errors we need to say exactly what a quantum state is, what an error does to it, and what a measurement can
          and cannot reveal. Everything on this page is closed-form linear algebra on <TeX>{"\\mathbb C^2"}</TeX> and <TeX>{"\\mathbb C^4"}</TeX>,
          evaluated in your browser.
        </p>
      </ModuleHeader>

      <SixQuestions
        problem={<>How a qubit stores information, how Pauli errors change it, and why a measurement can detect an error without destroying the state.</>}
        equations={<><TeX>{"|\\psi\\rangle=\\cos\\frac\\theta2|0\\rangle+e^{i\\varphi}\\sin\\frac\\theta2|1\\rangle"}</TeX>, the Born rule <TeX>{"P(\\pm)=\\tfrac12(1\\pm r_a)"}</TeX>, and channels <TeX>{"\\vec r\\mapsto M\\vec r+\\vec t"}</TeX>.</>}
        algorithm={<>Gates are 2×2 unitaries applied to the amplitude vector. Bloch vectors come from <TeX>{"r_i=\\langle\\psi|\\sigma_i|\\psi\\rangle"}</TeX>. Measurements are sampled with a seeded generator.</>}
        controls={<>The angles θ and φ, gate sequences, the measurement basis and shot count, Pauli errors on a Bell pair, and the channel type, strength and number of applications.</>}
        demonstrates={<>A Pauli error is a rotation by π, so it is discrete. Two-qubit parities such as <TeX>{"Z\\otimes Z"}</TeX> flag an error while revealing nothing about the stored state.</>}
        limitations={<>One and two qubits only, with ideal gates. Real noise is not exactly Pauli: amplitude damping and coherent errors are only approximated by Pauli channels in the circuit simulations later on.</>}
      />

      <Section id="qubit" kicker="1.1" title="A qubit is a point on the Bloch sphere">
        <Split ratio="stack"
          left={
            <Prose>
              <p>
                A pure state of one qubit is a unit vector in <TeX>{"\\mathbb C^2"}</TeX>, defined up to a global phase. Two real numbers fix it:
              </p>
              <Eq n="1.1">{"|\\psi\\rangle = \\cos\\tfrac{\\theta}{2}\\,|0\\rangle + e^{i\\varphi}\\sin\\tfrac{\\theta}{2}\\,|1\\rangle"}</Eq>
              <p>
                The three Pauli operators are the observables along the three axes, and the state's expectation values form its Bloch vector:
              </p>
              <Eq n="1.2">{"X=\\begin{pmatrix}0&1\\\\1&0\\end{pmatrix},\\quad Y=\\begin{pmatrix}0&-i\\\\i&0\\end{pmatrix},\\quad Z=\\begin{pmatrix}1&0\\\\0&-1\\end{pmatrix}"}</Eq>
              <Eq n="1.3">{"\\vec r=\\big(\\langle X\\rangle,\\langle Y\\rangle,\\langle Z\\rangle\\big)=(\\sin\\theta\\cos\\varphi,\\ \\sin\\theta\\sin\\varphi,\\ \\cos\\theta)"}</Eq>
              <p>
                Each Pauli is a rotation by π about its own axis. <TeX>{"X"}</TeX> maps <TeX>{"(x,y,z)\\mapsto(x,-y,-z)"}</TeX>: it is a <em>bit flip</em>.{" "}
                <TeX>{"Z"}</TeX> maps <TeX>{"(x,y,z)\\mapsto(-x,-y,z)"}</TeX>: it is a <em>phase flip</em>, invisible in the computational basis.{" "}
                <TeX>{"Y = iXZ"}</TeX> does both. The Paulis anticommute pairwise, <TeX>{"XZ=-ZX"}</TeX>. This one algebraic fact is what makes
                syndromes work in Module 2.
              </p>
              <p>
                <strong>Measurement</strong> in the eigenbasis of a Pauli <TeX>{"P_a"}</TeX> gives <TeX>{"\\pm1"}</TeX> with probabilities
              </p>
              <Eq n="1.4">{"P(\\pm 1) = \\langle\\psi|\\tfrac{1}{2}(I \\pm P_a)|\\psi\\rangle = \\tfrac12\\,(1 \\pm r_a)"}</Eq>
              <p>and leaves the qubit in the eigenstate it reported. One shot gives one bit. A probability is estimated from many shots, with standard error <TeX>{"\\sqrt{P(1-P)/N}"}</TeX>.</p>
            </Prose>
          }
          right={<QubitLab />}
        />
      </Section>

      <Section id="entanglement" kicker="1.2" title="Entanglement: information stored only in parities">
        <Split ratio="stack"
          left={
            <Prose>
              <p>Two qubits live in <TeX>{"\\mathbb C^2\\otimes\\mathbb C^2"}</TeX>. The Bell state</p>
              <Eq n="1.5">{"|\\Phi^+\\rangle = \\tfrac{1}{\\sqrt 2}\\big(|00\\rangle + |11\\rangle\\big)"}</Eq>
              <p>
                is the unique state (up to phase) with <TeX>{"X\\!\\otimes\\! X = +1"}</TeX> and <TeX>{"Z\\!\\otimes\\! Z = +1"}</TeX>. These two
                operators commute, because each anticommuting factor appears twice. They <em>stabilize</em> the state:
              </p>
              <Eq n="1.6">{"(X\\otimes X)\\,|\\Phi^+\\rangle = |\\Phi^+\\rangle,\\qquad (Z\\otimes Z)\\,|\\Phi^+\\rangle = |\\Phi^+\\rangle"}</Eq>
              <p>
                Apply an error <TeX>{"E"}</TeX> to qubit A. If <TeX>{"E"}</TeX> anticommutes with a stabilizer <TeX>{"S"}</TeX>, then{" "}
                <TeX>{"S E|\\Phi^+\\rangle = -E S|\\Phi^+\\rangle = -E|\\Phi^+\\rangle"}</TeX>, so measuring <TeX>{"S"}</TeX> returns −1:
              </p>
              <Eq n="1.7">{"X_A:\\ (\\langle XX\\rangle,\\langle ZZ\\rangle) = (+1,-1),\\quad Z_A:\\ (-1,+1),\\quad Y_A:\\ (-1,-1)"}</Eq>
              <p>
                The pair of signs is a <strong>syndrome</strong>. It identifies the error type, but not which qubit it hit: <TeX>{"X_A"}</TeX> and{" "}
                <TeX>{"X_B"}</TeX> give the same signs. With two qubits, errors can be detected but not located. Locating them takes more qubits and more
                stabilizers, which is exactly what a code provides.
              </p>
            </Prose>
          }
          right={<BellLab />}
        />
      </Section>

      <Section id="noise" kicker="1.3" title="Physical noise">
        <Split ratio="stack"
          left={
            <Prose>
              <p>
                Noise is a completely positive, trace-preserving map <TeX>{"\\mathcal E(\\rho)=\\sum_k K_k\\rho K_k^\\dagger"}</TeX>. On one qubit,
                with <TeX>{"\\rho = \\tfrac12(I + \\vec r\\cdot\\vec\\sigma)"}</TeX>, every such map is affine on the Bloch vector:
              </p>
              <Eq n="1.8">{"\\vec r \\;\\mapsto\\; M\\vec r + \\vec t,\\qquad \\|M\\vec r+\\vec t\\| \\le 1"}</Eq>
              <p>
                Pure states sit on the surface and noise pulls them inward. The <strong>Pauli channel</strong>, which applies{" "}
                <TeX>{"X, Y, Z"}</TeX> with probabilities <TeX>{"p_x, p_y, p_z"}</TeX>, is the model every simulator in this lab uses. Stim samples it
                exactly and efficiently because Pauli errors on stabilizer circuits can be tracked classically (Gottesman–Knill).
              </p>
              <p>
                The circuits in Modules 3 to 7 use <strong>circuit-level depolarizing noise</strong> of strength <TeX>{"p"}</TeX>. Gates and idle
                steps are followed by a depolarizing error of total probability <TeX>{"p"}</TeX>, resets prepare the wrong state with probability{" "}
                <TeX>{"p"}</TeX>, and measurement results flip with probability <TeX>{"p"}</TeX>. The surface-code and Gross-code circuit families
                place these channels slightly differently, and each module states its model. Hardware T₁ and T₂ (Module 8 shows archived values)
                set which values of <TeX>{"p"}</TeX> are realistic.
              </p>
              <Note>
                Error correction does not undo the contraction for an arbitrary state. It keeps a <em>logical</em> state on the surface by measuring
                parities and correcting the discrete Pauli errors those parities reveal. Continuous errors are digitized by the syndrome measurement
                itself. Continue to <Link className="underline" href="/error-correction">Module 2</Link>.
              </Note>
            </Prose>
          }
          right={<NoiseLab />}
        />
      </Section>
    </article>
  );
}
