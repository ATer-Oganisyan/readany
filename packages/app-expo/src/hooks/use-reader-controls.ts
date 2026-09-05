import { useCallback, useEffect, useRef, useState } from "react";

export function useReaderControls(focused: boolean, loading: boolean, timeoutMs = 3000) {
  const [showControls, setShowControls] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearTimer = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => {
    clearTimer();
    if (!focused) return;
    setShowControls(true);
    // Loading must never hide the way out. Only introductory chrome auto-hides.
    if (!loading) timer.current = setTimeout(() => setShowControls(false), timeoutMs);
    return clearTimer;
  }, [focused, loading, timeoutMs, clearTimer]);
  const toggleControls = useCallback(() => {
    clearTimer();
    setShowControls((visible) => !visible);
    // An explicit request stays open until the reader dismisses it.
  }, [clearTimer]);
  return { showControls, setShowControls, toggleControls };
}
