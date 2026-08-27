import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  current: "active",
  listeners: new Set<(state: string) => void>(),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return state.current;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      state.listeners.add(listener);
      return { remove: () => state.listeners.delete(listener) };
    },
  },
}));
import { inCoverForeground } from "./cover-job-session";
const change = (next: string) => {
  state.current = next;
  for (const listener of [...state.listeners]) listener(next);
};
beforeEach(() => {
  state.current = "active";
  state.listeners.clear();
});
describe("cover foreground session", () => {
  it("does not send requests in background", async () => {
    change("background");
    const operation = vi.fn(async () => "saved");
    const pending = inCoverForeground(operation);
    expect(operation).not.toHaveBeenCalled();
    change("active");
    await expect(pending).resolves.toBe("saved");
    expect(state.listeners.size).toBe(0);
  });
  it("aborts in background and resumes through a fresh persisted-state read", async () => {
    const operation = vi.fn(
      (signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    const pending = inCoverForeground(operation);
    change("background");
    await Promise.resolve();
    await Promise.resolve();
    expect(operation.mock.calls[0][0].aborted).toBe(true);
    operation.mockImplementationOnce(async () => "resumed");
    change("active");
    await expect(pending).resolves.toBe("resumed");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(state.listeners.size).toBe(0);
  });
});
