import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  synth: vi.fn(),
  queue: [] as { id: string; url: string }[],
  files: new Set<string>(),
  deleted: [] as string[],
  listeners: new Map<string, Set<(e: Record<string, unknown>) => void>>(),
}));
vi.mock("./media", () => ({ synthesizeNarraBookSpeech: runtime.synth }));
vi.mock("./scene-audio", () => ({ getNarratorVoice: () => "Che" }));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(public uri: string) {}
    get exists() {
      return runtime.files.has(this.uri);
    }
    delete() {
      runtime.files.delete(this.uri);
      runtime.deleted.push(this.uri);
    }
  },
}));
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
  Platform: { OS: "ios" },
  Image: { resolveAssetSource: () => ({ uri: "art" }) },
}));
vi.mock("../platform/tts-silence-keeper", () => ({
  ensureSilenceFile: vi.fn(async () => "file:///silence.wav"),
}));
vi.mock("react-native-track-player", () => ({
  Event: {
    PlaybackActiveTrackChanged: "track",
    PlaybackState: "state",
    PlaybackQueueEnded: "end",
    RemoteSeek: "seek",
  },
  State: {
    Playing: "playing",
    Paused: "paused",
    Ended: "ended",
    Stopped: "stopped",
    Error: "error",
  },
  default: {
    reset: vi.fn(async () => {
      runtime.queue = [];
    }),
    stop: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    setRate: vi.fn(async () => {}),
    add: vi.fn(async (track) => {
      await Promise.resolve();
      runtime.queue.push(track);
    }),
    getQueue: vi.fn(async () => runtime.queue),
    getActiveTrack: vi.fn(async () => runtime.queue[0]),
    getPlaybackState: vi.fn(async () => ({ state: "playing" })),
    getProgress: vi.fn(async () => ({ position: 0, duration: 100 })),
    retry: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    seekTo: vi.fn(async () => {}),
    addEventListener: (event: string, callback: (e: Record<string, unknown>) => void) => {
      const set = runtime.listeners.get(event) ?? new Set();
      set.add(callback);
      runtime.listeners.set(event, set);
      return { remove: () => set.delete(callback) };
    },
  },
}));
import { DEFAULT_TTS_CONFIG } from "@readany/core/tts";
vi.mock("@/stores/persist", () => ({
  withPersist: <T extends object>(_key: string, creator: import("zustand").StateCreator<T>) =>
    creator,
}));
vi.mock("../platform/expo-speech-player", () => ({ ExpoSpeechTTSPlayer: class {} }));
vi.mock("../platform/system-tts-synthesis", () => ({ canUseSystemTtsSynthesis: () => false }));
vi.mock("../platform/track-player-cloud-tts-player", () => ({
  TrackPlayerCloudTTSPlayer: class {},
}));
vi.mock("../platform/track-player-dashscope-player", () => ({
  TrackPlayerDashScopeTTSPlayer: class {},
}));
vi.mock("../platform/track-player-system-player", () => ({ TrackPlayerSystemTTSPlayer: class {} }));
import TrackPlayer from "react-native-track-player";
import { TrackPlayerEdgeTTSPlayer } from "../platform/track-player-edge-player";
import { NarraServiceError } from "./errors";
import type { NarraCharacter } from "./types";
import { clearReaderVoicePlan, primeReaderVoicePlan } from "./voice-markup";
let player: TrackPlayerEdgeTTSPlayer;
const flush = async () => {
  for (let i = 0; i < 150; i++) await Promise.resolve();
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  runtime.synth.mockReset();
  runtime.queue = [];
  runtime.files.clear();
  runtime.deleted = [];
  runtime.listeners.clear();
  clearReaderVoicePlan();
  player = new TrackPlayerEdgeTTSPlayer();
  runtime.synth.mockImplementation(async (text: string) => {
    const uri = `file:///${text}.wav`;
    runtime.files.add(uri);
    return uri;
  });
});
afterEach(async () => {
  player.stop();
  await flush();
  vi.useRealTimers();
});
describe("book TTS playback integration", () => {
  it("keeps sentence order, buffers eight, and applies speed only in the synthesis request", async () => {
    const sentences = Array.from({ length: 10 }, (_, i) => `Sentence ${i}.`);
    await player.speak(sentences, { ...DEFAULT_TTS_CONFIG, rate: 1.5 });
    await flush();
    expect(runtime.queue.map((item) => item.id)).toEqual(sentences.map((_, i) => `tts-chunk-${i}`));
    expect(TrackPlayer.play).toHaveBeenCalledTimes(1);
    expect(TrackPlayer.setRate).toHaveBeenCalledWith(1);
    expect(runtime.synth).toHaveBeenCalledWith(
      sentences[0],
      "Che",
      expect.objectContaining({ rate: 1.5, signal: expect.any(AbortSignal) }),
    );
    player.stop();
    await flush();
    expect(runtime.files.size).toBe(0);
  });
  it("has at most three requests in flight, preserving order when later sentences finish first", async () => {
    const pending: ((uri: string) => void)[] = [];
    runtime.synth.mockImplementation(() => new Promise<string>((resolve) => pending.push(resolve)));
    await player.speak(["0", "1", "2", "3", "4", "5", "6", "7"], DEFAULT_TTS_CONFIG);
    await flush();
    expect(pending).toHaveLength(3);
    expect(TrackPlayer.play).not.toHaveBeenCalled();
    pending[2]("file:///2.wav");
    pending[1]("file:///1.wav");
    await flush();
    expect(runtime.queue).toHaveLength(0);
    expect(pending).toHaveLength(3);
    pending[0]("file:///0.wav");
    await flush();
    expect(runtime.queue.map((t) => t.id)).toEqual(["tts-chunk-0", "tts-chunk-1", "tts-chunk-2"]);
    expect(pending).toHaveLength(6);
    expect(TrackPlayer.play).not.toHaveBeenCalled();
    pending[3]("file:///3.wav");
    pending[4]("file:///4.wav");
    pending[5]("file:///5.wav");
    await flush();
    pending[6]("file:///6.wav");
    pending[7]("file:///7.wav");
    await flush();
    expect(TrackPlayer.play).toHaveBeenCalledTimes(1);
  });
  it("uses the character override for a known speaker and narrator for narration/unknown speakers", async () => {
    const character: NarraCharacter = {
      id: "anna",
      name: "Анна",
      fullName: "Анна",
      gender: "female",
      role: "",
      voice: "Che",
      voiceOverride: "Ste",
      traits: [],
      speechStyle: "",
      speechExamples: [],
      appearancePrompt: "",
      unlockProgress: 0,
    };
    const sentences = ["Утром светило солнце.", "— Пойдём, — сказала Анна.", "— Куда?"];
    primeReaderVoicePlan(sentences, [character], "She");
    await player.speak(sentences, DEFAULT_TTS_CONFIG);
    await flush();
    expect(runtime.synth.mock.calls.map((args) => args[1])).toEqual(["She", "Ste", "She"]);
  });
  it("aborts Stop, discards a late file, and does not let an old producer stop the new session", async () => {
    let finish!: (uri: string) => void;
    runtime.synth.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await player.speak(["old"], DEFAULT_TTS_CONFIG);
    await flush();
    const signal = runtime.synth.mock.calls[0][2].signal as AbortSignal;
    player.stop();
    expect(signal.aborted).toBe(true);
    await player.speak(["new"], DEFAULT_TTS_CONFIG);
    await flush();
    runtime.files.add("file:///old.wav");
    finish("file:///old.wav");
    await flush();
    expect(runtime.deleted).toContain("file:///old.wav");
    expect(runtime.queue.map((t) => t.url)).toEqual(["file:///new.wav"]);
    expect(TrackPlayer.play).toHaveBeenCalledTimes(1);
    player.append(["next"]);
    await flush();
    expect(runtime.queue).toHaveLength(2);
  });
  it("retries a limited number of times, then stops and cleans up", async () => {
    runtime.synth.mockRejectedValue(new NarraServiceError("RATE", "rate limited"));
    const state = vi.fn();
    player.onStateChange = state;
    await player.speak(["text"], DEFAULT_TTS_CONFIG);
    await vi.advanceTimersByTimeAsync(6000);
    await flush();
    expect(runtime.synth).toHaveBeenCalledTimes(5);
    expect(state).toHaveBeenLastCalledWith("stopped");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("honors Retry-After for rate limits and adds no paid request before it expires", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    runtime.synth
      .mockRejectedValueOnce(
        new NarraServiceError("RATE", "rate limited", undefined, undefined, "HTTP_429", 12_000),
      )
      .mockImplementationOnce(async () => {
        runtime.files.add("file:///ready.wav");
        return "file:///ready.wav";
      });
    await player.speak(["text"], DEFAULT_TTS_CONFIG);
    await flush();
    await vi.advanceTimersByTimeAsync(11_999);
    expect(runtime.synth).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(runtime.synth).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["AUTH", "HTTP_401"],
    ["REQUEST", "HTTP_400"],
    ["SERVICE", "HTTP_500"],
  ] as const)("does not retry terminal %s/%s speech failures", async (code, backendCode) => {
    runtime.synth.mockRejectedValue(
      new NarraServiceError(code, "terminal", undefined, undefined, backendCode),
    );
    await player.speak(["text"], DEFAULT_TTS_CONFIG);
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(runtime.synth).toHaveBeenCalledTimes(1);
  });
  it("cancels retry delays without requesting another paid segment", async () => {
    runtime.synth.mockRejectedValue(new Error("network"));
    await player.speak(["text"], DEFAULT_TTS_CONFIG);
    await flush();
    player.stop();
    await vi.advanceTimersByTimeAsync(10000);
    await flush();
    expect(runtime.synth).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("book TTS config changes", () => {
  it.each([false, true])(
    "resumes with the correct SSML rate after a paused config change: %s",
    async (changed) => {
      const { useTTSStore, setTTSPlayerFactories } = await import("@/stores/tts-store");
      const fake = {
        speak: vi.fn(async () => {}),
        append: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
      };
      setTTSPlayerFactories({ createEdgeTTS: () => fake });
      useTTSStore.setState({ config: { ...DEFAULT_TTS_CONFIG, rate: 1 }, playState: "stopped" });
      try {
        useTTSStore.getState().play(["first", "second"]);
        useTTSStore.getState().pause();
        useTTSStore.getState().updateConfig({ rate: changed ? 1.5 : 1 });
        expect(useTTSStore.getState().playState).toBe("paused");
        expect(fake.speak).toHaveBeenCalledTimes(1);
        useTTSStore.getState().resume();
        if (changed) {
          expect(fake.resume).not.toHaveBeenCalled();
          expect(fake.speak).toHaveBeenCalledTimes(2);
          expect(fake.speak).toHaveBeenLastCalledWith(
            ["first", "second"],
            expect.objectContaining({ rate: 1.5 }),
          );
        } else {
          expect(fake.resume).toHaveBeenCalledTimes(1);
          expect(fake.speak).toHaveBeenCalledTimes(1);
        }
      } finally {
        useTTSStore.getState().stop();
        setTTSPlayerFactories({});
      }
    },
  );
});
