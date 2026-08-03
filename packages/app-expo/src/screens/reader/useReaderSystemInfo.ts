/**
 * useReaderSystemInfo — keeps the reader's safe area inset stable.
 */
import { useEffect, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface UseReaderSystemInfoOptions {
  isIPadLayout: boolean;
  baseTopInset: number;
}

export interface UseReaderSystemInfoResult {
  stableTopInset: number;
  insets: ReturnType<typeof useSafeAreaInsets>;
}

export function useReaderSystemInfo({
  isIPadLayout,
  baseTopInset,
}: UseReaderSystemInfoOptions): UseReaderSystemInfoResult {
  const insets = useSafeAreaInsets();

  const [stableTopInset, setStableTopInset] = useState(() =>
    Math.max(insets.top, isIPadLayout ? 24 : baseTopInset),
  );

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
