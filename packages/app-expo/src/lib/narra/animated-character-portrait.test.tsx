import { AnimatedCharacterPortrait } from "@/components/narra/animated-character-portrait";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Timing = {
  to: number;
  duration: number;
  callback?: (finished: boolean) => void;
};

const runtime = vi.hoisted(() => ({
  timings: [] as Timing[],
  repeats: [] as Array<{ steps: Array<{ to: number; duration: number }>; count: number }>,
  cancelled: 0,
}));

vi.mock("react-native", () => ({
  Image: { prefetch: () => Promise.resolve(true) },
  StyleSheet: { create: <T,>(styles: T) => styles },
}));

vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  Easing: { inOut: (fn: unknown) => fn, ease: "ease" },
  cancelAnimation: () => {
    runtime.cancelled += 1;
  },
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  useAnimatedStyle: (fn: () => unknown) => fn(),
  useSharedValue: (initial: number) => ({ value: initial }),
  withRepeat: (steps: Array<{ to: number; duration: number }>, count: number) => {
    runtime.repeats.push({ steps, count });
    return steps[steps.length - 1]?.to ?? 1;
  },
  withSequence: (...steps: Array<{ to: number; duration: number }>) => steps,
  withTiming: (
    to: number,
    config: { duration: number },
    callback?: (finished: boolean) => void,
  ) => {
    const timing = { to, duration: config.duration, callback };
    runtime.timings.push(timing);
    return to;
  },
}));

vi.mock("@/components/narra/character-portrait-image", () => ({
  CharacterPortraitImage: "PortraitImage",
}));

vi.mock("@/lib/narra/character-portrait", () => ({
  resolveCharacterPortraitUri: (character: { portraitUri?: string }) => character.portraitUri,
}));

const OLD = { portraitUri: "file:///portrait-1.jpg", portraitUriOverridesAsset: true };
const NEW = { portraitUri: "file:///portrait-2.jpg", portraitUriOverridesAsset: true };

function shownPortraitUri(tree: ReactTestRenderer): string | undefined {
  const image = tree.root.findByType("PortraitImage" as never);
  return (image.props as { character: { portraitUri?: string } }).character.portraitUri;
}

/** Даёт отработать промису Image.prefetch внутри эффекта. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AnimatedCharacterPortrait", () => {
  beforeEach(() => {
    runtime.timings.length = 0;
    runtime.repeats.length = 0;
    runtime.cancelled = 0;
  });

  it("шиммерит текущую картинку, пока идёт генерация", async () => {
    await act(async () => {
      create(<AnimatedCharacterPortrait character={OLD} busy fallback={null} />);
    });

    expect(runtime.repeats).toHaveLength(1);
    const [shimmer] = runtime.repeats;
    expect(shimmer.count).toBe(-1);
    // Цикл: секунда вниз до 70% непрозрачности, секунда обратно до 100%.
    expect(shimmer.steps).toEqual([0.7, 1]);
    expect(runtime.timings).toEqual([
      { to: 0.7, duration: 1000, callback: undefined },
      { to: 1, duration: 1000, callback: undefined },
    ]);
  });

  it("не шиммерит, когда генерации нет", async () => {
    await act(async () => {
      create(<AnimatedCharacterPortrait character={OLD} fallback={null} />);
    });

    expect(runtime.repeats).toHaveLength(0);
  });

  it("меняет кадр последовательно: старая гаснет 500 мс, только потом новая проявляется", async () => {
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(<AnimatedCharacterPortrait character={OLD} busy fallback={null} />);
    });
    if (!tree) throw new Error("no tree");
    runtime.timings.length = 0;

    await act(async () => {
      tree?.update(<AnimatedCharacterPortrait character={NEW} busy fallback={null} />);
    });
    await flush();

    // Пока старая не догасла, на экране всё ещё она.
    const fadeOut = runtime.timings.find((timing) => timing.to === 0);
    expect(fadeOut).toMatchObject({ to: 0, duration: 500 });
    expect(shownPortraitUri(tree)).toBe(OLD.portraitUri);
    expect(runtime.timings.some((timing) => timing.to === 1 && timing.duration === 500)).toBe(
      false,
    );

    // Затухание закончилось — подменяем кадр и проявляем новый.
    await act(async () => {
      fadeOut?.callback?.(true);
    });

    expect(shownPortraitUri(tree)).toBe(NEW.portraitUri);
    expect(runtime.timings.some((timing) => timing.to === 1 && timing.duration === 500)).toBe(true);
  });
});
