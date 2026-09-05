import { type EffectCallback, Profiler } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  focused: false,
  focusListeners: new Set<() => void>(),
  commits: vi.fn(),
  save: vi.fn(async () => {}),
  stop: vi.fn(),
  navigation: { navigate: vi.fn() },
  theme: {
    colors: { foreground: "#111", background: "#fff", primary: "#123456" },
    mode: "system",
    isDark: false,
    setMode: vi.fn(),
  },
}));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TouchableOpacity: "TouchableOpacity",
  View: "View",
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 0.5 },
}));
vi.mock("@/components/profile/ProfileNumericText", () => ({ ProfileNumericText: "NumericText" }));
vi.mock("@/components/settings/NativeSettingsPicker", () => ({ NativeSettingsPicker: "Picker" }));
vi.mock("@/components/ui/NativeSymbol", () => ({ NativeSymbol: "Symbol" }));
vi.mock("@/components/ui/ScrollViewMarker", () => ({ ScrollViewMarker: "ScrollViewMarker" }));
vi.mock("@/components/ui/Typography", () => ({ Text: "Text" }));
vi.mock("@/hooks/use-responsive-layout", () => ({
  useResponsiveLayout: () => ({ isTablet: false }),
}));
vi.mock("@/lib/diagnostics/diagnostics", () => ({ shareDiagnosticLogs: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/platform/mobile-cache", () => ({
  clearMobileRuntimeCache: vi.fn(),
  formatCacheSize: vi.fn(),
}));
vi.mock("@/lib/platform/tts-preview", () => ({ stopTTSPreview: vi.fn() }));
vi.mock("@/styles/theme", () => ({
  useTheme: () => runtime.theme,
  useColors: () => runtime.theme.colors,
  fontSize: {},
  fontWeight: {},
  headingFontFamily: {},
  radius: {},
  spacing: {},
  withOpacity: (color: string) => color,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: "en" } }),
}));
vi.mock("@readany/core/i18n", () => ({ changeAndPersistLanguage: vi.fn() }));
vi.mock("@readany/core/utils/event-bus", () => ({ eventBus: { on: () => () => {} } }));
vi.mock("@readany/core/stats", async () => ({
  ...(await import("../../../../core/src/stats/live-reading-stats")),
  readingStatsService: {
    getDailyStats: async () => [
      { date: new Date().toISOString().slice(0, 10), totalTime: 2, pagesRead: 1, sessionsCount: 1 },
    ],
    getOverallStats: async () => ({
      totalBooks: 1,
      totalReadingTime: 2,
      totalSessions: 1,
      totalReadingDays: 1,
      avgDailyTime: 2,
      longestStreak: 1,
      currentStreak: 1,
    }),
  },
}));
vi.mock("@/stores", async () => ({
  ...(await import("../../../../core/src/stores/reading-session-store")),
  useTTSStore: (select: (state: { stop: typeof runtime.stop }) => unknown) =>
    select({ stop: runtime.stop }),
}));
vi.mock("@react-navigation/native", async () => {
  const { useEffect, useSyncExternalStore } = await import("react");
  const useIsFocused = () =>
    useSyncExternalStore(
      (listener) => {
        runtime.focusListeners.add(listener);
        return () => runtime.focusListeners.delete(listener);
      },
      () => runtime.focused,
    );
  return {
    useNavigation: () => runtime.navigation,
    useIsFocused,
    useFocusEffect: (callback: EffectCallback) => {
      const focused = useIsFocused();
      useEffect(() => (focused ? callback() : undefined), [focused, callback]);
    },
  };
});

import { ProfileScreen } from "@/screens/ProfileScreen";
import { useReadingSessionStore } from "../../../../core/src/stores/reading-session-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("__DEV__", true);
  runtime.focused = false;
  useReadingSessionStore.setState({
    sessionState: "ACTIVE",
    currentSession: {
      id: "session",
      bookId: "book",
      state: "ACTIVE",
      startedAt: Date.now(),
      totalActiveTime: 0,
      pagesRead: 0,
    },
    saveCurrentSession: runtime.save,
  });
});
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    tree = create(
      <Profiler id="profile" onRender={runtime.commits}>
        <ProfileScreen />
      </Profiler>,
    );
  });
  act(() => {
    tree?.root
      .find((node) => String(node.type) === "View" && typeof node.props.onLayout === "function")
      .props.onLayout({ nativeEvent: { layout: { width: 320 } } });
  });
  expect(
    tree?.root.findAll((node) => String(node.type) === "TouchableOpacity").length,
  ).toBeGreaterThanOrEqual(112);
}
async function focus(focused: boolean) {
  await act(async () => {
    runtime.focused = focused;
    for (const listener of runtime.focusListeners) listener();
  });
}
function tick(seconds: number) {
  // The real production action and real Zustand subscriptions are used; each
  // tick is a separate update, as it is on the native one-second timer.
  for (let index = 0; index < seconds; index++)
    act(() => useReadingSessionStore.getState().updateActiveTime());
}
function totalText() {
  return tree?.root.findAll((node) => String(node.type) === "NumericText")[0].props.value;
}

describe("ProfileScreen focus-aware live reading stats", () => {
  it("does not commit a hidden profile on any of 60 real session ticks", async () => {
    await mount();
    runtime.commits.mockClear();
    tick(60);
    expect(useReadingSessionStore.getState().currentSession?.totalActiveTime).toBe(60_000);
    expect(runtime.commits).not.toHaveBeenCalled();
  });
  it("keeps visible statistics live and arithmetically correct", async () => {
    runtime.focused = true;
    await mount();
    expect(totalText()).toBe("2\u00a0common.minutes");
    tick(60);
    expect(totalText()).toBe("3\u00a0common.minutes");
  });
  it("catches up on focus after hidden ticks, then stops re-rendering after blur", async () => {
    await mount();
    tick(60);
    await focus(true);
    expect(totalText()).toBe("3\u00a0common.minutes");
    await focus(false);
    runtime.commits.mockClear();
    tick(60);
    expect(runtime.commits).not.toHaveBeenCalled();
    await focus(true);
    expect(totalText()).toBe("4\u00a0common.minutes");
    expect(runtime.save).toHaveBeenCalledTimes(2);
  });
});
