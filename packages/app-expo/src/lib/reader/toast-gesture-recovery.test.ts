import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("sonner-native/package.json"));

// Execute the installed, patched production gesture implementation. The gesture
// driver records native callbacks; neither the branch nor the fix is recreated.
function gestureDriver(file: string, direction: string) {
  const callbacks: Record<string, (...args: unknown[]) => void> = {};
  const gesture = Object.fromEntries(
    ["onBegin", "onChange", "onFinalize", "onEnd"].map((name) => [
      name,
      (callback: (...args: unknown[]) => void) => {
        callbacks[name] = callback;
        return gesture;
      },
    ]),
  );
  const identity = (value: unknown) => value;
  const reanimated = {
    __esModule: true,
    default: { View: "AnimatedView" },
    Easing: { inOut: identity, ease: identity, elastic: () => identity },
    LinearTransition: { easing: () => ({}) },
    interpolate: () => 1,
    runOnJS: identity,
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (callback: () => unknown) => callback(),
    withTiming: (value: number, _options: unknown, complete?: (done: boolean) => void) => {
      complete?.(true);
      return value;
    },
  };
  const dependencies: Record<string, unknown> = {
    react: { createElement: () => null },
    "react/jsx-runtime": { jsx: () => null, jsxs: () => null },
    "react-native": {
      Platform: { OS: "ios" },
      Dimensions: { get: () => ({ width: 440 }) },
      useWindowDimensions: () => ({ width: 440 }),
    },
    "react-native-reanimated": reanimated,
    "react-native-gesture-handler": {
      Gesture: { Pan: () => gesture, Tap: () => gesture, Race: () => ({}) },
      GestureDetector: "GestureDetector",
    },
    "./context": {
      useToastContext: () => ({ swipeToDismissDirection: direction, position: "top-center" }),
    },
    "./easings": { easeInOutCircFn: identity },
  };
  const output = transformSync(readFileSync(join(packageRoot, file), "utf8"), {
    loader: file.endsWith("tsx") ? "tsx" : "js",
    format: "cjs",
  }).code;
  const module = { exports: {} as { ToastSwipeHandler: (props: unknown) => unknown } };
  runInNewContext(output, {
    module,
    exports: module.exports,
    require: (name: string) => {
      const dependency = dependencies[name.replace(/\.js$/, "")];
      if (!dependency) throw new Error(`Unexpected gesture dependency: ${name}`);
      return dependency;
    },
  });
  const begin = vi.fn();
  const finalize = vi.fn();
  const remove = vi.fn();
  module.exports.ToastSwipeHandler({
    onBegin: begin,
    onFinalize: finalize,
    onRemove: remove,
    onPress: vi.fn(),
    enabled: true,
  });
  return { callbacks, begin, finalize, remove };
}

describe.each(["src/gestures.tsx", "lib/module/gestures.js", "lib/commonjs/gestures.js"])(
  "toast interaction recovery in %s",
  (file) => {
    it.each([0, 8, -8, 40, -40])(
      "resumes the timer after an unfinished horizontal swipe of %d px",
      (x) => {
        const runtime = gestureDriver(file, "horizontal");
        runtime.callbacks.onBegin();
        runtime.callbacks.onChange({ translationX: x, translationY: 0 });
        runtime.callbacks.onFinalize();
        expect(runtime.begin).toHaveBeenCalledOnce();
        expect(runtime.finalize).toHaveBeenCalledOnce();
        expect(runtime.remove).not.toHaveBeenCalled();
      },
    );

    it("keeps successful dismissal and its cleanup", () => {
      const runtime = gestureDriver(file, "horizontal");
      runtime.callbacks.onBegin();
      runtime.callbacks.onChange({ translationX: 250, translationY: 0 });
      runtime.callbacks.onFinalize();
      expect(runtime.remove).toHaveBeenCalledOnce();
      expect(runtime.finalize).toHaveBeenCalledOnce();
    });
  },
);
