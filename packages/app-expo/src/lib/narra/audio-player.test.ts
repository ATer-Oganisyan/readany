import { createAudioPlayer } from "expo-audio";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NarraAudioPlayer } from "./audio-player";

vi.mock("expo-audio", () => ({ createAudioPlayer: vi.fn() }));

describe("NarraAudioPlayer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the stop path without reporting natural completion", () => {
    const onFinished = vi.fn();
    const onStopped = vi.fn();
    const removeListener = vi.fn();
    const nativePlayer = {
      addListener: vi.fn(() => ({ remove: removeListener })),
      play: vi.fn(),
      pause: vi.fn(),
      remove: vi.fn(),
    };
    vi.mocked(createAudioPlayer).mockReturnValueOnce(
      nativePlayer as unknown as ReturnType<typeof createAudioPlayer>,
    );

    const player = new NarraAudioPlayer();
    player.play("file:///scene.wav", onFinished, onStopped);
    player.stop();

    expect(onStopped).toHaveBeenCalledOnce();
    expect(onFinished).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledOnce();
    expect(nativePlayer.remove).toHaveBeenCalledOnce();
  });

  it("reports natural completion without calling the stop callback", () => {
    const onFinished = vi.fn();
    const onStopped = vi.fn();
    let statusListener: ((status: { didJustFinish: boolean }) => void) | undefined;
    const nativePlayer = {
      addListener: vi.fn((_event, listener) => {
        statusListener = listener;
        return { remove: vi.fn() };
      }),
      play: vi.fn(),
      pause: vi.fn(),
      remove: vi.fn(),
    };
    vi.mocked(createAudioPlayer).mockReturnValueOnce(
      nativePlayer as unknown as ReturnType<typeof createAudioPlayer>,
    );

    const player = new NarraAudioPlayer();
    player.play("file:///scene.wav", onFinished, onStopped);
    statusListener?.({ didJustFinish: true });

    expect(onFinished).toHaveBeenCalledOnce();
    expect(onStopped).not.toHaveBeenCalled();
  });
});
