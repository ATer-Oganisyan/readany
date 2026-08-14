import { describe, expect, it, vi } from "vitest";

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
}));
vi.mock("expo-secure-store", () => ({}));

import { notifyPersistLoaded } from "./persist";

describe("persist hydration notification", () => {
  it("does nothing when the React Native window has no dispatchEvent", () => {
    expect(() =>
      notifyPersistLoaded(
        "narra-interactive",
        {} as Window,
        class {} as unknown as typeof CustomEvent,
      ),
    ).not.toThrow();
  });

  it("dispatches the hydration event when the host supports DOM events", () => {
    const dispatchEvent = vi.fn();
    class TestCustomEvent {
      constructor(
        readonly type: string,
        readonly options: { detail: { key: string } },
      ) {}
    }

    notifyPersistLoaded(
      "narra-interactive",
      { dispatchEvent } as unknown as Window,
      TestCustomEvent as unknown as typeof CustomEvent,
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "persist:loaded",
        options: { detail: { key: "narra-interactive" } },
      }),
    );
  });
});
