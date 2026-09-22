import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ start: vi.fn(), report: vi.fn() }));
const gateway = vi.hoisted(() => vi.fn());

vi.mock("./appmetrica", () => ({ appMetricaBridge: bridge }));
vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ narraGatewayRequest: gateway }));
vi.mock("@readany/core/utils/event-bus", () => ({ eventBus: { on: vi.fn(() => () => {}) } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.4.0" } } }));
vi.mock("expo-crypto", () => ({ randomUUID: vi.fn(() => "test-id") }));
vi.mock("expo-file-system/legacy", () => ({ documentDirectory: null }));
vi.mock("react-native", () => ({
  AppState: { currentState: "inactive", addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Platform: { Version: 18 },
}));

import { flushTelemetry, recordTelemetry, startTelemetry, stopTelemetry } from "./telemetry";

describe("mobile telemetry destinations", () => {
  beforeEach(() => {
    bridge.start.mockClear();
    bridge.report.mockClear();
    gateway.mockReset();
    gateway.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: 1, rejected: [] }),
    });
    process.env.EXPO_PUBLIC_NARRA_ANALYTICS_TIER = "extended";
  });

  it("sends the same sanitized product event to AppMetrica and the gateway", async () => {
    const stop = startTelemetry();
    recordTelemetry("book_opened", { book_kind: "imported", title: "private book title" });
    await flushTelemetry();

    expect(bridge.start).toHaveBeenCalledWith("extended");
    expect(bridge.report).toHaveBeenCalledWith(
      expect.objectContaining({ name: "book_opened", properties: { book_kind: "imported" } }),
    );
    const [, options] = gateway.mock.calls[0];
    expect(JSON.parse(options.body).events[0].properties).toEqual({ book_kind: "imported" });
    stop();
    stopTelemetry();
  });
});
