import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ currentBookId: "book", playState: "playing" }));
vi.mock("@/stores/tts-store", () => ({ useTTSStore: { getState: () => state } }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("opens the sheet without restarting a live session of the same book", async () => {
  vi.stubEnv("EXPO_PUBLIC_AUDIOBOOK_PLAYER_ENABLED", "true");
  const { openAudiobookPlayerFromReader, AUDIOBOOK_PLAYER_ENABLED } = await import(
    "../audiobook-player"
  );
  expect(AUDIOBOOK_PLAYER_ENABLED).toBe(true);
  const open = vi.fn();
  const start = vi.fn();
  state.currentBookId = "book";
  // Playing, loading and paused sessions keep their audio: the sheet only shows them.
  for (const playState of ["playing", "paused", "loading"]) {
    state.playState = playState;
    await openAudiobookPlayerFromReader("book", start, open, vi.fn());
  }
  expect(open).toHaveBeenCalledTimes(3);
  expect(start).not.toHaveBeenCalled();

  // A stopped session has nothing to show, so it starts from the visible page.
  state.playState = "stopped";
  start.mockImplementation(() => {
    state.playState = "loading";
  });
  await openAudiobookPlayerFromReader("book", start, open, vi.fn());
  expect(start).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(4);

  // Another book's session is replaced by this book's visible page.
  state.playState = "playing";
  state.currentBookId = "other";
  start.mockImplementation(() => {
    state.playState = "loading";
    state.currentBookId = "book";
  });
  await openAudiobookPlayerFromReader("book", start, open, vi.fn());
  expect(start).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenCalledTimes(5);
});

it("uses the legacy toggle without starting a page or opening a sheet when disabled", async () => {
  vi.stubEnv("EXPO_PUBLIC_AUDIOBOOK_PLAYER_ENABLED", "false");
  const { openAudiobookPlayerFromReader, AUDIOBOOK_PLAYER_ENABLED } = await import(
    "../audiobook-player"
  );
  expect(AUDIOBOOK_PLAYER_ENABLED).toBe(false);
  const toggle = vi.fn();
  const open = vi.fn();
  const start = vi.fn();
  await openAudiobookPlayerFromReader("book", start, open, toggle);
  expect(start).not.toHaveBeenCalled();
  expect(toggle).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
});

vi.mock("expo", () => ({ requireNativeView: () => "NativeToolbar" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it.each(["true", "false"])(
  "keeps native toolbar presentation consistent with the %s flag",
  async (flag) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubEnv("EXPO_PUBLIC_AUDIOBOOK_PLAYER_ENABLED", flag);
    const { ReaderToolbar } = await import("@/screens/reader/ReaderToolbar.ios");
    const enabled = flag === "true";
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        createElement(ReaderToolbar, {
          tintColor: "#000",
          isDark: false,
          speechState: "playing",
          speechSheetSourceId: "audio-source",
          charactersSheetSourceId: "characters-source",
          onSpeechPress: vi.fn(),
          onCharactersPress: vi.fn(),
        }),
      );
    });
    try {
      const native = tree.root.findByType("NativeToolbar" as never);
      expect(native.props.speechActive).toBe(!enabled);
      expect(native.props.speechLabel).toBe(enabled ? "reader.audio" : "reader.listen");
      expect(native.props.speechSheetSourceId).toBe(enabled ? "audio-source" : "");
      expect(native.props.charactersSheetSourceId).toBe("characters-source");
    } finally {
      act(() => tree.unmount());
    }
  },
);
