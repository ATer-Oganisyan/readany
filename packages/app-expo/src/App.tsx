import { Text } from "@/components/ui/Typography";
/**
 * Narra Expo App — Root component
 *
 * Initialises platform service, i18n, and mounts navigation.
 */

// Polyfill AbortSignal.throwIfAborted — missing in Hermes, required by LangChain
if (typeof AbortSignal !== "undefined" && !AbortSignal.prototype.throwIfAborted) {
  AbortSignal.prototype.throwIfAborted = function () {
    if (this.aborted) {
      const err = this.reason ?? new Error("The operation was aborted.");
      throw err;
    }
  };
}

// Polyfill navigator.userAgent for LangChain — React Native doesn't have userAgent
if (typeof navigator !== "undefined" && !navigator.userAgent) {
  Object.defineProperty(navigator, "userAgent", {
    get: () => "ReactNative",
    configurable: true,
  });
}

import { interfaceFontAssets } from "@deslop/primitives/native";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { LogBox, Platform, View, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { rnSessionEventSource } from "@/hooks";
import { setStreamingFetch } from "@readany/core/ai/llm-provider";
import { initDatabase } from "@readany/core/db/database";
import { setSessionEventSource } from "@readany/core/hooks/use-reading-session";
import { i18nReady, initI18nLanguage } from "@readany/core/i18n";
import i18n from "@readany/core/i18n";
import { setPlatformService } from "@readany/core/services";
import { setSyncAdapter } from "@readany/core/sync";
import { setAudioModeAsync } from "expo-audio";
import { I18nextProvider } from "react-i18next";
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Event as TrackEvent,
  Capability,
} from "react-native-track-player";

import { CatalogCharacterPortraitPreloader } from "@/components/catalog/CatalogCharacterPortraitPreloader";
import { AnimatedSplash } from "@/components/splash/AnimatedSplash";
import { UpdateDialog } from "@/components/update/UpdateDialog";
import { useUpdateChecker } from "@/hooks/use-update-checker";
import { startTelemetry } from "@/lib/analytics/telemetry";
import { navigationRef } from "@/lib/navigationRef";
import { ExpoPlatformService } from "@/lib/platform/expo-platform-service";
import { seekActiveTTS, seekActiveTTSBy } from "@/lib/platform/tts-track-controls";
import { MobileSyncAdapter } from "@/lib/sync/sync-adapter-mobile";
import { RootNavigator } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores/library-store";
import {
  type ThemeMode,
  ThemeProvider,
  loadStoredThemeMode,
  useTheme,
} from "@/styles/ThemeContext";
import { useAutoSync } from "@readany/core/hooks/use-auto-sync";

// iOS New-Arch + expo-dev-client cold-start: when dev-client swaps its boot
// RCTInstance for the app's instance, RCTTurboModuleManager waits up to 10s for
// every TurboModule's invalidate to return. If any module's method queue is slow
// (e.g. react-native-track-player v4, whose v4 branch is frozen and does not
// fully support RN 0.81 New Arch), the wait times out and prints RCTLogError —
// triggering a red-box. State clears correctly afterwards (see
// RCTTurboModuleManager.mm:1105), so the warning is purely cosmetic dev noise.
if (Platform.OS === "ios") {
  LogBox.ignoreLogs([/TurboModuleManager: Timed out waiting for modules to be invalidated/]);
}

// Keep the native splash screen visible while we bootstrap
SplashScreen.setOptions({ duration: 180, fade: true });
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const systemColorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts(interfaceFontAssets);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [initialThemeMode, setInitialThemeMode] = useState<ThemeMode | null>(null);
  const [splashFinished, setSplashFinished] = useState(false);

  useEffect(() => startTelemetry(), []);

  // The first React frame contains the same centered artwork as the native
  // launch screen, so it is safe to reveal the animated handoff immediately.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    async function bootstrap() {
      try {
        console.log("[App] bootstrap: register platform service");
        const platform = new ExpoPlatformService();
        setPlatformService(platform);

        console.log("[App] bootstrap: register sync adapter");
        setSyncAdapter(new MobileSyncAdapter());

        console.log("[App] bootstrap: init database");
        await initDatabase();

        console.log("[App] bootstrap: wait i18nReady");
        await i18nReady;
        console.log("[App] i18n initialized successfully");

        console.log("[App] bootstrap: register RN session source");
        setSessionEventSource(rnSessionEventSource);

        console.log("[App] bootstrap: init language");
        await initI18nLanguage();

        console.log("[App] bootstrap: load theme");
        setInitialThemeMode(await loadStoredThemeMode());

        console.log("[App] bootstrap: import expo/fetch");
        const { fetch: expoFetch } = await import("expo/fetch");
        setStreamingFetch(expoFetch as typeof globalThis.fetch);

        console.log("[App] bootstrap: configure audio mode");
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: "duckOthers",
        });

        console.log("[App] bootstrap: init react-native-track-player");
        // setupPlayer can only be called once per native process. On Android,
        // a Configuration Change (e.g. Huawei tablet small-screen → fullscreen)
        // restarts the Activity and re-runs this bootstrap, but the native
        // singleton is still alive — so setupPlayer() throws
        // "The player has already been initialized via setupPlayer".
        // Treat that specific error as success so bootstrap can continue.
        try {
          await TrackPlayer.setupPlayer();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!/already been initialized/i.test(msg)) throw e;
          console.log("[App] TrackPlayer already initialized — reusing existing native instance");
        }
        await TrackPlayer.updateOptions({
          android: {
            appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
            alwaysPauseOnInterruption: false,
          },
          backwardJumpInterval: 15,
          forwardJumpInterval: 15,
          stoppingAppPausesPlayback: false,
          capabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.Stop,
            Capability.SeekTo,
            Capability.JumpBackward,
            Capability.JumpForward,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
          ],
          compactCapabilities: [Capability.Play, Capability.Pause],
          notificationCapabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.Stop,
            Capability.SeekTo,
            Capability.JumpBackward,
            Capability.JumpForward,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
          ],
        });

        // Remote event → TTS store bridge
        const { useTTSStore: ttsStore } = await import("@/stores/tts-store");
        TrackPlayer.addEventListener(TrackEvent.RemotePlay, () => {
          ttsStore.getState().resume();
        });
        TrackPlayer.addEventListener(TrackEvent.RemotePause, () => {
          ttsStore.getState().pause();
        });
        TrackPlayer.addEventListener(TrackEvent.RemoteStop, () => {
          ttsStore.getState().stop();
        });
        TrackPlayer.addEventListener(TrackEvent.RemoteSeek, ({ position }) => {
          void seekActiveTTS(position);
        });
        TrackPlayer.addEventListener(TrackEvent.RemoteJumpBackward, ({ interval }) => {
          void seekActiveTTSBy(-interval);
        });
        TrackPlayer.addEventListener(TrackEvent.RemoteJumpForward, ({ interval }) => {
          void seekActiveTTSBy(interval);
        });
        TrackPlayer.addEventListener(TrackEvent.RemoteNext, () => {
          const { jumpToChunk, currentChunkIndex, totalChunks } = ttsStore.getState();
          const nextIndex = currentChunkIndex + 1;
          if (nextIndex < totalChunks) {
            jumpToChunk(nextIndex);
          }
        });
        TrackPlayer.addEventListener(TrackEvent.RemotePrevious, () => {
          const { jumpToChunk, currentChunkIndex } = ttsStore.getState();
          const prevIndex = currentChunkIndex - 1;
          if (prevIndex >= 0) {
            jumpToChunk(prevIndex);
          }
        });

        console.log("[App] bootstrap: done");
        setReady(true);
      } catch (error) {
        console.error("[App] bootstrap failed:", error);
        setBootError(error instanceof Error ? error.message : String(error));
      }
    }
    bootstrap();
  }, []);

  const startupError = bootError ?? fontError?.message ?? null;
  const appReady = startupError !== null || (ready && fontsLoaded && initialThemeMode !== null);
  const splash = splashFinished ? null : (
    <AnimatedSplash appReady={appReady} onFinish={() => setSplashFinished(true)} />
  );

  if (startupError) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#1c1c1e",
        }}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <Text
            style={{
              color: "#ffffff",
              fontSize: 18,
              fontWeight: "600",
              marginBottom: 12,
              textAlign: "center",
            }}
          >
            Не удалось запустить приложение
          </Text>
          <Text style={{ color: "#fca5a5", fontSize: 14, textAlign: "center" }}>
            {startupError}
          </Text>
        </View>
        {splash}
      </View>
    );
  }

  if (!ready || !fontsLoaded || initialThemeMode === null) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: systemColorScheme === "dark" ? "#000000" : "#FFFFFF",
        }}
      >
        {/* Background matches the native launch screen so transition is seamless. */}
        {splash}
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: systemColorScheme === "dark" ? "#000000" : "#FFFFFF",
      }}
    >
      <I18nextProvider i18n={i18n}>
        <ThemeProvider initialMode={initialThemeMode}>
          <AppInner />
        </ThemeProvider>
      </I18nextProvider>
      {splash}
    </View>
  );
}

function AppInner() {
  const { colors, isDark } = useTheme();
  const loadBooks = useLibraryStore((s) => s.loadBooks);
  useUpdateChecker();
  useAutoSync(loadBooks);

  const navTheme = useMemo(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
        background: colors.background,
        card: colors.card,
        text: colors.foreground,
        border: colors.border,
        primary: colors.primary,
      },
    }),
    [colors, isDark],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <CatalogCharacterPortraitPreloader />
        {Platform.OS !== "ios" && <StatusBar style={isDark ? "light" : "dark"} />}
        <NavigationContainer theme={navTheme} ref={navigationRef}>
          <RootNavigator />
        </NavigationContainer>
        <UpdateDialog />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
