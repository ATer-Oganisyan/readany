import { StrictMode, createElement, memo } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { NativeSegmentedPager } from "../../components/ui/native-segmented-pager";
import { SwipePressGuardProvider, useSwipePressGuard } from "../../components/ui/swipe-press-guard";
import { createSwipePressGuard } from "./swipe-press-guard";
import { type SwipeGuardEvent, createSwipePressGuardBinding } from "./swipe-press-guard-binding";

vi.mock("@/lib/narra/swipe-press-guard", () => import("./swipe-press-guard"));
vi.mock("@/lib/narra/swipe-press-guard-binding", () => import("./swipe-press-guard-binding"));
vi.mock("@/components/profile/NativeThemePicker", () => ({ NativeThemePicker: () => null }));
vi.mock("@/lib/haptics", () => ({ hapticSelection: vi.fn() }));
vi.mock("react-native", () => ({
  View: "View",
  Platform: { OS: "ios" },
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("react-native-pager-view", () => ({ default: "PagerView" }));

const touchEvent = (timestamp: number, identifier = 0, remainingTouches = 1) => ({
  nativeEvent: { identifier, timestamp, touches: Array(remainingTouches).fill({}) },
});
const scrollEvent = (timestamp: number) => ({ nativeEvent: { timestamp } });

function fixture() {
  const model = createSwipePressGuard();
  return {
    model,
    screen: createSwipePressGuardBinding(model),
    shelf: createSwipePressGuardBinding(model),
    book: createSwipePressGuardBinding(model),
  };
}

describe("swipe press guard ownership", () => {
  it("keeps the other owner's drag and this owner's momentum after drag end", () => {
    const { model, screen, shelf, book } = fixture();
    screen.scrollHandlers.onScrollBeginDrag(scrollEvent(10));
    shelf.scrollHandlers.onScrollBeginDrag(scrollEvent(11));
    shelf.scrollHandlers.onMomentumScrollBegin(scrollEvent(12));
    shelf.scrollHandlers.onScrollEndDrag(scrollEvent(13));
    expect(model.getSnapshot()).toMatchObject({ activeOwners: 2, activeMotions: 2 });
    expect(book.canPress()).toBe(false);
    shelf.scrollHandlers.onMomentumScrollEnd(scrollEvent(14));
    expect(model.getSnapshot()).toMatchObject({ activeOwners: 1, activeMotions: 1 });
    expect(book.canPress()).toBe(false);
    screen.scrollHandlers.onScrollEndDrag(scrollEvent(15));
    expect(model.getSnapshot()).toMatchObject({ activeOwners: 0, activeMotions: 0 });
  });

  it("rejects stale explicit leases, including an old end after screen reset", () => {
    const model = createSwipePressGuard();
    const owner = {};
    const older = model.begin(owner, "momentum", 10);
    const current = model.begin(owner, "momentum", 20);
    expect(model.end(older, 30)).toBe(false);
    expect(model.getSnapshot().activeMotions).toBe(1);
    model.reset();
    const afterReset = model.begin(owner, "momentum", 40);
    expect(model.end(current, 50)).toBe(false);
    expect(model.getSnapshot().activeMotions).toBe(1);
    expect(model.end(afterReset, 60)).toBe(true);
  });

  it("rejects a queued native end timestamp older than the current gesture", () => {
    const { model, shelf } = fixture();
    shelf.scrollHandlers.onMomentumScrollBegin(scrollEvent(10));
    shelf.scrollHandlers.onMomentumScrollEnd(scrollEvent(15));
    shelf.scrollHandlers.onMomentumScrollBegin(scrollEvent(30));
    shelf.scrollHandlers.onMomentumScrollEnd(scrollEvent(20));
    expect(model.getSnapshot().activeMotions).toBe(1);
    shelf.scrollHandlers.onMomentumScrollEnd(scrollEvent(40));
    expect(model.getSnapshot().activeMotions).toBe(0);
  });

  it("unmounting a card cannot release a scrolling shelf", () => {
    const { model, shelf, book } = fixture();
    shelf.scrollHandlers.onScrollBeginDrag(scrollEvent(10));
    book.dispose();
    expect(model.getSnapshot().activeMotions).toBe(1);
    shelf.dispose();
    expect(model.getSnapshot().activeMotions).toBe(0);
    shelf.scrollHandlers.onMomentumScrollBegin(scrollEvent(20));
    expect(model.getSnapshot().activeMotions).toBe(0);
  });

  it("survives effect cleanup/setup without leaving the observer disabled", () => {
    const { model, shelf } = fixture();
    shelf.dispose();
    shelf.activate();
    shelf.scrollHandlers.onScrollBeginDrag(scrollEvent(10));
    expect(model.getSnapshot().activeMotions).toBe(1);
  });
});

describe("swipe press guard touch actions", () => {
  it("does not turn a drag release into a tap after both end events", () => {
    const { screen, shelf, book } = fixture();
    const start = touchEvent(10);
    screen.touchHandlers.onStartShouldSetResponderCapture(start);
    shelf.touchHandlers.onTouchStart(start);
    shelf.scrollHandlers.onScrollBeginDrag(scrollEvent(20));
    shelf.scrollHandlers.onScrollEndDrag(scrollEvent(40));
    shelf.scrollHandlers.onMomentumScrollBegin(scrollEvent(41));
    screen.touchHandlers.onTouchEnd(touchEvent(42, 0, 0));
    shelf.scrollHandlers.onMomentumScrollEnd(scrollEvent(60));
    expect(book.canPress(touchEvent(42, 0, 0))).toBe(false);
  });

  it("blocks the touch stopping inertia but immediately allows the next press once", () => {
    const { model, screen, shelf, book } = fixture();
    const open = vi.fn();
    shelf.scrollHandlers.onMomentumScrollBegin(scrollEvent(10));
    const stopping = touchEvent(20);
    expect(screen.touchHandlers.onStartShouldSetResponderCapture(stopping)).toBe(false);
    shelf.touchHandlers.onTouchStart(stopping);
    // UIKit can omit momentum-end for an interrupted deceleration.
    expect(model.getSnapshot().activeMotions).toBe(0);
    screen.touchHandlers.onTouchEnd(touchEvent(21, 0, 0));
    if (book.canPress(touchEvent(21, 0, 0))) open();
    expect(open).not.toHaveBeenCalled();
    screen.touchHandlers.onStartShouldSetResponderCapture(touchEvent(22));
    shelf.touchHandlers.onTouchStart(touchEvent(22));
    screen.touchHandlers.onTouchEnd(touchEvent(23, 0, 0));
    if (book.canPress(touchEvent(23, 0, 0))) open();
    if (book.canPress(touchEvent(23, 0, 0))) open();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("preserves a stop touch when native momentum-end arrives in JS before touch-start", () => {
    const { screen, shelf, book } = fixture();
    shelf.scrollHandlers.onMomentumScrollBegin(scrollEvent(10));
    shelf.scrollHandlers.onMomentumScrollEnd(scrollEvent(25));
    // The touch occurred at 24, before momentum stopped; JS delivery was later.
    screen.touchHandlers.onStartShouldSetResponderCapture(touchEvent(24));
    shelf.touchHandlers.onTouchStart(touchEvent(24));
    expect(book.canPress(touchEvent(30, 0, 0))).toBe(false);
    screen.touchHandlers.onTouchEnd(touchEvent(30, 0, 0));
    screen.touchHandlers.onTouchStart(touchEvent(31));
    expect(book.canPress(touchEvent(32, 0, 0))).toBe(true);
  });

  it("allows a new touch immediately after natural deceleration ends", () => {
    const { screen, shelf, book } = fixture();
    shelf.scrollHandlers.onMomentumScrollBegin(scrollEvent(10));
    shelf.scrollHandlers.onMomentumScrollEnd(scrollEvent(20));
    screen.touchHandlers.onStartShouldSetResponderCapture(touchEvent(21));
    expect(book.canPress(touchEvent(22, 0, 0))).toBe(true);
  });

  it("does not lose a valid tap when an earlier native momentum-end reaches JS late", () => {
    const { screen, shelf, book } = fixture();
    shelf.scrollHandlers.onMomentumScrollBegin(scrollEvent(10));
    screen.touchHandlers.onStartShouldSetResponderCapture(touchEvent(30));
    shelf.touchHandlers.onTouchStart(touchEvent(30));
    // It physically ended at 20, before the user touched at 30.
    shelf.scrollHandlers.onMomentumScrollEnd(scrollEvent(20));
    expect(book.canPress(touchEvent(40, 0, 0))).toBe(true);
  });

  it("cancels only the touched observer and preserves rejection of its release", () => {
    const { model, screen, shelf, book } = fixture();
    screen.touchHandlers.onTouchStart(touchEvent(10));
    shelf.scrollHandlers.onScrollBeginDrag(scrollEvent(20));
    screen.beginSwipe();
    shelf.touchHandlers.onTouchCancel(touchEvent(30, 0, 0));
    expect(model.getSnapshot().activeMotions).toBe(1);
    expect(book.canPress(touchEvent(30, 0, 0))).toBe(false);
    screen.cancelSwipe();
    screen.touchHandlers.onTouchStart(touchEvent(31));
    expect(book.canPress(touchEvent(32, 0, 0))).toBe(true);
  });

  it("clears all leases on blur and rejects late events while inactive", () => {
    const { model, screen, shelf, book } = fixture();
    screen.touchHandlers.onTouchStart(touchEvent(10));
    shelf.scrollHandlers.onScrollBeginDrag(scrollEvent(11));
    screen.setEnabled(false);
    shelf.scrollHandlers.onMomentumScrollBegin(scrollEvent(20));
    expect(model.getSnapshot()).toMatchObject({ enabled: false, activeMotions: 0 });
    expect(book.canPress(touchEvent(30, 0, 0))).toBe(false);
    screen.setEnabled(true);
    expect(book.canPress(touchEvent(30, 0, 0))).toBe(false);
    screen.touchHandlers.onTouchStart(touchEvent(31));
    expect(book.canPress(touchEvent(32, 0, 0))).toBe(true);
  });

  it("ignores the old touch end when the native identifier is reused", () => {
    const { screen, book } = fixture();
    screen.touchHandlers.onTouchStart(touchEvent(10));
    screen.touchHandlers.onTouchEnd(touchEvent(20, 0, 0));
    screen.touchHandlers.onTouchStart(touchEvent(30));
    screen.touchHandlers.onTouchCancel(touchEvent(20, 0, 0));
    expect(book.canPress(touchEvent(20, 0, 0))).toBe(false);
    expect(book.canPress(touchEvent(40, 0, 0))).toBe(true);
  });

  it("does not let an old touch-cancel release the same owner's newer drag", () => {
    const { model, shelf } = fixture();
    shelf.touchHandlers.onTouchStart(touchEvent(10));
    shelf.scrollHandlers.onScrollBeginDrag(scrollEvent(11));
    shelf.touchHandlers.onTouchCancel(touchEvent(12, 0, 0));
    shelf.touchHandlers.onTouchStart(touchEvent(20));
    shelf.scrollHandlers.onScrollBeginDrag(scrollEvent(21));
    shelf.touchHandlers.onTouchCancel(touchEvent(12, 0, 0));
    expect(model.getSnapshot().activeMotions).toBe(1);
    shelf.touchHandlers.onTouchCancel(touchEvent(22, 0, 0));
    expect(model.getSnapshot().activeMotions).toBe(0);
  });

  it("deduplicates capture and bubble observers, including a second finger", () => {
    const { screen, shelf, book } = fixture();
    const start = touchEvent(10);
    screen.touchHandlers.onStartShouldSetResponderCapture(start);
    screen.touchHandlers.onTouchStart(start);
    shelf.touchHandlers.onTouchStart(start);
    const second = touchEvent(11, 1, 2);
    screen.touchHandlers.onStartShouldSetResponderCapture(second);
    shelf.touchHandlers.onTouchStart(second);
    screen.touchHandlers.onTouchEnd(touchEvent(12, 1, 1));
    screen.touchHandlers.onTouchEnd(touchEvent(13, 0, 0));
    expect(book.canPress(touchEvent(13, 0, 0))).toBe(false);
    screen.touchHandlers.onTouchStart(touchEvent(14));
    expect(book.canPress(touchEvent(15, 0, 0))).toBe(true);
  });

  it("leaves long press with Pressable and prevents a second action on release", () => {
    const { screen, book } = fixture();
    const longPress = vi.fn();
    const open = vi.fn();
    const start = touchEvent(10);
    screen.touchHandlers.onStartShouldSetResponderCapture(start);
    // The existing Pressable owns the long-press timer and invokes this boundary.
    if (book.canPress(start)) longPress();
    screen.touchHandlers.onTouchEnd(touchEvent(510, 0, 0));
    if (book.canPress(touchEvent(510, 0, 0))) open();
    expect(longPress).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("allows an independent accessibility activation after a cancelled touch", () => {
    const { screen, book } = fixture();
    screen.touchHandlers.onTouchStart(touchEvent(10));
    screen.touchHandlers.onTouchCancel(touchEvent(20, 0, 0));
    const accessibilityClick = { nativeEvent: { target: 123 } };
    expect(book.canPress(accessibilityClick)).toBe(true);
    expect(book.canPress(accessibilityClick)).toBe(false);
    expect(book.canPress({ nativeEvent: { target: 123 } })).toBe(true);
  });

  it("does not replay an accessibility activation or touch start rejected while blurred", () => {
    const { screen, book } = fixture();
    const oldStart = touchEvent(10);
    screen.touchHandlers.onTouchStart(oldStart);
    screen.setEnabled(false);
    const oldClick = { nativeEvent: { target: 123 } };
    expect(book.canPress(oldClick)).toBe(false);
    screen.setEnabled(true);
    screen.touchHandlers.onTouchStart(oldStart);
    expect(book.canPress(touchEvent(20, 0, 0))).toBe(false);
    expect(book.canPress(oldClick)).toBe(false);
    expect(book.canPress({ nativeEvent: { target: 123 } })).toBe(true);
    screen.touchHandlers.onTouchStart(touchEvent(21));
    expect(book.canPress(touchEvent(22, 0, 0))).toBe(true);
  });

  it("recognizes string native touch identifiers as touches, not accessibility clicks", () => {
    const { screen, shelf, book } = fixture();
    const start = { nativeEvent: { identifier: "0", timestamp: 10, touches: [{}] } };
    screen.touchHandlers.onTouchStart(start);
    shelf.scrollHandlers.onScrollBeginDrag(scrollEvent(20));
    shelf.scrollHandlers.onScrollEndDrag(scrollEvent(30));
    expect(book.canPress({ nativeEvent: { identifier: "0", timestamp: 31, touches: [] } })).toBe(
      false,
    );
  });

  it("finishes an accepted release even if a nested action stops touch-end bubbling", () => {
    const { screen, book } = fixture();
    screen.touchHandlers.onTouchStart(touchEvent(10, 0));
    expect(book.canPress(touchEvent(20, 0, 0))).toBe(true);
    screen.touchHandlers.onTouchStart(touchEvent(21, 1));
    expect(book.canPress(touchEvent(22, 1, 0))).toBe(true);
  });

  it("observes 100 mixed gestures with zero actions, then 30 immediate intentional taps once each", () => {
    const { model, screen, shelf, book } = fixture();
    const open = vi.fn();
    let timestamp = 10;
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const start = touchEvent(timestamp++);
      screen.touchHandlers.onStartShouldSetResponderCapture(start);
      shelf.touchHandlers.onTouchStart(start);
      shelf.scrollHandlers.onScrollBeginDrag(scrollEvent(timestamp++));
      if (iteration % 4 === 0) {
        shelf.touchHandlers.onTouchCancel(touchEvent(timestamp++, 0, 0));
      } else if (iteration % 4 === 1) {
        screen.beginSwipe();
        shelf.scrollHandlers.onScrollEndDrag(scrollEvent(timestamp++));
        screen.endSwipe();
      } else {
        shelf.scrollHandlers.onScrollEndDrag(scrollEvent(timestamp++));
        shelf.scrollHandlers.onMomentumScrollBegin(scrollEvent(timestamp++));
        screen.touchHandlers.onTouchEnd(touchEvent(timestamp++, 0, 0));
        if (iteration % 4 === 2) {
          const stopping = touchEvent(timestamp++);
          screen.touchHandlers.onStartShouldSetResponderCapture(stopping);
          shelf.touchHandlers.onTouchStart(stopping);
        } else {
          shelf.scrollHandlers.onMomentumScrollEnd(scrollEvent(timestamp++));
        }
      }
      const release = touchEvent(timestamp++, 0, 0);
      screen.touchHandlers.onTouchEnd(release);
      if (book.canPress(release)) open();
    }
    expect(open).not.toHaveBeenCalled();
    expect(model.getSnapshot().activeMotions).toBe(0);

    for (let iteration = 0; iteration < 30; iteration += 1) {
      const start = touchEvent(timestamp++);
      screen.touchHandlers.onStartShouldSetResponderCapture(start);
      shelf.touchHandlers.onTouchStart(start);
      const release = touchEvent(timestamp++, 0, 0);
      screen.touchHandlers.onTouchEnd(release);
      if (book.canPress(release)) open();
      if (book.canPress(release)) open();
    }
    expect(open).toHaveBeenCalledTimes(30);
    expect(model.getSnapshot().activeMotions).toBe(0);
  });
});

describe("swipe press guard React lifecycle", () => {
  const actGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
  actGlobals.IS_REACT_ACT_ENVIRONMENT = true;

  it("keeps hook identities and memo content stable through gestures and parent renders", async () => {
    const guards = new Map<string, NonNullable<ReturnType<typeof useSwipePressGuard>>>();
    const renderCount = vi.fn();
    const open = vi.fn();
    const Book = memo(function Book() {
      renderCount();
      const guard = useSwipePressGuard();
      if (!guard) throw new Error("Missing guard provider");
      guards.set("book", guard);
      return createElement("Pressable", {
        testID: "guard-book-action",
        onPress: (event: SwipeGuardEvent) => {
          if (guard.canPress(event)) open();
        },
      });
    });
    function Screen({ revision }: { revision: number }) {
      const guard = useSwipePressGuard();
      if (!guard) throw new Error("Missing guard provider");
      guards.set("screen", guard);
      return createElement("View", { revision, ...guard.touchHandlers }, createElement(Book));
    }
    const element = (revision: number) =>
      createElement(SwipePressGuardProvider, null, createElement(Screen, { revision }));
    let tree: ReactTestRenderer | undefined;
    await act(() => {
      tree = create(element(0));
    });
    if (!tree) throw new Error("Renderer was not created");
    const screen = guards.get("screen");
    const book = guards.get("book");
    if (!screen || !book) throw new Error("Guard observers were not rendered");
    const press = tree.root.findByProps({ testID: "guard-book-action" }).props.onPress;

    await act(() => {
      screen.touchHandlers.onStartShouldSetResponderCapture(touchEvent(10));
      screen.scrollHandlers.onScrollBeginDrag(scrollEvent(20));
      screen.scrollHandlers.onScrollEndDrag(scrollEvent(30));
      screen.touchHandlers.onTouchEnd(touchEvent(31, 0, 0));
      press(touchEvent(31, 0, 0));
      screen.touchHandlers.onStartShouldSetResponderCapture(touchEvent(32));
      screen.touchHandlers.onTouchEnd(touchEvent(33, 0, 0));
      press(touchEvent(33, 0, 0));
      press(touchEvent(33, 0, 0));
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(renderCount).toHaveBeenCalledTimes(1);
    await act(() => tree?.update(element(1)));
    expect(guards.get("screen")).toBe(screen);
    expect(guards.get("book")).toBe(book);
    expect(renderCount).toHaveBeenCalledTimes(1);
    await act(() => tree?.unmount());
  });

  it("cleans up only the unmounted observer and tolerates StrictMode effect replay", async () => {
    const guards = new Map<string, NonNullable<ReturnType<typeof useSwipePressGuard>>>();
    function Observer({ name }: { name: string }) {
      const guard = useSwipePressGuard();
      if (!guard) throw new Error("Missing guard provider");
      guards.set(name, guard);
      return null;
    }
    const element = (showBook: boolean, showShelf: boolean) =>
      createElement(
        StrictMode,
        null,
        createElement(
          SwipePressGuardProvider,
          null,
          createElement(Observer, { name: "screen", key: "screen" }),
          showShelf ? createElement(Observer, { name: "shelf", key: "shelf" }) : null,
          showBook ? createElement(Observer, { name: "book", key: "book" }) : null,
        ),
      );
    let tree: ReactTestRenderer | undefined;
    await act(() => {
      tree = create(element(true, true));
    });
    const screen = guards.get("screen");
    const shelf = guards.get("shelf");
    const book = guards.get("book");
    if (!screen || !shelf || !book) throw new Error("Guard observers were not rendered");
    screen.touchHandlers.onTouchStart(touchEvent(10));
    shelf.scrollHandlers.onScrollBeginDrag(scrollEvent(20));
    await act(() => tree?.update(element(false, true)));
    // The card effect cleanup cannot release the shelf's drag.
    expect(screen.canPress()).toBe(false);
    expect(book.canPress({ nativeEvent: {} })).toBe(false);
    await act(() => tree?.update(element(false, false)));
    // A native callback retained after unmount cannot reactivate the old owner.
    shelf.scrollHandlers.onMomentumScrollBegin(scrollEvent(30));
    screen.touchHandlers.onTouchStart(touchEvent(31));
    expect(screen.canPress(touchEvent(32, 0, 0))).toBe(true);
    await act(() => tree?.unmount());
  });

  it("wires the actual segmented pager to an independent drag/momentum owner", async () => {
    const guards = new Map<string, NonNullable<ReturnType<typeof useSwipePressGuard>>>();
    const open = vi.fn();
    function Book() {
      const guard = useSwipePressGuard();
      return createElement("Pressable", {
        testID: "pager-book-action",
        onPress: (event: SwipeGuardEvent) => {
          if (guard?.canPress(event)) open();
        },
      });
    }
    function Screen() {
      const guard = useSwipePressGuard();
      if (!guard) throw new Error("Missing guard provider");
      guards.set("screen", guard);
      return (
        <NativeSegmentedPager
          values={["One", "Two"]}
          selectedIndex={0}
          onSelect={vi.fn()}
          colorScheme="light"
          accessibilityLabel="Sections"
        >
          <Book />
          {createElement("View")}
        </NativeSegmentedPager>
      );
    }
    let tree: ReactTestRenderer | undefined;
    await act(() => {
      tree = create(createElement(SwipePressGuardProvider, null, createElement(Screen)));
    });
    if (!tree) throw new Error("Renderer was not created");
    const screen = guards.get("screen");
    if (!screen) throw new Error("Guard observer was not rendered");
    const pager = tree.root.find(
      (node) => typeof node.props.onPageScrollStateChanged === "function",
    );
    const pagerTouch = tree.root.find(
      (node) => typeof node.props.onStartShouldSetResponderCapture === "function",
    ).props.onStartShouldSetResponderCapture;
    const press = tree.root.findByProps({ testID: "pager-book-action" }).props.onPress;
    const state = (pageScrollState: "dragging" | "settling" | "idle") =>
      pager.props.onPageScrollStateChanged({ nativeEvent: { pageScrollState } });

    await act(() => {
      screen.scrollHandlers.onScrollBeginDrag(scrollEvent(10));
      state("dragging");
      state("settling");
      state("idle");
      screen.touchHandlers.onTouchStart(touchEvent(20));
      press(touchEvent(21, 0, 0));
    });
    expect(open).not.toHaveBeenCalled();

    await act(() => {
      screen.scrollHandlers.onScrollEndDrag(scrollEvent(22));
      screen.touchHandlers.onTouchEnd(touchEvent(23, 0, 0));
      state("dragging");
      state("settling");
      const stopping = touchEvent(30);
      screen.touchHandlers.onTouchStart(stopping);
      expect(pagerTouch(stopping)).toBe(false);
      press(touchEvent(31, 0, 0));
      state("idle");
      const next = touchEvent(32);
      screen.touchHandlers.onTouchStart(next);
      pagerTouch(next);
      press(touchEvent(33, 0, 0));
      press(touchEvent(33, 0, 0));
    });
    expect(open).toHaveBeenCalledTimes(1);
    await act(() => tree?.unmount());
  });
});
