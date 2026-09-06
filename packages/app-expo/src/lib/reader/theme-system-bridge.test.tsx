import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import React, { type ComponentType, type ReactNode, useSyncExternalStore } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as themeColors from "../../styles/theme-colors";

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL("../../../../../", import.meta.url));
const appStyles = resolve(repo, "packages/app-expo/src/styles");
const uniwindSource = resolve(repo, "node_modules/uniwind/src");
type Mode = "light" | "dark" | "system";
type Theme = {
  mode: Mode;
  isDark: boolean;
  colors: themeColors.ThemeColors;
  setMode: (mode: Mode) => void;
};
type Uniwind = { currentTheme: string; hasAdaptiveThemes: boolean; setTheme: (mode: Mode) => void };

function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  runInNewContext(compiled, {
    exports,
    __DEV__: false,
    require: (name: string) => {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return require(name);
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency in ${file}: ${name}`);
    },
  });
  return exports;
}

function fixture(initialSystem: "light" | "dark", initialMode: Mode) {
  let system = initialSystem;
  let forced: "light" | "dark" | undefined;
  const listeners = new Set<(event: { colorScheme: string }) => void>();
  const effective = () => forced ?? system;
  const notify = () => {
    for (const listener of listeners) listener({ colorScheme: effective() });
  };
  // Only the OS/Appearance boundary is modeled: explicit overrides affect the
  // RN getter until 'unspecified' clears them, matching the installed native API.
  const Appearance = {
    getColorScheme: effective,
    setColorScheme: vi.fn((value: string | undefined) => {
      forced = value === "dark" || value === "light" ? value : undefined;
      notify();
    }),
    addChangeListener: (listener: (event: { colorScheme: string }) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  const subscribe = (listener: () => void) => Appearance.addChangeListener(listener).remove;
  const native = {
    Appearance,
    Platform: { OS: "android", constants: { reactNativeVersion: { minor: 86 } } },
    useColorScheme: () => useSyncExternalStore(subscribe, effective),
  };
  const constants = load(resolve(uniwindSource, "common/consts.ts"), {});
  const listener = load(resolve(uniwindSource, "core/listener.ts"), {
    "../common/consts": constants,
  });
  const common = load(resolve(uniwindSource, "core/config/config.common.ts"), {
    "react-native": native,
    "../../common/consts": constants,
    "../../hooks/useCSSVariable/useCSSVariable": { getCSSVariable: vi.fn() },
    "../listener": listener,
  });
  // Run the real native subclass too: using config.common's separate singleton
  // would not exercise the same instance as installed Android.
  const nativeConfig = load(resolve(uniwindSource, "core/config/config.native.ts"), {
    "../../common/consts": constants,
    "../listener": listener,
    "../logger": { Logger: { error: vi.fn() } },
    "../native": { UniwindStore: { runtime: {}, vars: {} } },
    "../native/native-utils": { createVarGetter: vi.fn() },
    "./config.common": common,
  });
  const uniwindContext = load(resolve(uniwindSource, "core/context.ts"), {});
  const hooks = load(resolve(uniwindSource, "hooks/useUniwind.ts"), {
    "../common/consts": constants,
    "../core": nativeConfig,
    "../core/context": uniwindContext,
    "../core/listener": listener,
  });
  const uniwind = { ...nativeConfig, ...hooks };
  const panel = load(resolve(repo, "node_modules/panelui-native/src/theme/use-theme.ts"), {
    uniwind,
  });
  const secureStore = {
    getItemAsync: vi.fn(async () => initialMode),
    setItemAsync: vi.fn(async () => undefined),
  };
  const app = load(resolve(appStyles, "ThemeContext.tsx"), {
    "react-native": native,
    "expo-secure-store": secureStore,
    "./theme-colors": themeColors,
  });
  const bridge = load(resolve(appStyles, "panelui-theme-bridge.tsx"), {
    "@/styles/theme": app,
    "panelui-native": panel,
    uniwind,
  });
  const ThemeProvider = app.ThemeProvider as ComponentType<{
    initialMode: Mode;
    children: ReactNode;
  }>;
  const Bridge = bridge.PanelUIThemeBridge as ComponentType;
  let current!: Theme;
  function Probe() {
    current = (app.useTheme as () => Theme)();
    return null;
  }
  function App() {
    return (
      <ThemeProvider initialMode={initialMode}>
        <Bridge />
        <Probe />
      </ThemeProvider>
    );
  }
  return {
    App,
    Appearance,
    Uniwind: nativeConfig.Uniwind as Uniwind,
    theme: () => current,
    setSystem: (next: "light" | "dark") => {
      system = next;
      notify();
    },
    secureStore,
  };
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined;
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
});

describe("application theme and real PanelUI/Uniwind native mode stay consistent", () => {
  it.each(["light", "dark"] as const)(
    "restores System after the opposite explicit mode on OS %s without remount",
    (system) => {
      const model = fixture(system, "system");
      act(() => {
        tree = create(<model.App />);
      });
      const opposite = system === "light" ? "dark" : "light";
      act(() => model.theme().setMode(opposite));
      expect(model.theme().isDark).toBe(opposite === "dark");
      act(() => model.theme().setMode("system"));
      expect(model.theme().mode).toBe("system");
      expect(model.theme().isDark).toBe(system === "dark");
      expect(model.theme().colors).toEqual(themeColors.makeThemeColors(system));
      expect(model.Uniwind.currentTheme).toBe(system);
      expect(model.Uniwind.hasAdaptiveThemes).toBe(true);
      expect(model.Appearance.getColorScheme()).toBe(system);
      expect(model.secureStore.setItemAsync).toHaveBeenLastCalledWith("readany-theme", "system");
      const writes = model.Appearance.setColorScheme.mock.calls.length;
      act(() => tree?.update(<model.App />));
      expect(model.Appearance.setColorScheme).toHaveBeenCalledTimes(writes);
    },
  );

  it("follows OS changes in System rather than locking the first resolved palette", () => {
    const model = fixture("light", "system");
    act(() => {
      tree = create(<model.App />);
    });
    act(() => model.setSystem("dark"));
    expect(model.theme().isDark).toBe(true);
    expect(model.Uniwind.currentTheme).toBe("dark");
    act(() => model.setSystem("light"));
    expect(model.theme().isDark).toBe(false);
    expect(model.Uniwind.hasAdaptiveThemes).toBe(true);
  });

  it.each(["light", "dark"] as const)("keeps explicit %s stable when OS changes", (mode) => {
    const model = fixture(mode === "light" ? "dark" : "light", mode);
    act(() => {
      tree = create(<model.App />);
    });
    act(() => model.setSystem(mode));
    act(() => model.setSystem(mode === "light" ? "dark" : "light"));
    expect(model.theme().mode).toBe(mode);
    expect(model.theme().colors).toEqual(themeColors.makeThemeColors(mode));
    expect(model.Uniwind.currentTheme).toBe(mode);
    expect(model.Uniwind.hasAdaptiveThemes).toBe(false);
  });

  it.each(["light", "dark"] as const)(
    "establishes an explicit %s override even when the system already has that palette",
    (mode) => {
      const model = fixture(mode, mode);
      act(() => {
        tree = create(<model.App />);
      });
      expect(model.Uniwind.currentTheme).toBe(mode);
      expect(model.Uniwind.hasAdaptiveThemes).toBe(false);
      expect(model.Appearance.setColorScheme).toHaveBeenCalledExactlyOnceWith(mode);
      act(() => model.setSystem(mode === "light" ? "dark" : "light"));
      expect(model.theme().isDark).toBe(mode === "dark");
      expect(model.Appearance.setColorScheme).toHaveBeenCalledTimes(1);
    },
  );
});
