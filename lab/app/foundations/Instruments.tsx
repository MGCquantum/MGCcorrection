"use client";
import { useMemo, useState } from "react";
import { BlochSphere } from "@/components/BlochSphere";
import { Button, Segmented, Slider, Stat } from "@/components/Controls";
import { Panel } from "@/components/Layout";
import { Provenance } from "@/components/Provenance";
import { TeX } from "@/components/TeX";
import {
  BELL, GATES, I2, PAULI1, angles, apply, applyChannel, bloch, canonical, channelMap, corr, fidelityPure, fmtC, jointZ, kron,
  norm3, probPlus, stateFromAngles, whichBell, type Channel, type GateName, type Vec, type Vec3,
} from "@/lib/quantum";
import { mulberry32 } from "@/lib/rng";

const deg = (r: number) => `${((r * 180) / Math.PI).toFixed(0)}°`;
const sgn = (x: number) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(3);

// ---------------------------------------------------------------- 1. one qubit, gates and measurement
export function QubitLab() {
  const [psi, setPsi] = useState<Vec>(stateFromAngles(Math.PI / 3, Math.PI / 4));
  const [history, setHistory] = useState<string[]>([]);
  const [basis, setBasis] = useState<"Z" | "X" | "Y">("Z");
  const [shots, setShots] = useState(200);
  const [seed, setSeed] = useState(1);
  const [sample, setSample] = useState<{ basis: string; plus: number; shots: number; seed: number; p: number } | null>(null);

  const r = bloch(psi);
  const [theta, phi] = angles(r);
  const amps = canonical(psi);
  const setAngles = (t: number, p: number) => { setPsi(stateFromAngles(t, p)); setHistory([]); setSample(null); };
  const gate = (g: GateName) => { setPsi((v) => apply(GATES[g], v)); setHistory((h) => [...h, g].slice(-12)); setSample(null); };
  const p = probPlus(r, basis);

  const measure = () => {
    const rnd = mulberry32(seed);
    let plus = 0;
    for (let k = 0; k < shots; k++) if (rnd() < p) plus++;
    setSample({ basis, plus, shots, seed, p });
  };
  const eig = { Z: ["|0⟩ (+1)", "|1⟩ (−1)"], X: ["|+⟩ (+1)", "|−⟩ (−1)"], Y: ["|+i⟩ (+1)", "|−i⟩ (−1)"] }[basis];

  return (
    <Panel title="Single-qubit state, Pauli gates and Born-rule measurement" source={<Provenance source="theory" />} testid="qubit-lab">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[300px_1fr]">
        <div>
          <BlochSphere label={`Bloch vector (${r.map((x) => x.toFixed(2)).join(", ")}).`} arrows={[{ r, color: "var(--accent)" }]} />
          <div className="mt-3 space-y-3">
            <Slider label={<TeX>{"\\theta"}</TeX>} value={theta} min={0} max={Math.PI} step={0.01} format={deg} onChange={(t) => setAngles(t, phi)} testid="theta" />
            <Slider label={<TeX>{"\\varphi"}</TeX>} value={phi} min={0} max={2 * Math.PI - 0.01} step={0.01} format={deg} onChange={(f) => setAngles(theta, f)} testid="phi" />
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <div>
            <div className="mb-1.5 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Apply a gate</div>
            <div className="flex flex-wrap gap-2">
              {(["X", "Y", "Z", "H", "S"] as GateName[]).map((g) => <Button key={g} kind="secondary" onClick={() => gate(g)} testid={`gate-${g}`}><TeX>{g}</TeX></Button>)}
              <Button kind="ghost" onClick={() => setAngles(0, 0)}>reset to |0⟩</Button>
            </div>
            <div className="mt-2 font-sans text-[12.5px] text-muted">Circuit so far: <span className="num text-ink-2">|ψ₀⟩ {history.length ? "→ " + history.join(" → ") : ""}</span></div>
          </div>
          <div className="rounded-[5px] bg-sunken px-4 py-2">
            <TeX block>{`|\\psi\\rangle = (${fmtC(amps[0])})\\,|0\\rangle + (${fmtC(amps[1])})\\,|1\\rangle`}</TeX>
            <TeX block>{`\\vec r = (\\langle X\\rangle, \\langle Y\\rangle, \\langle Z\\rangle) = (${sgn(r[0])},\\ ${sgn(r[1])},\\ ${sgn(r[2])}),\\quad |\\vec r| = ${norm3(r).toFixed(3)}`}</TeX>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Segmented label="Measure in basis" value={basis} onChange={(b) => { setBasis(b); setSample(null); }}
              options={[{ value: "Z", label: "Z" }, { value: "X", label: "X" }, { value: "Y", label: "Y" }]} testid="basis" />
            <Segmented label="Shots" value={shots} onChange={setShots} options={[50, 200, 1000, 10000].map((n) => ({ value: n, label: n.toLocaleString() }))} />
            <Button onClick={measure} testid="measure">Sample {shots.toLocaleString()} shots</Button>
            <Button kind="ghost" onClick={() => { setSeed((s) => s + 1); setSample(null); }}>new seed ({seed})</Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label={<>P({eig[0]})</>} value={p.toFixed(4)} sub={<TeX>{`\\tfrac{1}{2}(1 + r_${basis.toLowerCase()})`}</TeX>} testid="p-plus" />
            <Stat label={<>P({eig[1]})</>} value={(1 - p).toFixed(4)} sub="Born rule" />
          </div>
          {sample && (
            <div className="rounded-[5px] border border-rule p-3 font-sans text-[13px] text-ink-2" data-testid="sample">
              <div className="mb-2 flex items-center justify-between"><span className="font-medium text-ink">Sampled outcomes</span><Provenance source="illustration" detail={`seeded PRNG, seed ${sample.seed}`} /></div>
              <BarPair a={sample.plus} b={sample.shots - sample.plus} expected={sample.p} labels={eig} />
              <p className="mt-2 text-[12.5px] text-muted">
                Observed frequency {(sample.plus / sample.shots).toFixed(4)} against P = {sample.p.toFixed(4)}. Its standard error is
                √(P(1−P)/N) = {Math.sqrt((sample.p * (1 - sample.p)) / sample.shots).toFixed(4)}: a probability is only ever estimated from repeated
                preparation and measurement, never read from one shot.
              </p>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function BarPair({ a, b, expected, labels }: { a: number; b: number; expected: number; labels: string[] }) {
  const n = a + b;
  return (
    <div className="space-y-1.5">
      {[[labels[0], a, expected], [labels[1], b, 1 - expected]].map(([lab, k, e]) => (
        <div key={String(lab)} className="grid grid-cols-[86px_1fr_70px] items-center gap-2">
          <span className="num text-[12px]">{lab}</span>
          <div className="relative h-3.5 rounded-sm bg-sunken">
            <div className="h-full rounded-sm" style={{ width: `${(100 * Number(k)) / n}%`, background: "var(--s1)" }} />
            <div className="absolute top-[-3px] h-[20px] w-[2px] bg-ink" style={{ left: `${100 * Number(e)}%` }} title="Born-rule expectation" />
          </div>
          <span className="num text-right text-[12px]">{Number(k).toLocaleString()}</span>
        </div>
      ))}
      <div className="text-[11.5px] text-muted">Bars: sampled counts. Black tick: Born-rule probability.</div>
    </div>
  );
}

// ---------------------------------------------------------------- 2. entanglement and the stabilizers of a Bell pair
export function BellLab() {
  const [base, setBase] = useState<keyof typeof BELL>("Φ+");
  const [errors, setErrors] = useState<{ q: "A" | "B"; p: "X" | "Y" | "Z" }[]>([]);
  const [seed, setSeed] = useState(3);

  const state = useMemo(() => errors.reduce((v, e) => apply(e.q === "A" ? kron(PAULI1[e.p], I2) : kron(I2, PAULI1[e.p]), v), BELL[base]), [base, errors]);
  const xx = corr(state, "X", "X"), zz = corr(state, "Z", "Z"), yy = corr(state, "Y", "Y");
  const name = whichBell(state);
  const probs = jointZ(state);
  const shots = useMemo(() => {
    const rnd = mulberry32(seed), out: string[] = [];
    for (let k = 0; k < 16; k++) { let u = rnd(), i = 0; while (i < 3 && u >= probs[i]) { u -= probs[i]; i++; } out.push(["00", "01", "10", "11"][i]); }
    return out;
  }, [seed, probs]);
  const amps = canonical(state);

  return (
    <Panel title="Bell pair: correlations, and the two stabilizers that detect errors" source={<Provenance source="theory" />} testid="bell-lab">
      <div className="flex flex-wrap items-end gap-4">
        <Segmented label="Prepare" value={base} onChange={(b) => { setBase(b); setErrors([]); }} options={Object.keys(BELL).map((k) => ({ value: k as keyof typeof BELL, label: `|${k}⟩` }))} />
        <div>
          <div className="mb-1 font-sans text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">Apply an error</div>
          <div className="flex flex-wrap gap-1.5">
            {(["A", "B"] as const).flatMap((q) => (["X", "Y", "Z"] as const).map((p) => (
              <Button key={q + p} kind="secondary" onClick={() => setErrors((e) => [...e, { q, p }].slice(-8))} testid={`bell-${p}${q}`}>
                <span className="num">{p}<sub>{q}</sub></span>
              </Button>
            )))}
            <Button kind="ghost" onClick={() => setErrors([])}>clear</Button>
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="rounded-[5px] bg-sunken px-4 py-2 text-[14px]">
            <TeX block>{`|\\psi\\rangle = ${amps.map((a, i) => `(${fmtC(a, 3)})|${["00", "01", "10", "11"][i]}\\rangle`).join(" + ")}`}</TeX>
            <div className="pb-1 font-sans text-[12.5px] text-muted">Errors applied: <span className="num text-ink-2">{errors.length ? errors.map((e) => `${e.p}${e.q}`).join(" · ") : "none"}</span>. Current state: <span className="num text-ink">{name ? `|${name}⟩` : "—"}</span> (up to a global phase)</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label={<TeX>{"\\langle X\\!\\otimes\\! X\\rangle"}</TeX>} value={xx.toFixed(0)} testid="xx" sub={xx < 0 ? "flipped by Z or Y" : "unchanged"} />
            <Stat label={<TeX>{"\\langle Z\\!\\otimes\\! Z\\rangle"}</TeX>} value={zz.toFixed(0)} testid="zz" sub={zz < 0 ? "flipped by X or Y" : "unchanged"} />
            <Stat label={<TeX>{"\\langle Y\\!\\otimes\\! Y\\rangle"}</TeX>} value={yy.toFixed(0)} sub="= −⟨XX⟩⟨ZZ⟩" />
          </div>
          <p className="font-sans text-[13px] leading-relaxed text-ink-2">
            Single-qubit expectations stay at zero (<TeX>{`\\langle Z_A\\rangle = ${Math.abs(corr(state, "Z", "I")).toFixed(0)}`}</TeX>,{" "}
            <TeX>{`\\langle X_A\\rangle = ${Math.abs(corr(state, "X", "I")).toFixed(0)}`}</TeX>): each qubit alone is maximally mixed.
            The information sits only in the two-qubit parities. Those parities can be measured without learning anything about either qubit,
            and an error shows up as a sign change. That is a syndrome.
          </p>
        </div>
        <div>
          <div className="font-sans text-[12px] font-medium uppercase tracking-[0.06em] text-muted">Joint Z-basis outcome probabilities</div>
          <div className="mt-2 space-y-1.5">
            {probs.map((pr, i) => (
              <div key={i} className="grid grid-cols-[36px_1fr_56px] items-center gap-2 font-sans text-[12.5px]">
                <span className="num">{["00", "01", "10", "11"][i]}</span>
                <div className="h-3 rounded-sm bg-sunken"><div className="h-full rounded-sm" style={{ width: `${100 * pr}%`, background: "var(--s2)" }} /></div>
                <span className="num text-right">{pr.toFixed(3)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between font-sans text-[12px] text-muted">
            <span>16 sampled shots (seed {seed}) <Provenance source="illustration" /></span>
            <Button kind="ghost" onClick={() => setSeed((s) => s + 1)}>resample</Button>
          </div>
          <div className="num mt-1 flex flex-wrap gap-1.5 text-[13px]">{shots.map((s, i) => <span key={i} className="rounded bg-sunken px-1.5 py-0.5">{s}</span>)}</div>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- 3. physical noise channels
export function NoiseLab() {
  const [ch, setCh] = useState<Channel>("depolarizing");
  const [p, setP] = useState(0.05);
  const [n, setN] = useState(5);
  const [start, setStart] = useState<Vec3>([Math.sin(1.0) * Math.cos(0.6), Math.sin(1.0) * Math.sin(0.6), Math.cos(1.0)]);
  const trail = useMemo(() => Array.from({ length: n + 1 }, (_, k) => applyChannel(ch, p, start, k)), [ch, p, n, start]);
  const end = trail[trail.length - 1];
  const map = channelMap(ch, p);
  const composed = { diag: map.diag.map((d) => Math.pow(d, n)) as Vec3, shift: applyChannel(ch, p, [0, 0, 0], n) };
  const formula: Record<Channel, string> = {
    "bit-flip": "\\mathcal E(\\rho) = (1-p)\\rho + p\\,X\\rho X \\;\\Rightarrow\\; (x, y, z) \\mapsto (x,\\,(1-2p)y,\\,(1-2p)z)",
    "phase-flip": "\\mathcal E(\\rho) = (1-p)\\rho + p\\,Z\\rho Z \\;\\Rightarrow\\; (x, y, z) \\mapsto ((1-2p)x,\\,(1-2p)y,\\,z)",
    depolarizing: "\\mathcal E(\\rho) = (1-p)\\rho + \\tfrac{p}{3}(X\\rho X + Y\\rho Y + Z\\rho Z) \\;\\Rightarrow\\; \\vec r \\mapsto \\big(1 - \\tfrac{4p}{3}\\big)\\vec r",
    "amplitude-damping": "\\vec r \\mapsto \\big(\\sqrt{1-\\gamma}\\,x,\\ \\sqrt{1-\\gamma}\\,y,\\ \\gamma + (1-\\gamma) z\\big),\\quad \\gamma = 1 - e^{-t/T_1}",
  };
  return (
    <Panel title="Noise as a contraction of the Bloch ball" source={<Provenance source="theory" />} testid="noise-lab">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[300px_1fr]">
        <BlochSphere label="Initial state (navy), state after the channel (cyan) and the image of the whole sphere (amber)."
          arrows={[{ r: start, color: "var(--s1)", dashed: true }, { r: end, color: "var(--accent)" }]} trail={trail} ellipsoid={composed} />
        <div className="min-w-0 space-y-4">
          <Segmented label="Channel" value={ch} onChange={setCh} testid="channel"
            options={[{ value: "bit-flip", label: "Bit flip" }, { value: "phase-flip", label: "Phase flip" }, { value: "depolarizing", label: "Depolarizing" }, { value: "amplitude-damping", label: "Amplitude damping" }]} />
          <div className="rounded-[5px] bg-sunken px-4 py-1 text-[14px]"><TeX block>{formula[ch]}</TeX></div>
          <div className="grid grid-cols-2 gap-4">
            <Slider label={ch === "amplitude-damping" ? <TeX>{"\\gamma"}</TeX> : <TeX>{"p"}</TeX>} value={p} min={0} max={ch === "amplitude-damping" ? 0.5 : 0.5} step={0.005} onChange={setP} format={(v) => v.toFixed(3)} />
            <Slider label="applications n" value={n} min={0} max={40} step={1} onChange={setN} />
          </div>
          <div className="flex flex-wrap gap-2">
            {([["|0⟩", [0, 0, 1]], ["|1⟩", [0, 0, -1]], ["|+⟩", [1, 0, 0]], ["|+i⟩", [0, 1, 0]], ["generic", [Math.sin(1.0) * Math.cos(0.6), Math.sin(1.0) * Math.sin(0.6), Math.cos(1.0)]]] as [string, Vec3][]).map(([l, v]) => (
              <Button key={l} kind="secondary" onClick={() => setStart(v)}>start {l}</Button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="|r| after n" value={norm3(end).toFixed(4)} sub="1 = pure, 0 = maximally mixed" testid="purity" />
            <Stat label="Fidelity" value={fidelityPure(start, end).toFixed(4)} sub={<TeX>{"\\tfrac12(1 + \\vec r_0\\cdot\\vec r_n)"}</TeX>} />
            <Stat label="Axes of image" value={composed.diag.map((d) => d.toFixed(2)).join(", ")} sub="x, y, z scale" />
          </div>
          <p className="font-sans text-[13px] leading-relaxed text-ink-2">
            Bit flips leave the x axis untouched and phase flips leave the z axis untouched, so <TeX>{"|0\\rangle"}</TeX> is immune to phase flips
            and <TeX>{"|+\\rangle"}</TeX> to bit flips. A code that stores only along one axis therefore protects against only one error type. That is the
            repetition code's limitation in Module 2. Depolarizing noise shrinks every direction equally. Amplitude damping is not unital: it pulls the
            ball toward <TeX>{"|0\\rangle"}</TeX>. The simulators approximate such noise by Pauli channels (Pauli twirling), which is what the circuit
            models in Modules 3 to 7 use.
          </p>
        </div>
      </div>
    </Panel>
  );
}
