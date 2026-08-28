import type { SwipePressGuard, SwipeSession, SwipeTouch } from "./swipe-press-guard";

/** Structural shape accepts native touch, native scroll, and accessibility events. */
export interface SwipeGuardEvent {
  readonly nativeEvent: object;
}

function nativeFields(event: SwipeGuardEvent) {
  return event.nativeEvent as {
    identifier?: unknown;
    timestamp?: unknown;
    touches?: unknown;
  };
}

function eventTime(event: SwipeGuardEvent) {
  const { timestamp } = nativeFields(event);
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : undefined;
}

function eventTouch(event: SwipeGuardEvent): SwipeTouch | undefined {
  const { identifier } = nativeFields(event);
  return typeof identifier === "number" || typeof identifier === "string"
    ? { identifier, timestamp: eventTime(event) }
    : undefined;
}

/**
 * One binding per scroll view, pager, or action observer. No React state changes
 * during gestures, and disposing an observer can only cancel its own leases.
 */
export function createSwipePressGuardBinding(guard: SwipePressGuard) {
  const owner = {};
  let active = true;
  let drag: SwipeSession | null = null;
  let momentum: SwipeSession | null = null;
  let pager: SwipeSession | null = null;

  const cancelSwipe = () => {
    guard.cancelOwner(owner);
    drag = null;
    momentum = null;
    pager = null;
  };

  const onTouchStart = (event: SwipeGuardEvent) => {
    const input = eventTouch(event);
    if (active && input) guard.beginTouch(owner, input);
  };

  const onTouchEnd = (event: SwipeGuardEvent) => {
    const input = eventTouch(event);
    const { touches } = nativeFields(event);
    if (active && input) guard.endTouch(input, false, Array.isArray(touches) ? touches.length : 0);
  };

  const onTouchCancel = (event: SwipeGuardEvent) => {
    const input = eventTouch(event);
    if (!active) return;
    if (input && !guard.endTouch(input, true)) return;
    cancelSwipe();
  };

  return {
    beginSwipe: () => {
      if (active) pager = guard.begin(owner, "pager");
      return pager;
    },
    endSwipe: (session: SwipeSession | null = pager) => {
      const ended = guard.end(session);
      if (ended && pager === session) pager = null;
      return ended;
    },
    cancelSwipe,
    canPress: (event?: SwipeGuardEvent) => {
      if (!active) return false;
      const input = event && eventTouch(event);
      if (event && input) {
        const { touches } = nativeFields(event);
        // A nested action may stop event propagation. Its release still ends
        // the pointer sequence, without changing the recorded eligibility.
        if (Array.isArray(touches) && touches.length === 0) guard.endTouch(input);
      }
      return event && !input ? guard.claimAccessibilityPress(event) : guard.claimPress(input);
    },
    touchHandlers: {
      onStartShouldSetResponderCapture: (event: SwipeGuardEvent) => {
        onTouchStart(event);
        // Observe before Pressability, but never take the responder from it.
        return false;
      },
      onTouchStart,
      onTouchEnd,
      onTouchCancel,
    },
    scrollHandlers: {
      onScrollBeginDrag: (event: SwipeGuardEvent) => {
        if (active) drag = guard.begin(owner, "drag", eventTime(event));
      },
      onScrollEndDrag: (event: SwipeGuardEvent) => {
        if (guard.end(drag, eventTime(event))) drag = null;
      },
      onMomentumScrollBegin: (event: SwipeGuardEvent) => {
        if (active) momentum = guard.begin(owner, "momentum", eventTime(event));
      },
      onMomentumScrollEnd: (event: SwipeGuardEvent) => {
        if (guard.end(momentum, eventTime(event))) momentum = null;
      },
    },
    reset: guard.reset,
    setEnabled: guard.setEnabled,
    // React StrictMode may run effect cleanup/setup without remounting the hook.
    activate: () => {
      active = true;
    },
    dispose: () => {
      active = false;
      cancelSwipe();
    },
  };
}
