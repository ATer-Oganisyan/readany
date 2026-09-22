import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock("react-native-track-player", () => ({
  default: { getProgress: vi.fn(async () => ({ position: 0, duration: 10 })) },
}));
vi.mock("@/stores", async () => {
  const { create } = await import("zustand");
  const { DEFAULT_TTS_CONFIG } = await import("@readany/core/tts");
  const useTTSStore = create((set) => ({
    playState: "stopped",
    currentBookId: "",
    currentChunkIndex: 0,
    totalChunks: 0,
    currentText: "",
    currentSegmentText: "",
    currentLocationCfi: "",
    config: DEFAULT_TTS_CONFIG,
    play: vi.fn((segments) =>
      set({
        playState: "playing",
        totalChunks: segments.length,
        currentSegmentText: segments[0].text,
      }),
    ),
    append: vi.fn(() => true),
    pause: () => set({ playState: "paused" }),
    resume: vi.fn(),
    stop: () => set({ playState: "stopped" }),
    updateConfig: vi.fn(),
    setOnEnd: (onEnd: (() => void) | null) => set({ onEnd }),
    setCurrentBook: (_title: string, _chapter: string, currentBookId: string) =>
      set({ currentBookId }),
    setCurrentLocation: (currentLocationCfi: string) => set({ currentLocationCfi }),
    jumpToChunk: vi.fn(),
    setPlayState: (playState: "playing" | "paused" | "stopped" | "loading") => set({ playState }),
    setNarrationChapter: vi.fn(),
  }));
  return { useTTSStore, useNarraStore: { getState: () => ({ narratorVoicePreference: "male" }) } };
});
vi.mock("@/stores/tts-store", async () => ({
  useTTSStore: (await import("@/stores")).useTTSStore,
}));
import { useTTSStore } from "@/stores";
import { type TTSBridgeRef, useReaderTTS } from "./useReaderTTS";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("retries an unavailable context without caching it or jumping chapters", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("__DEV__", false);
  let unavailable = true;
  const context = vi.fn(async () =>
    unavailable
      ? { before: [], after: [], error: "tts-context-timeout" }
      : { before: [], after: [{ text: "next sentence", cfi: "next" }] },
  );
  const goToSection = vi.fn();
  const bridge = {
    getVisibleText: vi.fn(async () => "current sentence"),
    getVisibleTTSSegments: vi.fn(async () => [{ text: "current sentence", cfi: "anchor" }]),
    getTTSSegmentContext: context,
    getChapterParagraphs: vi.fn(async () => []),
    getSectionTTSSegments: vi.fn(async () => []),
    goToCFI: vi.fn(),
    goToSection,
    setTTSHighlight: vi.fn(),
    followTTSLocation: vi.fn(),
  } as unknown as TTSBridgeRef;
  const options = {
    bookId: "book",
    bookTitle: "Book",
    currentChapter: "Chapter",
    currentChapterHref: "",
    currentSectionIndex: 0,
    currentCfi: "anchor",
    webViewReady: false,
    showTTS: false,
    setShowTTS: vi.fn(),
    setShowControls: vi.fn(),
    bridgeRef: { current: bridge },
    toc: [],
    colors: { primary: "black", primary5: "gray" },
    goToHref: vi.fn(),
  };
  let reader!: ReturnType<typeof useReaderTTS>;
  function Probe() {
    reader = useReaderTTS(options);
    return null;
  }
  await act(async () => {
    renderer = create(createElement(Probe));
  });
  await act(async () => {
    await reader.startPageTTS();
  });
  expect(useTTSStore.getState().append).not.toHaveBeenCalled();
  expect(goToSection).not.toHaveBeenCalled();
  const callsBeforeRetry = context.mock.calls.length;
  unavailable = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(context.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  expect(useTTSStore.getState().append).toHaveBeenCalledWith([
    { text: "next sentence", cfi: "next" },
  ]);
  expect(reader.ttsSegments.map((segment) => segment.text)).toEqual([
    "current sentence",
    "next sentence",
  ]);
  expect(goToSection).not.toHaveBeenCalled();
  unavailable = true;
  await act(async () => {
    useTTSStore.setState({ playState: "stopped", currentChunkIndex: 1, totalChunks: 2 });
  });
  expect(useTTSStore.getState().playState).toBe("paused");
  expect(goToSection).not.toHaveBeenCalled();
  const callsAtPause = context.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(context).toHaveBeenCalledTimes(callsAtPause);
});
