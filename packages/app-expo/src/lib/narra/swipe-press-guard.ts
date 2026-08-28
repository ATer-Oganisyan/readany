export type SwipePhase = "drag" | "momentum" | "pager";
export type SwipeOwner = object;
export type SwipeTouchIdentifier = number | string;

export interface SwipeSession {
  readonly owner: SwipeOwner;
  readonly phase: SwipePhase;
  readonly id: number;
  readonly epoch: number;
  readonly startedAt?: number;
}

export interface SwipeTouch {
  readonly identifier: SwipeTouchIdentifier;
  readonly timestamp?: number;
}

export interface SwipeTouchSession {
  readonly id: number;
  readonly epoch: number;
  readonly identifier: SwipeTouchIdentifier;
  readonly startedAt?: number;
}

interface TouchState {
  session: SwipeTouchSession;
  pointers: Set<SwipeTouchIdentifier>;
  starts: Map<SwipeTouchIdentifier, number | undefined>;
  motionBlockers: Set<number>;
  blocked: boolean;
  claimed: boolean;
  ended: boolean;
}

interface MomentumEnd {
  startedAt: number;
  endedAt: number;
}

/**
 * Gesture ownership and touch eligibility are separate. Ending a gesture never
 * turns its release into a tap; only a new touch may become eligible. No clock
 * cooldown is needed, so an intentional tap immediately after stopping works.
 * This module observes events; it never fires an action or claims the responder.
 */
export function createSwipePressGuard() {
  const motions = new Map<SwipeOwner, Map<SwipePhase, SwipeSession>>();
  const momentumEnds = new Map<SwipeOwner, MomentumEnd>();
  const accessibilityActivations = new WeakSet<object>();
  let enabled = true;
  let epoch = 0;
  let sequence = 0;
  let touch: TouchState | null = null;

  const hasMotion = () => motions.size > 0;

  const begin = (owner: SwipeOwner, phase: SwipePhase, timestamp?: number): SwipeSession | null => {
    if (!enabled) return null;
    const previous = motions.get(owner)?.get(phase);
    if (previous && timestamp !== undefined && previous.startedAt !== undefined) {
      if (timestamp <= previous.startedAt) return previous;
    }
    const session: SwipeSession = { owner, phase, id: ++sequence, epoch, startedAt: timestamp };
    const ownerMotions = motions.get(owner) ?? new Map<SwipePhase, SwipeSession>();
    ownerMotions.set(phase, session);
    motions.set(owner, ownerMotions);
    if (touch) touch.blocked = true;
    return session;
  };

  const end = (session: SwipeSession | null, timestamp?: number): boolean => {
    if (!session || session.epoch !== epoch) return false;
    // Fabric scroll timestamps share the native monotonic touch clock. A queued
    // end from the previous gesture must not end this owner's newer gesture.
    if (
      timestamp !== undefined &&
      session.startedAt !== undefined &&
      timestamp < session.startedAt
    ) {
      return false;
    }
    if (
      touch &&
      timestamp !== undefined &&
      touch.session.startedAt !== undefined &&
      timestamp < touch.session.startedAt
    ) {
      // Native completion may have happened before this touch but reached JS
      // after it. That exact lease was not moving at touch-start after all.
      touch.motionBlockers.delete(session.id);
    }
    const ownerMotions = motions.get(session.owner);
    if (ownerMotions?.get(session.phase) !== session) return false;
    ownerMotions.delete(session.phase);
    if (!ownerMotions.size) motions.delete(session.owner);
    if (
      session.phase === "momentum" &&
      timestamp !== undefined &&
      session.startedAt !== undefined
    ) {
      momentumEnds.set(session.owner, { startedAt: session.startedAt, endedAt: timestamp });
    }
    return true;
  };

  const beginTouch = (owner: SwipeOwner, input: SwipeTouch): SwipeTouchSession | null => {
    if (!enabled) return null;
    const sameStart =
      touch?.starts.has(input.identifier) &&
      touch.starts.get(input.identifier) === input.timestamp &&
      (input.timestamp !== undefined || !touch.ended);

    if (!sameStart) {
      if (
        touch &&
        input.timestamp !== undefined &&
        touch.session.startedAt !== undefined &&
        input.timestamp < touch.session.startedAt
      ) {
        return null;
      }
      if (touch && !touch.ended && !touch.pointers.has(input.identifier)) {
        // A second finger is part of the current gesture, not an independent tap.
        touch.pointers.add(input.identifier);
        touch.starts.set(input.identifier, input.timestamp);
        touch.blocked = true;
      } else {
        const timestamp = input.timestamp;
        const overlappedMomentum =
          timestamp !== undefined &&
          [...momentumEnds.values()].some(
            ({ startedAt, endedAt }) => startedAt <= timestamp && timestamp <= endedAt,
          );
        touch = {
          session: {
            id: ++sequence,
            epoch,
            identifier: input.identifier,
            startedAt: input.timestamp,
          },
          pointers: new Set([input.identifier]),
          starts: new Map([[input.identifier, input.timestamp]]),
          motionBlockers: new Set(
            [...motions.values()].flatMap((ownerMotions) =>
              [...ownerMotions.values()].map((session) => session.id),
            ),
          ),
          blocked: overlappedMomentum,
          claimed: false,
          ended: false,
        };
        // Only the most recent interval is needed until the next physical touch.
        momentumEnds.clear();
      }
    }

    // UIKit need not emit momentum-end when a touch stops deceleration. Retire
    // only the observer's momentum, retaining this touch's blocked decision.
    // Ancestor and nested scroll observers see the same touch and retire their
    // own leases; an unrelated list or pager remains untouched.
    const momentum = motions.get(owner)?.get("momentum");
    if (momentum) end(momentum, input.timestamp);
    return touch?.session ?? null;
  };

  const endTouch = (input: SwipeTouch, cancelled = false, remainingTouches = 0): boolean => {
    if (!touch || !touch.starts.has(input.identifier)) return false;
    if (
      input.timestamp !== undefined &&
      touch.session.startedAt !== undefined &&
      input.timestamp < touch.session.startedAt
    ) {
      return false;
    }
    if (cancelled) touch.blocked = true;
    touch.pointers.delete(input.identifier);
    if (remainingTouches === 0 || !touch.pointers.size) touch.ended = true;
    // Keep eligibility after touch-end: Pressability's onPress can follow it.
    return true;
  };

  const cancelOwner = (owner: SwipeOwner) => {
    if (motions.has(owner) && touch) touch.blocked = true;
    motions.delete(owner);
    momentumEnds.delete(owner);
  };

  const reset = () => {
    epoch += 1;
    motions.clear();
    momentumEnds.clear();
    if (touch) {
      touch.blocked = true;
      touch.ended = true;
      touch.pointers.clear();
      touch.motionBlockers.clear();
    }
  };

  const setEnabled = (next: boolean) => {
    if (enabled === next) return;
    enabled = next;
    if (!next) reset();
  };

  /** Call once from the existing Pressable onPress/onLongPress action boundary. */
  const claimPress = (input?: SwipeTouch): boolean => {
    if (!enabled || hasMotion()) return false;
    if (!touch) return true;
    if (input) {
      if (input.identifier !== touch.session.identifier) return false;
      if (
        input.timestamp !== undefined &&
        touch.session.startedAt !== undefined &&
        input.timestamp < touch.session.startedAt
      ) {
        return false;
      }
    }
    if (
      touch.blocked ||
      touch.motionBlockers.size > 0 ||
      touch.claimed ||
      touch.session.epoch !== epoch
    ) {
      return false;
    }
    touch.claimed = true;
    return true;
  };

  const claimAccessibilityPress = (event: object): boolean => {
    if (accessibilityActivations.has(event)) return false;
    // A VoiceOver/keyboard activation is independent of the previous pointer
    // gesture and must remain available after a cancelled or consumed touch.
    accessibilityActivations.add(event);
    return enabled;
  };

  const getSnapshot = () => ({
    enabled,
    activeOwners: motions.size,
    activeMotions: [...motions.values()].reduce((count, owner) => count + owner.size, 0),
    touchBlocked: !!touch && (touch.blocked || touch.motionBlockers.size > 0),
    touchClaimed: touch?.claimed ?? false,
  });

  return {
    begin,
    end,
    beginTouch,
    endTouch,
    cancelOwner,
    reset,
    setEnabled,
    claimPress,
    claimAccessibilityPress,
    getSnapshot,
  };
}

export type SwipePressGuard = ReturnType<typeof createSwipePressGuard>;
