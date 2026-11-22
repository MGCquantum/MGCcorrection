export type ModuleInfo = { n: number; slug: string; title: string; short: string; blurb: string };

export const MODULES: ModuleInfo[] = [
  { n: 1, slug: "foundations", title: "Quantum Foundations", short: "Foundations",
    blurb: "Qubit states, Pauli operators, measurement, entanglement and noise channels, computed exactly." },
  { n: 2, slug: "error-correction", title: "Error Correction from First Principles", short: "Error correction",
    blurb: "Repetition codes, stabilizers, syndromes, distance and logical operators; inject errors and read syndromes." },
  { n: 3, slug: "surface-code", title: "Surface Codes", short: "Surface codes",
    blurb: "The rotated surface code at d = 3 and 5: stabilizers, detector events in space-time, minimum-weight matching." },
  { n: 4, slug: "gross-code", title: "The Gross [[144,12,12]] Code", short: "Gross code",
    blurb: "Bivariate bicycle construction, parity-check matrices, the real Tanner graph and the 12-cycle memory circuit." },
  { n: 5, slug: "decoders", title: "Decoder Mathematics", short: "Decoders",
    blurb: "He = s (mod 2), belief propagation, BP-OSD, relay-BP and the learned QEC-Aegis router." },
  { n: 6, slug: "experiments", title: "Interactive Experiments", short: "Experiments",
    blurb: "Bounded local simulations on the real backends: Gross-code shots, logical error sweeps, simulator cross-checks." },
  { n: 7, slug: "results", title: "Research Results", short: "Results",
    blurb: "Logical error rate per cycle with intervals, decode-time distributions, resources and the p-sweep." },
  { n: 8, slug: "hardware", title: "IBM Quantum: Live Status and Archived Evidence", short: "IBM hardware",
    blurb: "Read-only check of the IBM account and its QPUs, kept apart from the archived ibm_kingston run (checksum-verified, re-decoded). Execution disabled." },
];
