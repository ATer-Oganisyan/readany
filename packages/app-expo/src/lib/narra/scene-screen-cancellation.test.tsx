import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NarraSceneAudioSegment } from "./types";

const mocks = vi.hoisted(() => ({
  scenario: vi.fn(),
  speech: vi.fn(),
  cache: vi.fn(),
  play: vi.fn(),
  stop: vi.fn(),
  report: vi.fn(),
  validate: vi.fn(),
  cached: undefined as undefined | { segments: NarraSceneAudioSegment[]; createdAt: number },
  stopped: undefined as undefined | (() => void),
  blur: undefined as undefined | (() => void),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
  StyleSheet: { create: (x: unknown) => x, absoluteFill: {} },
}));
vi.mock("@/components/narra/NarraLoopVideo", () => ({ NarraLoopVideo: "Video" }));
vi.mock("@/components/ui/Icon", () => ({ ChevronRightIcon: "Icon" }));
vi.mock("@/components/ui/ScrollViewMarker", () => ({ ScrollViewMarker: "Marker" }));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("@/config/bundled-ai", () => ({ hasBundledOpenRouterKey: false }));
vi.mock("@/lib/analytics/telemetry", () => ({ recordTelemetry: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));
vi.mock("@/lib/narra/animate-openrouter", () => ({ animateNarraImage: vi.fn() }));
vi.mock("@/lib/narra/animate-prompt", () => ({ buildSceneMotionPrompt: vi.fn() }));
vi.mock("@/lib/narra/audio-player", () => ({
  NarraAudioPlayer: class {
    play(uri: string, finished: () => void, stopped: () => void) {
      mocks.stopped = stopped;
      mocks.play(uri, finished, stopped);
    }
    stop() {
      mocks.stop();
      const stopped = mocks.stopped;
      mocks.stopped = undefined;
      stopped?.();
    }
  },
}));
vi.mock("@/lib/narra/errors", () => ({
  NARRA_SAFETY_DECLINED_MESSAGE: "declined",
  NARRA_SCENE_SAFETY_RETRY_MESSAGE: "retry",
  reportNarraError: mocks.report,
}));
vi.mock("@/lib/narra/media", () => ({
  normalizePersistedNarraMediaUri: (uri: string) => uri,
  synthesizeNarraSpeech: mocks.speech,
}));
vi.mock("@/lib/narra/scene-audio", () => ({
  generateNarraAudioScenario: mocks.scenario, validateNarraSceneAudioSegments: mocks.validate,
}));
vi.mock("@/lib/narra/scene-image-openrouter", () => ({ generateNarraSceneImage: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/navigation/scroll-edge-effects", () => ({ NATIVE_SCROLL_EDGE_EFFECTS: {} }));
vi.mock("@/styles/theme", () => ({
  fontSize: {},
  headingFontFamily: "",
  radius: {},
  spacing: {},
  useTheme: () => ({ colors: {} }),
}));
vi.mock("@deslop/primitives/native", () => ({ interfaceFontFamily: {} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/stores", () => {
  const book = {
    characters: [],
    scenes: { one: { imageUri: "file://scene.png" }, two: { imageUri: "file://scene.png" } },
    get sceneAudios() { return { one: mocks.cached }; },
  };
  const state = { books: { book }, setScene: vi.fn(), setSceneAudio: mocks.cache };
  return { useNarraStore: (selector: (value: typeof state) => unknown) => selector(state) };
});
import { NarraSceneScreen } from "../../screens/NarraSceneScreen";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
const segment: NarraSceneAudioSegment = {
  type: "narration",
  characterId: null,
  speaker: "Рассказчик",
  voice: "Che",
  text: "Окно открыто.",
};
const props = (sourceKey = "one") =>
  ({
    route: { params: { bookId: "book", sourceKey, chapter: "Глава", excerpt: "Окно открыто." } },
    navigation: {
      setOptions: vi.fn(),
      addListener: (_name: string, cb: () => void) => {
        mocks.blur = cb;
        return () => {
          mocks.blur = undefined;
        };
      },
    },
  }) as unknown as Parameters<typeof NarraSceneScreen>[0];
const button = (label: string) => tree.root.findByProps({ accessibilityLabel: label });
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.blur = undefined;
  mocks.stopped = undefined;
  mocks.cached = undefined;
  mocks.validate.mockImplementation((segments) => segments.map((item: NarraSceneAudioSegment) => ({ ...item })));
  mocks.report.mockReturnValue({ message: "Unavailable", code: "SERVICE" });
  mocks.scenario.mockImplementation(() => new Promise(() => {}));
  mocks.speech.mockImplementation(() => new Promise(() => {}));
  await act(async () => {
    tree = create(<NarraSceneScreen {...props()} />);
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
});

it("preparing keeps an enabled Stop and aborts the scenario request", async () => {
  await act(async () => {
    button("narra.sceneVoice").props.onPress();
  });
  const stop = button("narra.stopVoiceSample");
  expect(stop.props.disabled).not.toBe(true);
  await act(async () => {
    stop.props.onPress();
  });
  expect(mocks.scenario.mock.calls[0][2]?.signal?.aborted).toBe(true);
  expect(button("narra.sceneVoice")).toBeDefined();
});

it.each(["unmount", "blur", "context"])(
  "%s aborts pending speech and rejects late cache publication",
  async (leave) => {
    mocks.scenario.mockResolvedValue([segment]);
    let finish!: (value: string) => void;
    mocks.speech.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      button("narra.sceneVoice").props.onPress();
    });
    expect(mocks.speech).toHaveBeenCalledOnce();
    const writesBefore = mocks.cache.mock.calls.length;
    await act(async () => {
      if (leave === "unmount") tree.unmount();
      if (leave === "blur") mocks.blur?.();
      if (leave === "context") tree.update(<NarraSceneScreen {...props("two")} />);
    });
    expect(mocks.speech.mock.calls[0][2]?.signal?.aborted).toBe(true);
    await act(async () => {
      finish("file://late.mp3");
    });
    expect(mocks.cache).toHaveBeenCalledTimes(writesBefore);
    expect(mocks.play).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  },
);

it("two taps before rerender cancel one run instead of starting two paid requests", async () => {
  const press = button("narra.sceneVoice").props.onPress;
  await act(async () => {
    press();
    press();
  });
  expect(mocks.scenario).toHaveBeenCalledOnce();
  expect(mocks.scenario.mock.calls[0][2]?.signal?.aborted).toBe(true);
});

it("Stop cancels prefetch while playing and a late fragment cannot overwrite the next run", async () => {
  mocks.scenario.mockResolvedValue([segment, { ...segment, text: "Второй фрагмент." }]);
  let oldFinish!: (uri: string) => void;
  mocks.speech.mockResolvedValueOnce("file://first.mp3").mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        oldFinish = resolve;
      }),
  );
  await act(async () => {
    button("narra.sceneVoice").props.onPress();
  });
  expect(mocks.play).toHaveBeenCalledOnce();
  expect(mocks.speech).toHaveBeenCalledTimes(2);
  const oldSignal = mocks.speech.mock.calls[1][2].signal;
  await act(async () => {
    button("narra.stopVoiceSample").props.onPress();
  });
  expect(oldSignal.aborted).toBe(true);
  mocks.scenario.mockImplementation(() => new Promise(() => {}));
  await act(async () => {
    button("narra.sceneVoice").props.onPress();
  });
  const newSignal = mocks.scenario.mock.calls[1][2].signal;
  const writes = mocks.cache.mock.calls.length;
  await act(async () => {
    oldFinish("file://late-second.mp3");
  });
  expect(newSignal.aborted).toBe(false);
  expect(mocks.cache).toHaveBeenCalledTimes(writes);
  expect(mocks.play).toHaveBeenCalledOnce();
  expect(mocks.report).not.toHaveBeenCalled();
  expect(button("narra.stopVoiceSample")).toBeDefined();
});

it("a successful scene plays each segment once and restores the start button", async () => {
  mocks.scenario.mockResolvedValue([segment, { ...segment, text: "Второй фрагмент." }]);
  mocks.speech.mockResolvedValueOnce("file://first.mp3").mockResolvedValueOnce("file://second.mp3");
  await act(async () => {
    button("narra.sceneVoice").props.onPress();
  });
  expect(mocks.play.mock.calls[0][0]).toBe("file://first.mp3");
  await act(async () => {
    mocks.play.mock.calls[0][1]();
  });
  expect(mocks.play.mock.calls[1][0]).toBe("file://second.mp3");
  await act(async () => {
    mocks.play.mock.calls[1][1]();
  });
  expect(mocks.speech).toHaveBeenCalledTimes(2);
  expect(button("narra.sceneVoice")).toBeDefined();
  expect(mocks.report).not.toHaveBeenCalled();
});

it("shows a visible retryable error instead of silently returning to idle", async () => {
  mocks.scenario.mockRejectedValue(new Error("Fixture provider unavailable"));
  await act(async () => { button("narra.sceneVoice").props.onPress(); });
  expect(tree.root.findByProps({ accessibilityRole: "alert" }).props.children).toBe("narra.sceneAudioFailed");
  expect(button("narra.sceneVoice")).toBeDefined();
  expect(mocks.speech).not.toHaveBeenCalled();
  await act(async () => {
    mocks.scenario.mockImplementation(() => new Promise(() => {}));
    button("narra.sceneVoice").props.onPress();
  });
  expect(tree.root.findAllByProps({ accessibilityRole: "alert" })).toHaveLength(0);
});

it("rejects invalid cached scenario before playback without a hidden paid repair", async () => {
  mocks.cached = { segments: [{ ...segment, audioUri: "file://wrong.mp3" }], createdAt: 1 };
  mocks.validate.mockImplementation(() => { throw new Error("Text mismatch"); });
  mocks.report.mockReturnValue({ code: "SERVICE", backendCode: "SCENE_AUDIO_TEXT_MISMATCH" });
  await act(async () => { tree.update(<NarraSceneScreen {...props()} />); });
  await act(async () => { button("narra.sceneVoice").props.onPress(); });
  expect(mocks.validate).toHaveBeenCalledWith(mocks.cached.segments, "Окно открыто.");
  expect(mocks.cache).toHaveBeenCalledWith("book", expect.objectContaining({ sourceKey: "one", segments: [] }));
  expect(mocks.scenario).not.toHaveBeenCalled();
  expect(mocks.speech).not.toHaveBeenCalled();
  expect(mocks.play).not.toHaveBeenCalled();
  expect(tree.root.findByProps({ accessibilityRole: "alert" }).props.children).toBe("narra.sceneAudioTextMismatch");
});
