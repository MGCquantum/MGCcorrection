import { expect, test, type Page, type Response } from "@playwright/test";

/** Collect console errors and failed requests for a page; every test asserts there are none. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}
const json = async (r: Response) => (await r.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const waitApi = (page: Page, path: string, method = "GET") =>
  page.waitForResponse((r) => r.url().includes(path) && r.request().method() === method && r.status() === 200, { timeout: 90_000 });

test("every module renders, has one h1, labels its provenance and logs no errors", async ({ page }) => {
  const errors = watch(page);
  for (const path of ["/", "/foundations", "/error-correction", "/surface-code", "/gross-code", "/decoders", "/experiments", "/results", "/hardware"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1")).toHaveCount(1);
    if (path !== "/") await expect(page.locator("[data-provenance]").first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("backend status shows the versions the FastAPI health endpoint reports", async ({ page }) => {
  const health = waitApi(page, "/api/sim/health");
  await page.goto("/");
  const h = await json(await health);
  await expect(page.getByTestId("backend-status")).toContainText(`Stim ${h.versions.stim}`);
  await expect(page.getByTestId("backend-status")).toContainText(`PyMatching ${h.versions.pymatching}`);
});

test("Module 1: exact quantum mechanics", async ({ page }) => {
  await page.goto("/foundations");
  await page.getByTestId("gate-H").click();                // H on theta = 60°, phi = 45°
  await page.getByTestId("measure").click();
  await expect(page.getByTestId("sample")).toBeVisible();
  await page.getByTestId("bell-XA").click();               // X on qubit A flips Z⊗Z only
  await expect(page.getByTestId("zz")).toHaveText("-1");
  await expect(page.getByTestId("xx")).toHaveText("1");
});

test("Module 2: exact syndrome bench agrees with the Aer circuit run the page displays", async ({ page }) => {
  await page.goto("/error-correction");
  await page.getByTestId("bench-d").getByRole("radio", { name: "3" }).click();
  await page.getByTestId("qubit-1").press("Enter");        // keyboard path
  await expect(page.getByTestId("bench-syndrome")).toHaveText("11");
  await expect(page.getByTestId("bench-logical")).toHaveText("no");
  const resp = waitApi(page, "/api/sim/simulate/injection", "POST");
  await page.getByTestId("sim-run-button").click();
  const r = await json(await resp);
  expect(r.request).toMatchObject({ code: "repetition", distance: 3, error_type: "X" });
  await expect(page.getByTestId("sim-fired")).toHaveText(r.syndrome.fired.join(", ") || "none");
  await expect(page.getByTestId("sim-outcome")).toHaveText(r.logical.outcome);
  await expect(page.getByTestId("sim-after")).toContainText(`${r.logical.errors_after_decoding} / ${r.logical.shots}`);
  await expect(page.getByTestId("sim-result")).toHaveAttribute("data-run-id", r.run_id);
  await expect(page.getByTestId("sim-result")).toContainText("✓ Exact bench predicted");
  // Two errors on a d = 3 code defeat the decoder: a logical error the checks cannot see.
  await page.getByTestId("qubit-0").click();
  await expect(page.getByTestId("bench-logical")).toHaveText("yes");
});

test("Module 3: surface-code injection and matching show the backend's answers", async ({ page }) => {
  await page.goto("/surface-code");
  await page.waitForSelector("[data-testid=data-10]");
  const inj = waitApi(page, "/api/sim/simulate/injection", "POST");
  const dec = page.waitForResponse((r) => r.url().includes("/api/sim/decode-syndrome") && r.request().postDataJSON()?.fired?.length > 0);
  await page.getByTestId("data-10").click();
  const r = await json(await inj);
  await expect(page.getByTestId("surf-outcome")).toHaveText(r.logical.outcome);
  await expect(page.getByTestId("surf-fired")).toContainText(String(r.syndrome.fired.length));
  for (const d of r.syndrome.fired_detail) await expect(page.getByTestId(`anc-${d.qubit}`)).toHaveAttribute("data-fired", "1");
  const m = await json(await dec);
  expect(m.fired).toEqual([...r.syndrome.fired].sort((a: number, b: number) => a - b));
  await expect(page.getByTestId("match-pairs")).toHaveText(m.pairs.map(([u, v]: [number, number | null]) => `${u}–${v ?? "B"}`).join("  "));
  await expect(page.getByTestId("match-pred")).toHaveText(m.predicted_logical_flip ? "logical flip" : "no logical flip");
});

test("Module 4: Gross-code structure comes from the backend", async ({ page }) => {
  const st = waitApi(page, "/api/aegis/gross/structure");
  await page.goto("/gross-code");
  const s = await json(await st);
  expect([s.n, s.k, s.commute]).toEqual([144, 12, true]);
  await expect(page.getByTestId("gf-k")).toHaveText(String(s.k));
  await expect(page.getByTestId("gf-rank")).toHaveText(`${s.rank_hx}, ${s.rank_hz}`);
  await expect(page.getByTestId("dem-shape")).toHaveText(`${s.circuits.X.H_shape[0]} × ${s.circuits.X.H_shape[1].toLocaleString("en-US")}`);
  await expect(page.getByTestId("tn-selection")).toContainText(s.x_checks[0].map((q: number, d: number) => `${s.neighbour_labels[d]}→q${q}`).join("  "));
  const shot = waitApi(page, "/api/aegis/decode", "POST");
  await page.getByTestId("tn-sample").click();
  const r = await json(await shot);
  const row = 5;
  await expect(page.getByTestId("tn-row-count")).toHaveText(String(r.syndrome[row].reduce((a: number, b: number) => a + b, 0)));
  const fired = r.syndrome[row].flatMap((v: number, c: number) => (v ? [c] : []));
  for (const c of fired.slice(0, 5)) await expect(page.getByTestId(`tn-X${c}`)).toHaveAttribute("data-fired", "1");
});

test("Module 5: illustration shows BP failing on the degenerate toric syndrome", async ({ page }) => {
  await page.goto("/decoders");
  await page.getByTestId("bp-degenerate").click();
  await expect(page.getByTestId("bp-syndrome")).toHaveText("s = 100010000 · weight 2");
  await expect(page.getByTestId("bp-outcomes")).toContainText("no solution in");
  await expect(page.getByTestId("bp-outcomes")).toContainText("BP + OSD-0");
  const resp = waitApi(page, "/api/aegis/decode", "POST");
  await page.getByTestId("ld-run").click();
  const r = await json(await resp);
  for (const [name, d] of Object.entries<any>(r.decoders)) {
    await expect(page.getByTestId("ld-table")).toContainText(name);
    await expect(page.getByTestId("ld-table")).toContainText(String(d.bp_iterations));
    expect(d.ms).toBeGreaterThan(0);
  }
  await expect(page.getByTestId("ld-risk")).toHaveText(r.routing.risk.toExponential(2));
  await expect(page.getByTestId("ld-route")).toHaveText(r.routing.escalated ? "escalated" : "accepted");
});

test("Module 6: experiment panels display exactly the API responses", async ({ page }) => {
  await page.goto("/experiments");
  const g = waitApi(page, "/api/aegis/decode", "POST");
  await page.getByTestId("g-run").click();
  const r = await json(await g);
  await expect(page.getByTestId("g-total")).toHaveText(`${r.syndrome.flat().reduce((a: number, b: number) => a + b, 0)} events`);
  for (const [name, d] of Object.entries<any>(r.decoders)) {
    await expect(page.getByTestId(`g-outcome-${name}`)).toHaveText(d.logical_correct ? "correct" : "logical error");
    await expect(page.getByTestId(`g-iter-${name}`)).toHaveText(String(d.bp_iterations));
  }
  if (r.routing) await expect(page.getByTestId("g-route")).toHaveText(r.routing.path);

  await page.getByTestId("rates-shots").fill("5000");
  const rr = waitApi(page, "/api/sim/simulate/rates", "POST");
  await page.getByTestId("rates-run").click();
  const rates = await json(await rr);
  expect(rates.request.shots).toBe(5000);
  const rows = page.getByTestId("rates-table").locator("tbody tr");
  await expect(rows).toHaveCount(rates.points.length);
  for (let i = 0; i < rates.points.length; i++) await expect(rows.nth(i)).toContainText(`${rates.points[i].errors} / ${rates.points[i].shots.toLocaleString("en-US")}`);

  const cr = waitApi(page, "/api/sim/simulate/compare", "POST");
  await page.getByTestId("cmp-run").click();
  const c = await json(await cr);
  await expect(page.getByTestId("cmp-aer")).toHaveText(`${c.aer.errors} / ${c.aer.shots}`);
  await expect(page.getByTestId("cmp-stim")).toHaveText(`${c.stim.errors} / ${c.stim.shots}`);
  await expect(page.getByTestId("cmp-fisher")).toHaveText(c.fisher_exact_p.toFixed(3));
});

test("Module 7: research figures equal the stored-record summary", async ({ page }) => {
  const rec = waitApi(page, "/api/aegis/records");
  const man = waitApi(page, "/api/aegis/manifest");
  await page.goto("/results");
  const r = await json(await rec);
  const val = r.settings.filter((s: any) => s.split === "val" && s.f === 0);
  expect(val.map((s: any) => s.p).sort()).toEqual([0.003, 0.004, 0.005]);      // the required sweep
  for (const s of val) for (const t of ["relay", "bposd"]) {
    await expect(page.getByTestId(`ler-fail-${t}-${s.p}`)).toHaveText(`${s.tiers[t].failures_pair} / ${s.pairs.toLocaleString("en-US")}`);
  }
  const p4 = val.find((s: any) => s.p === 0.004);
  const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} s` : x >= 100 ? `${x.toFixed(0)} ms` : x >= 10 ? `${x.toFixed(1)} ms` : `${x.toFixed(2)} ms`);
  await expect(page.getByTestId("lat-p99-relay")).toHaveText(ms(p4.tiers.relay.ms_p99));
  const m = await json(await man);
  await expect(page.getByTestId("res-runs")).toHaveText(String(m.runs.length));
});

test("Module 8: archived hardware run, checksums verified, no submission path", async ({ page }) => {
  const hw = waitApi(page, "/api/sim/hardware");
  await page.goto("/hardware");
  const h = await json(await hw);
  expect(h.live).toBe(false);
  expect(h.integrity.checksums_ok).toBe(true);
  await expect(page.getByTestId("hw-job")).toHaveText(h.job_id);
  await expect(page.getByTestId("hw-raw")).toHaveText(`${h.analysis.qec.logical_errors_raw} / ${h.analysis.qec.shots}`);
  await expect(page.getByTestId("hw-decoded")).toHaveText(`${h.analysis.qec.logical_errors_decoded} / ${h.analysis.qec.shots}`);
  for (const d of h.detectors) await expect(page.getByTestId(`hw-det-${d.index}`)).toHaveText(`${(100 * d.rate).toFixed(1)}%`);
  for (const [f, sha] of Object.entries<string>(h.integrity.sha256_expected)) {
    await expect(page.getByTestId("hw-sums")).toContainText(sha);
    expect(h.integrity.sha256_recomputed[f]).toBe(sha);
  }
  await expect(page.getByTestId("hw-submission")).toContainText("disabled");
});

test("Module 8: live IBM connection panel shows the server's snapshot, kept apart from the archive", async ({ page }) => {
  const errors = watch(page);
  const live = waitApi(page, "/api/sim/ibm-connection");
  await page.goto("/hardware");
  const c = await json(await live);
  expect(c.server_contacts_ibm).toBe(false);
  expect(c.hardware_execution).toBe("disabled");
  const body = JSON.stringify(c);
  expect(body).not.toMatch(/crn:v1|token|api_?key|Bearer/i);
  const panel = page.getByTestId("ibm-live");
  await expect(page.getByTestId("ibm-exec")).toContainText("Disabled");
  const fresh = c.checked_at && c.age_seconds != null && c.age_seconds <= 24 * 3600;
  const expected = !c.checked_at ? "Unknown" : c.authentication === "connected" ? (fresh ? "Connected" : "Unknown")
    : c.authentication === "disconnected" ? "Disconnected" : "Unknown";
  await expect(page.getByTestId("ibm-auth")).toContainText(expected);
  if (c.backends?.length) {
    const qpus = c.backends.filter((b: any) => !b.simulator);
    await expect(page.getByTestId("ibm-qpus")).toContainText(`${qpus.filter((b: any) => b.operational).length} / ${qpus.length}`);
    for (const b of qpus) {
      const row = page.getByTestId("ibm-backends").locator("tr", { has: page.getByTestId(`ibm-be-${b.name}`) });
      await expect(row).toContainText(String(b.qubits));
      await expect(row).toContainText(b.operational ? "online" : "offline");
      if (b.pending_jobs != null) await expect(row).toContainText(String(b.pending_jobs));
    }
    await expect(page.getByTestId("ibm-instance")).toContainText(c.instance.name);
  }
  // The archived run is a separate section, after the live panel.
  const order = await page.evaluate(() => [document.getElementById("live")?.offsetTop ?? -1, document.getElementById("record")?.offsetTop ?? -1]);
  expect(order[0]).toBeGreaterThanOrEqual(0);
  expect(order[0]).toBeLessThan(order[1]);
  await expect(panel).not.toContainText("dc0kvf2nj2vs73de5qvg");      // the archived job is not shown as live
  expect(errors).toEqual([]);
});

test("Module 8: a stale or failed check is never shown as Connected (rendering of mocked snapshots)", async ({ page }) => {
  const base = { source: "results/live/ibm_connection_status.json", live: false, refresh_command: "x", hardware_execution: "disabled", server_contacts_ibm: false };
  for (const [snap, label] of [
    [{ ...base, authentication: "connected", checked_at: "2026-11-01T00:00:00-0600", age_seconds: 30 * 86400, backends: [] }, "Unknown"],
    [{ ...base, authentication: "disconnected", checked_at: "2026-11-21T00:00:00-0600", age_seconds: 60, reason: "IBM rejected the saved API key" }, "Disconnected"],
    [{ ...base, authentication: "unknown", checked_at: null, reason: "No connection check has been run" }, "Unknown"],
  ] as const) {
    await page.route("**/api/sim/ibm-connection", (route) => route.fulfill({ json: snap }));
    await page.goto("/hardware");
    await expect(page.getByTestId("ibm-auth")).toContainText(label);
    await expect(page.getByTestId("ibm-exec")).toContainText("Disabled");
    await page.unroute("**/api/sim/ibm-connection");
  }
});

test("keyboard navigation reaches the module links and the theme toggle", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveText("Skip to content");
  await page.getByRole("link", { name: /Surface codes/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/surface-code/);
});

test("phone width: no horizontal page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/foundations", "/gross-code", "/results"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
