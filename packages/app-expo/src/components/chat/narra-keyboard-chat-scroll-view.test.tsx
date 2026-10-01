import { createElement, createRef } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";

vi.mock("react-native-keyboard-controller", () => ({ KeyboardChatScrollView: "KeyboardScroll" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("react-native-reanimated", async () => {
  const { useRef } = await import("react");
  return {
    useAnimatedRef: () => useRef(vi.fn()).current,
    useSharedValue: (value: unknown) => useRef({ value }).current,
    useAnimatedReaction: vi.fn(),
    withTiming: vi.fn((value) => value),
    cancelAnimation: vi.fn(),
    scrollTo: vi.fn(),
    Easing: { bezier: (...curve: number[]) => curve },
    ReduceMotion: { System: "system" },
  };
});
import { cancelAnimation, withTiming } from "react-native-reanimated";
import { NarraKeyboardChatScrollView } from "./narra-keyboard-chat-scroll-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("animates to the measured end including keyboard inset and stops on drag", () => {
  const animateToEndRef = createRef<(() => void) | null>();
  const scrollOffsetRef = { current: 200 };
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(
      createElement(NarraKeyboardChatScrollView, {
        animateToEndRef,
        scrollOffsetRef,
        chatScrollViewRef: { current: null },
        distanceFromBottomRef: { current: 0 },
      }),
    );
  });
  if (!tree) throw new Error("Scroll view did not mount");
  const scroll = tree.root.findByType("KeyboardScroll" as never);
  act(() => {
    scroll.props.onLayout({ nativeEvent: { layout: { height: 600 } } });
    scroll.props.onContentSizeChange(400, 1000);
    scroll.props.onContentInsetChange({ top: 0, bottom: 300 });
    animateToEndRef.current?.();
  });
  expect(withTiming).toHaveBeenCalledWith(
    700,
    {
      duration: 150,
      easing: [0.42, 0, 0.58, 1],
      reduceMotion: "system",
    },
    expect.any(Function),
  );
  act(() => scroll.props.onScrollBeginDrag({}));
  expect(cancelAnimation).toHaveBeenCalledTimes(1);
  act(() => tree?.unmount());
  expect(animateToEndRef.current).toBeNull();
});
