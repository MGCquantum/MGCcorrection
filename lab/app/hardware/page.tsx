import type { Metadata } from "next";
import { TeX } from "@/components/TeX";
import { ModuleHeader, Prose, Section, SixQuestions } from "@/components/Layout";
import { HardwareRecord } from "./Instruments";
import { LiveConnection } from "./LiveConnection";

export const metadata: Metadata = { title: "IBM Quantum: Live Status and Archived Evidence" };

export default function Hardware() {
  return (
    <article className="max-w-[1180px]">
      <ModuleHeader n={8} sources={["account", "hardware"]}>
        <p>
          Everything else in this laboratory is mathematics or simulation. This page is the exception, in two separate parts. First, the current state of the
          IBM Quantum account: whether it authenticates and which real QPUs it can reach, from a read-only check. Second, one job that ran on a real
          superconducting processor, archived with its raw per-shot measurements, submitted circuits and calibration, and sealed with SHA-256 checksums. The
          page reads a status snapshot and the archive; it cannot submit anything.
        </p>
      </ModuleHeader>

      <SixQuestions
        problem={<>Does the full pipeline (Stim circuit → Qiskit → hardware → detection events → PyMatching) work on a real device, and is the stored evidence intact?</>}
        equations={<>The same detector definition <TeX>{"D_{j,t}=m_{j,t}\\oplus m_{j,t-1}"}</TeX> and the same decoder as Module 2. Clopper–Pearson intervals on 1,000 shots.</>}
        algorithm={<>The backend recomputes each file&apos;s SHA-256, compares it with SHA256SUMS, and re-decodes measurements.npz with weights derived from the archived calibration.</>}
        controls={<>Nothing that touches hardware. You inspect a fixed historical record.</>}
        demonstrates={<>Mid-circuit measurement, reset and feed-forward work on ibm_kingston. Detection events are sparse (about 2.6% per detector) and the decoded result is consistent with a low logical error rate.</>}
        limitations={<>One run of a bit-flip-only code at distance 3. The raw (1/1000) and decoded (0/1000) intervals overlap, so this does not show that decoding helped.</>}
      />

      <Section id="live" kicker="8.1" title="Current IBM Quantum account and devices">
        <Prose className="mb-4 max-w-[54rem]">
          <p>
            Separate from the historical record below. This is the state of the account now: whether it authenticates, which real QPUs it can use, and whether
            they are online. It is read-only metadata. Hardware execution stays disabled; a working connection does not mean anything new was run.
          </p>
        </Prose>
        <LiveConnection />
      </Section>

      <Section id="record" kicker="8.2" title="Historical evidence: the archived ibm_kingston run"><HardwareRecord /></Section>

      <Section id="reading" kicker="8.3" title="How to read this evidence">
        <Prose className="max-w-[54rem]">
          <p>
            The distance-3 repetition code fits IBM&apos;s heavy-hex lattice as a five-qubit chain with no SWAPs, which makes it a clean first hardware test.
            The surface code needs degree-4 connectivity. Heavy-hex offers at most degree 3, so compiling it costs about 3.4× more two-qubit gates (MidQwest
            validation study). That is why it was not the first hardware experiment. The Gross code needs the long-range couplers of Module 4, which this
            device does not have.
          </p>
          <p>
            What the run establishes: the circuit translation verified in simulation (Module 6, experiment C) executes on hardware, and the measured detection
            events can be decoded. What it does not establish: a logical error rate, a threshold, or any benefit of decoding. Those need many more shots,
            several distances, and a code that protects against phase errors as well.
          </p>
        </Prose>
      </Section>
    </article>
  );
}
