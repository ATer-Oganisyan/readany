/**
 * useReaderSystemInfo — manages the system status bar and safe area inset.
 */
import { setStatusBarHidden } from "expo-status-bar";
import { useEffect, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface UseReaderSystemInfoOptions {
  showSearch: boolean;
  isIPadLayout: boolean;
  shouldToggleSystemStatusBar: boolean;
  baseTopInset: number;
}

export interface UseReaderSystemInfoResult {
  stableTopInset: number;
  insets: ReturnType<typeof useSafeAreaInsets>;
}

export function useReaderSystemInfo({
  showSearch,
  isIPadLayout,
  shouldToggleSystemStatusBar,
  baseTopInset,
}: UseReaderSystemInfoOptions): UseReaderSystemInfoResult {
  const insets = useSafeAreaInsets();

  const [stableTopInset, setStableTopInset] = useState(() =>
    Math.max(insets.top, isIPadLayout ? 24 : baseTopInset),
  );

  // Status bar
  useEffect(() => {
    if (!shouldToggleSystemStatusBar) {
      setStatusBarHidden(false, "none");
      return;
    }
    setStatusBarHidden(!showSearch, "slide");
  }, [showSearch, shouldToggleSystemStatusBar]);

  useEffect(() => {
    return () => {
      setStatusBarHidden(false, "slide");
    };
  }, []);

  // Stable top inset
  useEffect(() => {
    const nextInset = Math.max(insets.top, isIPadLayout ? 24 : baseTopInset);
    setStableTopInset((prev) => {
      if (isIPadLayout) return Math.max(prev, nextInset);
      return nextInset;
    });
  }, [baseTopInset, insets.top, isIPadLayout]);

  return { stableTopInset, insets };
}
