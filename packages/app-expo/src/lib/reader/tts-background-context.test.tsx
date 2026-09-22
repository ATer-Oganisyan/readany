import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { useReaderBridge } from "../../hooks/use-reader-bridge";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
});

// Characterizes the bridge failure, not OS suspension: native WebView is absent.
it.each([false, true])(
  "distinguishes a timeout from a successful reader reply: %s",
  async (late) => {
    vi.useFakeTimers();
    let bridge!: ReturnType<typeof useReaderBridge>;
    function Probe() {
      bridge = useReaderBridge({});
      return null;
    }
    await act(async () => {
      renderer = create(createElement(Probe));
    });
    const resolved = vi.fn();
    const request = bridge.getTTSSegmentContext("anchor", 0, 72).then(resolved);
    await vi.advanceTimersByTimeAsync(late ? 4_000 : 3_999);
    if (late)
      expect(resolved).toHaveBeenCalledWith({
        before: [],
        after: [],
        error: "tts-context-timeout",
      });
    else expect(resolved).not.toHaveBeenCalled();
    const next = [{ text: "Next sentence", cfi: "next" }];
    bridge.handleMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: "ttsSegmentContext",
          before: [],
          after: next,
        }),
      },
    });
    await request;
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(resolved).toHaveBeenCalledWith({
      before: [],
      after: late ? [] : next,
      ...(late ? { error: "tts-context-timeout" } : {}),
    });
    if (late) {
      const retry = bridge.getTTSSegmentContext("anchor", 0, 72);
      bridge.handleMessage({
        nativeEvent: {
          data: JSON.stringify({ type: "ttsSegmentContext", before: [], after: next }),
        },
      });
      await expect(retry).resolves.toEqual({ before: [], after: next });
    }
  },
);
