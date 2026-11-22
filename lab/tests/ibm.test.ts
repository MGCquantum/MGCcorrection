import { describe, expect, it } from "vitest";
import { authState, STALE_AFTER_S } from "@/app/hardware/LiveConnection";

describe("IBM connection panel: what it may claim", () => {
  it("is Unknown when no check has run, even if a saved account exists", () => {
    expect(authState({ authentication: "unknown", checked_at: null, age_seconds: null }).label).toBe("Unknown");
  });
  it("is Connected only for a recent successful check", () => {
    expect(authState({ authentication: "connected", checked_at: "2026-11-21T22:13:36-0600", age_seconds: 120 }).label).toBe("Connected");
  });
  it("downgrades a stale successful check to Unknown", () => {
    const a = authState({ authentication: "connected", checked_at: "2026-11-20T00:00:00-0600", age_seconds: STALE_AFTER_S + 1 });
    expect(a.label).toBe("Unknown");
    expect(a.note).toMatch(/last check connected/);
  });
  it("reports Disconnected when IBM rejected the key", () => {
    expect(authState({ authentication: "disconnected", checked_at: "2026-11-21T22:13:36-0600", age_seconds: 5 }).label).toBe("Disconnected");
  });
});
