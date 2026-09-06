import { useCallback, useEffect, useRef, useState } from "react";

export function useReaderControls(focused: boolean, loading: boolean, timeoutMs = 3000) {
  const [showControls, updateShowControls] = useState(true);
  const hasExplicitIntent = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearTimer = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const setShowControls = useCallback<typeof updateShowControls>(
    (value) => {
      hasExplicitIntent.current = true;
      clearTimer();
      updateShowControls((visible) =>
        typeof value === "function" ? value(loading || visible) : value,
      );
    },
    [clearTimer, loading],
  );
  useEffect(() => {
    clearTimer();
    // Returning from a sheet must not replace a deliberate choice with a new
    // introductory timeout. Loading is a temporary visibility override below.
    if (!focused || hasExplicitIntent.current) return;
    updateShowControls(true);
    // Loading must never hide the way out. Only introductory chrome auto-hides.
    if (!loading) timer.current = setTimeout(() => updateShowControls(false), timeoutMs);
    return clearTimer;
  }, [focused, loading, timeoutMs, clearTimer]);
  const toggleControls = useCallback(() => {
    setShowControls((visible) => !visible);
    // An explicit request stays open until the reader dismisses it.
  }, [setShowControls]);
  return { showControls: loading || showControls, setShowControls, toggleControls };
}
