export type MotionTarget = "play" | "loading" | "pause";
const clips = {
  forward: [0, 0.3],
  reverse: [0.7, 1],
  enter: [1.4, 1.7],
  pauseEnter: [6, 6.3],
  spin: [2.1, 2.5],
  exit: [2.8, 3.15],
  cancel: [5.35, 5.65],
} as const;
type Transition = {
  from: number;
  to: number;
  start: number;
  duration: number;
  end: MotionTarget;
  phase?: number;
};

/** Serializable state is shared with the UI runtime, independent of JS/audio work. */
export type MotionState = {
  state: MotionTarget;
  target: MotionTarget;
  transition?: Transition;
  spinStart: number;
  spinPhase: number;
  boundary?: number;
  boundaryTarget?: MotionTarget;
  waitingSince?: number;
};
export function createMotion(initial: MotionTarget = "play"): MotionState {
  "worklet";
  return {
    state: initial === "loading" ? "play" : initial,
    target: initial,
    spinStart: 0,
    spinPhase: 0,
  };
}
function run(
  motion: MotionState,
  from: number,
  to: number,
  start: number,
  end: MotionTarget,
  phase?: number,
) {
  "worklet";
  motion.transition = {
    from,
    to,
    start,
    duration: Math.round(Math.abs(to - from) * 1000),
    end,
    phase,
  };
}
export function sampleMotion(
  motion: MotionState,
  now: number,
  reducedMotion = false,
): { seconds: number; active: boolean } {
  "worklet";
  if (reducedMotion) {
    motion.transition = undefined;
    motion.state = motion.target;
    motion.spinStart = now;
    motion.boundary = undefined;
    return {
      seconds:
        motion.target === "loading"
          ? clips.spin[0]
          : motion.target === "pause"
            ? clips.forward[1]
            : 0,
      active: false,
    };
  }
  if (motion.transition) {
    const t = motion.transition;
    const p = Math.max(0, Math.min(1, (now - t.start) / t.duration));
    if (p < 1) return { seconds: t.from + (t.to - t.from) * p, active: true };
    motion.transition = undefined;
    motion.state = t.end;
    if (t.end === "loading") {
      motion.spinStart = t.start + t.duration;
      motion.spinPhase = t.phase ?? 0;
      motion.boundary = undefined;
    }
  }
  if (motion.state === "loading") {
    const turns = (now - motion.spinStart) / 400;
    if (motion.target === "loading") motion.boundary = undefined;
    else if (motion.boundary === undefined || motion.boundaryTarget !== motion.target) {
      // Never flash a partial loop on a fast successful load. Cancellation need not wait.
      const minimum = motion.target === "pause" ? Math.max(1, turns) : turns;
      const offset = motion.target === "pause" ? 0.75 : 0;
      const step = motion.target === "pause" ? 0.5 : 1;
      motion.boundary =
        offset +
        Math.ceil((minimum + motion.spinPhase - offset - 1e-8) / step) * step -
        motion.spinPhase;
      motion.boundaryTarget = motion.target;
    }
    if (motion.boundary !== undefined && turns >= motion.boundary) {
      const clip = motion.target === "pause" ? clips.exit : clips.cancel;
      run(motion, clip[0], clip[1], motion.spinStart + motion.boundary * 400, motion.target);
      motion.boundary = undefined;
      return sampleMotion(motion, now);
    }
    const phase = (((turns + motion.spinPhase) % 1) + 1) % 1;
    return { seconds: clips.spin[0] + phase * 0.4, active: true };
  }
  if (motion.target !== motion.state) {
    if (motion.target === "loading") {
      // Briefly defer entry so already-ready audio uses the direct morph.
      motion.waitingSince ??= now;
      if (motion.state === "play" && now - motion.waitingSince < 80)
        return { seconds: 0, active: true };
      if (motion.state === "pause")
        run(motion, clips.pauseEnter[0], clips.pauseEnter[1], now, "loading", 0.25);
      else run(motion, ...clips.enter, now, "loading", 0);
    } else {
      const clip = motion.target === "pause" ? clips.forward : clips.reverse;
      run(motion, clip[0], clip[1], now, motion.target);
    }
    motion.waitingSince = undefined;
    return sampleMotion(motion, now);
  }
  motion.waitingSince = undefined;
  return { seconds: motion.state === "pause" ? clips.forward[1] : 0, active: false };
}
/** Test adapter; production executes the same sampler on the UI thread. */
export class PlaybackMotion {
  private motion: MotionState;
  constructor(initial: MotionTarget = "play") {
    this.motion = createMotion(initial);
  }
  setTarget(target: MotionTarget) {
    this.motion.target = target;
  }
  sample(now: number, reducedMotion = false) {
    return sampleMotion(this.motion, now, reducedMotion);
  }
}
