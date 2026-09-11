import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ currentBookId: "book", playState: "playing" }));
vi.mock("@/stores/tts-store", () => ({ useTTSStore: { getState: () => state } }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("opens the sheet only for an active session and preserves pause when reopening", async () => {
  vi.stubEnv("EXPO_PUBLIC_AUDIOBOOK_PLAYER_ENABLED", "true");
  const { openAudiobookPlayerFromReader, AUDIOBOOK_PLAYER_ENABLED } = await import(
    "../audiobook-player"
  );
  expect(AUDIOBOOK_PLAYER_ENABLED).toBe(true);
  const open = vi.fn();
  const toggle = vi.fn();
  state.currentBookId = "book";
  for (const playState of ["playing", "paused", "loading"]) {
    state.playState = playState;
    await openAudiobookPlayerFromReader("book", toggle, open);
  }
  expect(open).toHaveBeenCalledTimes(3);
  expect(toggle).not.toHaveBeenCalled();
  state.playState = "stopped";
  await openAudiobookPlayerFromReader("book", toggle, open);
  expect(toggle).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(3);
  toggle.mockImplementation(() => {
    state.playState = "loading";
    state.currentBookId = "other";
  });
  await openAudiobookPlayerFromReader("other", toggle, open);
  expect(open).toHaveBeenCalledTimes(4);
});

it("keeps the old toggle action without opening a sheet when disabled", async () => {
  vi.stubEnv("EXPO_PUBLIC_AUDIOBOOK_PLAYER_ENABLED", "false");
  const { openAudiobookPlayerFromReader, AUDIOBOOK_PLAYER_ENABLED } = await import(
    "../audiobook-player"
  );
  expect(AUDIOBOOK_PLAYER_ENABLED).toBe(false);
  const toggle = vi.fn();
  const open = vi.fn();
  await openAudiobookPlayerFromReader("book", toggle, open);
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
