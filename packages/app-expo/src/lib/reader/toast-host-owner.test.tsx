import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import {
  ToastHostOwner,
  ToastHostSlot,
  type ToastHostRoute,
} from "@/components/ui/toast-host-owner";

const runtime = vi.hoisted(() => ({ store: null as any }));
vi.mock("@/components/chat/animated-narra-face", () => ({ AnimatedNarraFace: "Face" }));
vi.mock("@/components/ui/Icon", () => ({ MishanaerIcon: "Icon" }));
vi.mock("@/components/ui/toast-overlay", () => ({ ToastOverlay: "WindowOverlay" }));
vi.mock("@/styles/ThemeContext", () => ({ useTheme: () => ({ colors: {}, isDark: false }) }));
vi.mock("@deslop/primitives/native", () => ({ interfaceFontFamily: { regular: "fixture" } }));
vi.mock("expo-glass-effect", () => ({ GlassView: "Glass", isLiquidGlassAvailable: () => false }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  StyleSheet: { absoluteFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } },
  View: "View",
}));
vi.mock("react-native-reanimated", () => ({
  withSpring: (v: unknown) => v,
  SnappySpringConfig: {},
}));
vi.mock("sonner-native", async () => {
  const react = await import("react");
  return {
    Toaster: (props: any) => {
      const snapshot = react.useSyncExternalStore(
        runtime.store.subscribe,
        runtime.store.getSnapshot,
      ) as { toasts: Array<{ id: string | number; action?: { onClick?: () => void } }> };
      react.useEffect(() => runtime.store.registerChannel(""), []);
      return react.createElement(
        "ToastHost",
        props,
        snapshot.toasts.map((toast: any) =>
          react.createElement("ToastAction", {
            key: toast.id,
            id: toast.id,
            onPress: toast.action?.onClick,
          }),
        ),
      );
    },
  };
});
import { StyledToastHost } from "@/components/ui/styled-toast-host";

// Actual installed store/comparator/constants; only animation timing is a port.
function actualStore() {
  const require = createRequire(import.meta.url);
  const root = join(dirname(require.resolve("sonner-native/package.json")), "src");
  const cache = new Map<string, any>();
  const load = (name: string): any => {
    if (name === "react") return React;
    if (name === "./animations") return { ENTERING_ANIMATION_DURATION: 0 };
    if (cache.has(name)) return cache.get(name);
    const module = { exports: {} };
    const code = transformSync(
      readFileSync(join(root, `${name.replace(/^\.\//, "")}.ts`), "utf8"),
      { loader: "ts", format: "cjs" },
    ).code;
    runInNewContext(code, {
      module,
      exports: module.exports,
      require: load,
      setTimeout,
      clearTimeout,
      Date,
      console,
      __DEV__: true,
    });
    cache.set(name, module.exports);
    return module.exports;
  };
  return load("./toast-store").toastStore;
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  runtime.store?.dismissToast();
  vi.useRealTimers();
});
function Harness({ route }: { route?: ToastHostRoute }) {
  return (
    <ToastHostOwner route={route}>
      <ToastHostSlot>
        <StyledToastHost />
      </ToastHostSlot>
      <ToastHostSlot readerKey="reader-a">
        <StyledToastHost insideReader />
      </ToastHostSlot>
      <ToastHostSlot readerKey="reader-b">
        <StyledToastHost insideReader />
      </ToastHostSlot>
    </ToastHostOwner>
  );
}
async function navigate(route?: ToastHostRoute) {
  await act(async () => {
    tree.update(<Harness route={route} />);
  });
  expect(tree.root.findAllByType("ToastHost" as React.ElementType)).toHaveLength(1);
}
it("hands off one default host with the original cancel across two Reader keys and back", async () => {
  runtime.store = actualStore();
  const controller = new AbortController();
  const cancel = vi.fn(() => controller.abort());
  const id = runtime.store.addToast({
    title: "Downloading",
    variant: "loading",
    duration: Infinity,
    action: { label: "Cancel", onClick: cancel },
  });
  await act(async () => {
    tree = create(<Harness />);
  });
  for (const route of [
    { name: "Reader", key: "reader-a" },
    { name: "Reader", key: "reader-b" },
    { name: "Tabs", key: "tabs" },
  ]) {
    await navigate(route);
    const host = tree.root.findByType("ToastHost" as React.ElementType);
    expect(host.props.fullWindowOverlay).toBe(route.name !== "Reader");
    expect(host.props.ToasterOverlayWrapper === undefined).toBe(route.name === "Reader");
    if (route.name === "Reader") {
      const plane = tree.root.findByProps({ testID: "reader-toast-plane" });
      expect(plane.props.pointerEvents).toBe("box-none");
      expect(plane.props.collapsable).toBe(false);
      expect(plane.props.style).toMatchObject({
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 9999,
      });
      expect(plane.findByType("ToastHost" as React.ElementType)).toBe(host);
    } else expect(tree.root.findAllByProps({ testID: "reader-toast-plane" })).toHaveLength(0);
    expect(host.props.id).toBeUndefined();
    expect(host.props.toastOptions.titleStyle.fontFamily).toBe("fixture");
    expect(host.props.toastOptions.titleStyle.fontWeight).toBe("400");
    expect(tree.root.findByType("ToastAction" as React.ElementType).props.id).toBe(id);
  }
  await act(async () => tree.root.findByType("ToastAction" as React.ElementType).props.onPress());
  expect(controller.signal.aborted).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
  await act(async () => runtime.store.dismissToast(id));
  await navigate({ name: "Reader", key: "reader-a" });
  expect(tree.root.findAllByType("ToastAction" as React.ElementType)).toHaveLength(0);
});
it("finite result retains its original deadline through host transfer", async () => {
  vi.useFakeTimers();
  runtime.store = actualStore();
  runtime.store.addToast({ title: "Saved", duration: 1000 });
  await act(async () => {
    tree = create(<Harness />);
  });
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
  await navigate({ name: "Reader", key: "reader-a" });
  await act(async () => {
    vi.advanceTimersByTime(401);
  });
  expect(runtime.store.getSnapshot().toasts).toHaveLength(0);
  expect(tree.root.findAllByType("ToastAction" as React.ElementType)).toHaveLength(0);
});
