import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  state: "playing",
  buffering: false,
  seek: vi.fn(async () => {}),
}));
vi.mock("@/stores/tts-store", () => ({
  useTTSStore: (select: (state: { isBuffering: boolean }) => unknown) =>
    select({ isBuffering: runtime.buffering }),
}));
vi.mock("react-native-track-player", () => ({
  State: { Buffering: "buffering", Loading: "loading" },
  usePlaybackState: () => ({ state: runtime.state }),
  useProgress: () => ({ position: 10, duration: 100 }),
}));
vi.mock("@/lib/platform/tts-track-controls", () => ({
  seekActiveTTS: runtime.seek,
  seekActiveTTSBy: runtime.seek,
}));
import { useTTSNativePlayer } from "../../components/reader/tts/useTTSNativePlayer";
// React's renderer requires this flag for asynchronous hook updates.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let player: ReturnType<typeof useTTSNativePlayer>;
let renderer: ReturnType<typeof create>;
function Harness({ state = "playing" }: { state?: "playing" | "paused" }) {
  player = useTTSNativePlayer(state, () => {});
  return null;
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  runtime.state = "playing";
  runtime.buffering = false;
  vi.clearAllMocks();
  vi.useRealTimers();
});
describe("loader during scrubbing", () => {
  it("starts loading only after release and waits for an unfinished seek", async () => {
    let finish!: () => void;
    runtime.seek.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      renderer = create(<Harness />);
    });
    await act(async () => player.beginSeeking());
    expect(player.isLoading).toBe(false);
    await act(async () => {
      player.setPosition(50);
      player.commitSeeking();
    });
    expect(runtime.seek).toHaveBeenCalledWith(50);
    expect(player.isLoading).toBe(true);
    await act(async () => finish());
    expect(player.isLoading).toBe(false);
  });
  it("does not show playing/loading when seeking while paused", async () => {
    await act(async () => {
      renderer = create(<Harness state="paused" />);
    });
    await act(async () => player.beginSeeking());
    expect(player.isLoading).toBe(false);
    await act(async () => player.commitSeeking());
    expect(player.isPlaying).toBe(false);
  });
  it("shows native rebuffering only while playback is intended", async () => {
    vi.useFakeTimers();
    runtime.state = "buffering";
    await act(async () => {
      renderer = create(<Harness />);
    });
    expect(player.isLoading).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(499);
    });
    expect(player.isLoading).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(player.isLoading).toBe(true);
    await act(async () => renderer.update(<Harness state="paused" />));
    expect(player.isLoading).toBe(false);
  });
  it("resets the 500ms threshold after a brief buffering event", async () => {
    vi.useFakeTimers();
    runtime.state = "buffering";
    await act(async () => {
      renderer = create(<Harness />);
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    runtime.state = "playing";
    await act(async () => renderer.update(<Harness />));
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(player.isLoading).toBe(false);
    runtime.state = "loading";
    await act(async () => renderer.update(<Harness />));
    await act(async () => {
      vi.advanceTimersByTime(499);
    });
    expect(player.isLoading).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(player.isLoading).toBe(true);
    runtime.state = "playing";
    await act(async () => renderer.update(<Harness />));
    expect(player.isLoading).toBe(false);
  });
});

it("shows synthesis buffering even while native plays silence, and clears on pause/recovery", async () => {
  runtime.buffering = true;
  await act(async () => {
    renderer = create(<Harness />);
  });
  expect(player.isLoading).toBe(true);
  await act(async () => renderer.update(<Harness state="paused" />));
  expect(player.isLoading).toBe(false);
  runtime.buffering = false;
  await act(async () => renderer.update(<Harness />));
  expect(player.isLoading).toBe(false);
});
