import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import React from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

// Execute the real navigator module, replacing only platform/navigation and
// leaf screens. This checks rendered route options, not source text matches.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../../navigation/RootNavigator.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const Leaf = () => null;
const leafModule = new Proxy(
  { __esModule: true, default: Leaf },
  {
    get: (target, name) => (name === "__esModule" ? target.__esModule : Leaf),
  },
);
function loadNavigator(platform: "android" | "ios") {
  const state = { dark: false };
  const NativeNavigator = (props: { children: React.ReactNode }) =>
    React.createElement("NativeNavigator", props, props.children);
  const NativeScreen = (props: object) => React.createElement("NativeScreen", props);
  const exports: { RootNavigator?: React.ComponentType } = {};
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": { Platform: { OS: platform } },
    "@/components/ui/styled-toast-host": { StyledToastHost: Leaf },
    "@/components/ui/toast-host-owner": { ToastHostSlot: Leaf },
    "@react-navigation/native-stack": {
      createNativeStackNavigator: () => ({ Navigator: NativeNavigator, Screen: NativeScreen }),
    },
    "@/stores": { useSettingsStore: () => ({ _hasHydrated: true }) },
    "@/styles/theme": {
      useTheme: () => ({ isDark: state.dark, colors: { background: "bg", foreground: "fg" } }),
      titleFontFamily: "Test",
      ElevatedSurfaceTheme: Leaf,
    },
    "react-i18next": {
      useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
    },
    "./scroll-edge-effects": { NATIVE_SCROLL_EDGE_EFFECTS: {} },
  };
  runInNewContext(compiled, {
    exports,
    __DEV__: false,
    require: (name: string) => {
      if (name in dependencies) return dependencies[name];
      if (
        name.startsWith("@/screens/") ||
        name === "./TabNavigator" ||
        name === "@/components/shared/MissingBookPrompt"
      )
        return leafModule;
      throw new Error(`Unexpected navigator dependency: ${name}`);
    },
  });
  if (!exports.RootNavigator) throw new Error("RootNavigator export missing");
  return { RootNavigator: exports.RootNavigator, state };
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined;
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
});
function routeOptions(name: string) {
  const navigator = tree?.root.find((node) => String(node.type) === "NativeNavigator");
  const screen = tree?.root.find(
    (node) => String(node.type) === "NativeScreen" && node.props.name === name,
  );
  return { ...navigator?.props.screenOptions, ...screen?.props.options };
}

describe("root native status bar follows the visible surface theme", () => {
  it.each(["android", "ios"] as const)(
    "updates inherited notes/settings contrast on %s",
    (platform) => {
      const { RootNavigator, state } = loadNavigator(platform);
      act(() => {
        tree = create(<RootNavigator />);
      });
      for (const name of ["FullScreenNotes", "ManualNote", "AppearanceSettings", "Stats"]) {
        expect(routeOptions(name).statusBarStyle).toBe("dark");
      }
      state.dark = true;
      act(() => {
        tree?.update(<RootNavigator />);
      });
      for (const name of ["FullScreenNotes", "ManualNote", "AppearanceSettings", "Stats"]) {
        expect(routeOptions(name).statusBarStyle).toBe("light");
      }
      state.dark = false;
      act(() => {
        tree?.update(<RootNavigator />);
      });
      expect(routeOptions("FullScreenNotes").statusBarStyle).toBe("dark");
    },
  );

  it("preserves reader-owned hidden chrome and explicit route precedence", () => {
    const { RootNavigator } = loadNavigator("android");
    act(() => {
      tree = create(<RootNavigator />);
    });
    expect(routeOptions("Reader")).toMatchObject({ statusBarHidden: true, headerShown: false });
    expect(routeOptions("Tabs")).toMatchObject({ statusBarHidden: false, statusBarStyle: "dark" });
  });
});
