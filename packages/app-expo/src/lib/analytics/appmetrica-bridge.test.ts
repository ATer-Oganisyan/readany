import { describe, expect, it, vi } from "vitest";
import { type AppMetricaSdk, createAppMetricaBridge } from "./appmetrica-bridge";
import { ANALYTICS_SCHEMA_VERSION, type AnalyticsEvent } from "./contract";

function sdk(): AppMetricaSdk {
  return {
    activate: vi.fn(),
    setDataSendingEnabled: vi.fn(),
    reportEvent: vi.fn(),
  };
}

function event(name: AnalyticsEvent["name"]): AnalyticsEvent {
  return {
    eventId: "event-1",
    name,
    occurredAt: "2026-09-22T00:00:00.000Z",
    sessionId: "session-1",
    properties: { book_kind: "imported" },
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
  };
}

describe("AppMetrica mobile bridge", () => {
  it("does not activate or report when disabled or missing a key", () => {
    for (const [key, enabled] of [
      ["key", false],
      [undefined, true],
    ] as const) {
      const client = sdk();
      const bridge = createAppMetricaBridge(client, key, enabled);
      bridge.start("extended");
      bridge.report(event("book_opened"));
      expect(client.activate).not.toHaveBeenCalled();
      expect(client.reportEvent).not.toHaveBeenCalled();
    }
  });

  it("activates once, reports product events, and skips SDK lifecycle events", () => {
    const client = sdk();
    const bridge = createAppMetricaBridge(client, " key ", true);
    bridge.start("essential");
    bridge.start("extended");
    bridge.report(event("app_opened"));
    bridge.report(event("app_closed"));
    bridge.report(event("app_version_seen"));
    bridge.report(event("book_opened"));
    expect(client.activate).toHaveBeenCalledOnce();
    expect(client.activate).toHaveBeenCalledWith({ apiKey: "key", statisticsSending: true });
    expect(client.reportEvent).toHaveBeenCalledOnce();
    expect(client.reportEvent).toHaveBeenCalledWith("book_opened", {
      book_kind: "imported",
    });
  });

  it("stops and resumes sending when the analytics tier changes", () => {
    const client = sdk();
    const bridge = createAppMetricaBridge(client, "key", true);
    bridge.start("none");
    expect(client.activate).not.toHaveBeenCalled();
    bridge.start("extended");
    bridge.start("none");
    bridge.report(event("book_opened"));
    bridge.start("essential");
    bridge.report(event("book_opened"));
    expect(client.setDataSendingEnabled).toHaveBeenNthCalledWith(1, false);
    expect(client.setDataSendingEnabled).toHaveBeenNthCalledWith(2, true);
    expect(client.reportEvent).toHaveBeenCalledOnce();
  });

  it("keeps analytics failures out of product flows", () => {
    const client = sdk();
    vi.mocked(client.activate).mockImplementationOnce(() => {
      throw new Error("native module unavailable");
    });
    const bridge = createAppMetricaBridge(client, "key", true);
    expect(() => bridge.start("extended")).not.toThrow();
    bridge.report(event("book_opened"));
    expect(client.reportEvent).not.toHaveBeenCalled();
    bridge.start("extended");
    vi.mocked(client.reportEvent).mockImplementationOnce(() => {
      throw new Error("native report failed");
    });
    expect(() => bridge.report(event("book_opened"))).not.toThrow();
  });
});
