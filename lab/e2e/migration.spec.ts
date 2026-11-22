/** Regression tests for every feature migrated from the legacy dashboards into the lab. */
import { expect, test, type Page, type Response } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const json = async (r: Response) => (await r.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const api = (page: Page, p: string, method = "GET") =>
  page.waitForResponse((r) => r.url().includes(p) && r.request().method() === method && r.status() === 200, { timeout: 120_000 });
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "evaluation.fixture.json"), "utf8"));
const fmtSci = (x: number) => { const e = Math.floor(Math.log10(Math.abs(x))); const m = x / 10 ** e; return `${m.toFixed(2)}×10${String(e).replace(/-/g, "⁻").replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[+d])}`; };

// ---------------------------------------------------------------- P0: frozen-test evaluation states
test("P0: the real evaluation state is shown, and pending shows no final results", async ({ page }) => {
  const ev = api(page, "/api/aegis/evaluation");
  await page.goto("/results");
  const e = await json(await ev);
  await expect(page.getByTestId("frozen-evaluation")).toHaveAttribute("data-state", e.state);
  if (e.state !== "completed") {
    if (await page.getByTestId("eval-report").count()) await expect(page.getByTestId("eval-report")).toHaveAttribute("data-final", "0");
    await expect(page.getByTestId("fig-latency-timing")).toHaveCount(0);       // final-only figures are hidden
    const rows = page.getByTestId("pipeline-table").locator("tbody tr");
    await expect(rows).toHaveCount(e.pipeline.artifacts.length);
    for (const a of e.pipeline.artifacts) await expect(page.getByTestId(`pa-${a.label}`)).toHaveText(a.state);
  }
  if (e.state === "pending") await expect(page.getByTestId("eval-state-label")).toContainText("Not run yet");
});

async function withEvaluation(page: Page, body: object) {
  await page.route("**/api/aegis/evaluation", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) }));
}
const PIPE = { artifacts: [], loss_model: true, figures: [], runner: null, processes: [], start_command: "./scripts/run_frozen_evaluation.sh", evaluation_written: "2026-11-22 03:00" };

test("P0: running and failed states are explicit", async ({ page }) => {
  await withEvaluation(page, { state: "running", final: false, gaps: [], written: null, report: null,
    pipeline: { ...PIPE, runner: { state: "running", started: "x", updated: "y", steps: [{ name: "test_records", state: "running", started: "2026-11-21 21:00:00" }] } } });
  await page.goto("/results");
  await expect(page.getByTestId("eval-state-label")).toContainText("Running");
  await expect(page.getByTestId("eval-state")).toContainText("test_records");
  await expect(page.getByTestId("eval-report")).toHaveCount(0);
  await page.unroute("**/api/aegis/evaluation");
  await withEvaluation(page, { state: "failed", final: false, gaps: [], written: null, report: null,
    pipeline: { ...PIPE, runner: { state: "failed", started: "x", updated: "y", steps: [{ name: "online", state: "failed", exit_code: 1, finished: "2026-11-21 23:00:00" }] } } });
  await page.reload();
  await expect(page.getByTestId("eval-state-label")).toContainText("Failed");
  await expect(page.getByTestId("eval-state")).toContainText("--from online");
});

test("P0: a partial report is marked NOT FINAL and lists its gaps", async ({ page }) => {
  await withEvaluation(page, { state: "partial", final: false, gaps: ["single-worker timing missing at p = 0.005"], written: "2026-11-22 01:00", report: FIXTURE, pipeline: PIPE });
  await page.goto("/results");
  await expect(page.getByTestId("eval-state-label")).toContainText("Incomplete");
  await expect(page.getByTestId("eval-state")).toContainText("single-worker timing missing at p = 0.005");
  await expect(page.getByTestId("eval-report")).toHaveAttribute("data-final", "0");
  await expect(page.getByTestId("fig-eval-ler")).toContainText("NOT FINAL");
  await expect(page.getByRole("alert").filter({ hasText: "TEST FIXTURE" })).toBeVisible();   // the fixture can never pass as a result
});

test("P0: a completed report shows every final section with the report's numbers", async ({ page }) => {
  await withEvaluation(page, { state: "completed", final: true, gaps: [], written: "2026-11-22 04:00", report: FIXTURE, pipeline: { ...PIPE, figures: [] } });
  await page.goto("/results");
  await expect(page.getByTestId("eval-state-label")).toContainText("Final");
  await expect(page.getByTestId("eval-report")).toHaveAttribute("data-final", "1");
  for (const id of ["fig-eval-ler", "fig-eval-frontier", "fig-eval-timing", "fig-eval-erasure"]) await expect(page.getByTestId(id)).toBeVisible();
  const s = FIXTURE.sweep["0.004"];
  for (const [name, d] of Object.entries<any>(s.decoders)) {
    await expect(page.getByTestId(`ev-fail-${name}`)).toHaveText(`${d.failures_pair} / ${d.pairs.toLocaleString("en-US")}`);
    await expect(page.getByTestId(`ev-ler-${name}`)).toContainText(fmtSci(d.ler));
  }
  await expect(page.getByTestId("eval-comparisons").locator("tbody tr")).toHaveCount(Object.keys(s.comparisons).length);
  await expect(page.getByTestId("eval-erasure-table").locator("tbody tr")).toHaveCount(
    Object.values<any>(FIXTURE.loss).reduce((n, l) => n + Object.keys(l.decoders).length, 0));
  await expect(page.getByTestId("eval-model-quality")).toContainText(s.model_quality.auc.toFixed(3));
});

// ---------------------------------------------------------------- P1: decoder research
test("P1: studies, routing rules, router selection and predecoder equal the stored reports", async ({ page }) => {
  const resP = api(page, "/api/aegis/results"), trP = api(page, "/api/aegis/training");
  await page.goto("/decoders");
  const res = await json(await resP), tr = await json(await trP);
  const s = res.studies.find((x: any) => x.p === 0.004);
  for (const [k, v] of Object.entries<any>(s.paired_outcomes_bposd_relay))
    await expect(page.getByTestId(`po-${k.replaceAll(" ", "-").replaceAll(",", "")}`)).toHaveText(v.shots.toLocaleString("en-US"));
  const rules = Object.keys(s.rule_based).filter((k) => !k.endsWith("(perfect router)"));
  await expect(page.getByTestId("rules-table").locator("tbody tr")).toHaveCount(Object.keys(s.tiers).length + 2 + rules.length);
  for (const [k, h] of Object.entries<any>(s.hidden_failures)) await expect(page.getByTestId(`hidden-${k}`)).toHaveText(String(h.converged_but_wrong));
  await expect(page.getByTestId("ranking-table").locator("tbody tr")).toHaveCount(Object.keys(tr.ranking).length);
  for (const [mode, c] of Object.entries<any>(tr.chosen)) await expect(page.getByTestId(`chosen-threshold-${mode}`)).toHaveText(c.threshold.toPrecision(4));
  await expect(page.getByTestId("predecoder-method")).toContainText("not adopted");
  await expect(page.getByTestId("rationale")).toContainText(`relay-BP failed ${s.tiers.relay.failures_pair} pairs and BP-OSD ${s.tiers.bposd.failures_pair}`);
});

test("P1: every router feature, the threshold and the fallback rule are shown for a live shot", async ({ page }) => {
  await page.goto("/decoders");
  const resp = api(page, "/api/aegis/decode", "POST");
  await page.getByTestId("ld-run").click();
  const r = await json(await resp);
  const all = Object.values<string[]>(r.feature_groups).flat();
  await expect(page.getByTestId("ld-features").locator("[data-testid^=feat-]")).toHaveCount(all.length);
  for (const k of all.slice(0, 6)) await expect(page.getByTestId(`feat-${k}`)).toBeVisible();
  await expect(page.getByTestId("ld-fallback")).toHaveText(r.routing.tier1_converged ? "not triggered" : "triggered");
});

// ---------------------------------------------------------------- P2: circuit and compiled metrics
test("P2: the surface-code circuit shows the injected error where the backend placed it, with estimated compile metrics", async ({ page }) => {
  const comp = api(page, "/api/sim/compile");
  await page.goto("/surface-code");
  const c = await json(await comp);
  await expect(page.getByTestId("cm-depth-compiled")).toHaveText(String(c.compiled.depth));
  await expect(page.getByTestId("cm-2q-compiled")).toHaveText(String(c.compiled.two_qubit_gates));
  await expect(page.getByTestId("cm-overhead")).toHaveText(String(c.two_qubit_overhead));
  await expect(page.getByTestId("compile-metrics")).toContainText("hardware-target estimate, not executed");
  const inj = api(page, "/api/sim/simulate/injection", "POST");
  await page.getByTestId("data-10").click();
  const r = await json(await inj);
  const err = r.circuit.drawing.ops.find((o: any) => o.g === "ERR");
  const placed = page.getByTestId("surf-circuit").getByTestId("circuit-error");
  await expect(placed).toHaveCount(1);
  await expect(placed).toHaveAttribute("data-col", String(err.col));
  await expect(placed).toHaveAttribute("data-row", String(err.rows[0]));
  await expect(placed).toContainText(r.error.type);
  const firedMR = page.getByTestId("surf-circuit").getByTestId("circuit-fired");
  const expectedFired = r.syndrome.fired_detail.filter((d: any) => d.round < r.request.rounds).length;
  await expect(firedMR).toHaveCount(expectedFired);
});
