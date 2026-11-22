import { defineConfig } from "@playwright/test";

// Runs against a production build (`next start`) on its own port. The lab's backends (:8765 QEC-Aegis,
// :8000 MidQwest FastAPI) must already be running (`make dev`).
const PORT = Number(process.env.LAB_E2E_PORT ?? 3101);
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: "chrome", headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: { command: `npx next start -H 127.0.0.1 -p ${PORT}`, url: `http://127.0.0.1:${PORT}/`, reuseExistingServer: true, timeout: 120_000 },
});
