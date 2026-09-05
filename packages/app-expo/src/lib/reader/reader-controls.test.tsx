import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useReaderControls } from "../../hooks/use-reader-controls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let current: ReturnType<typeof useReaderControls>;
let tree: ReactTestRenderer;
function Harness({ focused = true, loading = false }) {
  current = useReaderControls(focused, loading);
  return null;
}
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  vi.useRealTimers();
});

it("keeps explicitly opened controls available until the reader dismisses them", async () => {
  await act(async () => {
    tree = create(<Harness />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(current.showControls).toBe(false);
  await act(async () => current.toggleControls());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(current.showControls).toBe(true);
  await act(async () => current.toggleControls());
  expect(current.showControls).toBe(false);
});

it("keeps exit controls visible during loading, then clears introductory chrome", async () => {
  await act(async () => {
    tree = create(<Harness loading />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(current.showControls).toBe(true);
  await act(async () => tree.update(<Harness />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(current.showControls).toBe(false);
});

it("keeps controls requested by audio preparation visible past the intro timeout", async () => {
  await act(async () => {
    tree = create(<Harness />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  await act(async () => current.setShowControls(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(current.showControls).toBe(true);
  await act(async () => current.toggleControls());
  expect(current.showControls).toBe(false);
});

it("cancels the initial timer on a manual toggle, blur and unmount", async () => {
  await act(async () => {
    tree = create(<Harness />);
  });
  await act(async () => current.toggleControls());
  await act(async () => current.toggleControls());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(current.showControls).toBe(true);
  await act(async () => tree.update(<Harness focused={false} />));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => tree.update(<Harness />));
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => tree.unmount());
  expect(vi.getTimerCount()).toBe(0);
});
