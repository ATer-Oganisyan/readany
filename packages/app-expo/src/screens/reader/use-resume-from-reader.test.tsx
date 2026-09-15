import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/stores/tts-store", async () => {
  const { createStore } = await import("zustand/vanilla");
  return {
    useTTSStore: createStore(() => ({
      currentBookId: "book",
      playState: "playing",
      resumeFromReader: null,
    })),
  };
});
import { useTTSStore } from "@/stores/tts-store";
import { useResumeFromReader } from "./use-resume-from-reader";
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  useTTSStore.setState({ currentBookId: "book", playState: "playing", resumeFromReader: null });
});
function Reader({ cfi, start }: { cfi: string; start: (isCurrent: () => boolean) => Promise<void> }) {
  useResumeFromReader("book", cfi, true, start);
  return null;
}
it("restarts after navigation and prevents duplicate Play requests", async () => {
  const start = vi.fn(() => new Promise<void>(() => {}));
  await act(async () => {
    renderer = create(createElement(Reader, { cfi: "a", start }));
  });
  useTTSStore.setState({ playState: "paused" });
  await act(async () => {
    renderer?.update(createElement(Reader, { cfi: "b", start }));
  });
  expect(useTTSStore.getState().resumeFromReader?.()).toBe(true);
  expect(useTTSStore.getState().resumeFromReader?.()).toBe(true);
  expect(start).toHaveBeenCalledTimes(1);
});
it("captures the position at pause, not at playback start", async () => {
  const start = vi.fn(async () => {});
  await act(async () => {
    renderer = create(createElement(Reader, { cfi: "a", start }));
  });
  await act(async () => {
    renderer?.update(createElement(Reader, { cfi: "b", start }));
  });
  useTTSStore.setState({ playState: "paused" });
  expect(useTTSStore.getState().resumeFromReader?.()).toBe(false);
  expect(start).not.toHaveBeenCalled();
});
it("ignores other books and unregisters when the reader closes", async () => {
  const start = vi.fn(async () => {});
  await act(async () => {
    renderer = create(createElement(Reader, { cfi: "a", start }));
  });
  useTTSStore.setState({ playState: "paused" });
  await act(async () => {
    renderer?.update(createElement(Reader, { cfi: "b", start }));
  });
  useTTSStore.setState({ currentBookId: "other" });
  expect(useTTSStore.getState().resumeFromReader?.()).toBe(false);
  await act(async () => renderer?.unmount());
  renderer = undefined;
  expect(useTTSStore.getState().resumeFromReader).toBeNull();
});

it.each(["stop", "other book", "unmount"])("cancels pending playback after %s", async (action) => {
  let finish!: () => void;
  const play = vi.fn();
  const start = async (isCurrent: () => boolean) => {
    await new Promise<void>((resolve) => { finish = resolve; });
    if (isCurrent()) play();
  };
  await act(async () => { renderer = create(createElement(Reader, { cfi: "a", start })); });
  useTTSStore.setState({ playState: "paused" });
  await act(async () => { renderer?.update(createElement(Reader, { cfi: "b", start })); });
  expect(useTTSStore.getState().resumeFromReader?.()).toBe(true);
  if (action === "stop") useTTSStore.setState({ playState: "stopped" });
  if (action === "other book") useTTSStore.setState({ currentBookId: "other" });
  if (action === "unmount") await act(async () => renderer?.unmount());
  await act(async () => finish());
  expect(play).not.toHaveBeenCalled();
});
