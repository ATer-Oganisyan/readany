import { type ReactNode, createContext, useCallback, useContext, useMemo, useRef } from "react";

interface SwipePressGuardValue {
  beginSwipe: () => void;
  canPress: () => boolean;
  endSwipe: () => void;
}

const SwipePressGuardContext = createContext<SwipePressGuardValue | null>(null);

export function SwipePressGuardProvider({ children }: { children: ReactNode }) {
  const swipeActiveRef = useRef(false);
  const suppressPressUntilRef = useRef(0);

  const beginSwipe = useCallback(() => {
    swipeActiveRef.current = true;
    suppressPressUntilRef.current = Number.POSITIVE_INFINITY;
  }, []);

  const endSwipe = useCallback(() => {
    swipeActiveRef.current = false;
    // iOS may deliver the release press immediately after PagerView becomes idle.
    suppressPressUntilRef.current = Date.now() + 120;
  }, []);

  const canPress = useCallback(
    () => !swipeActiveRef.current && Date.now() >= suppressPressUntilRef.current,
    [],
  );

  const value = useMemo(
    () => ({ beginSwipe, canPress, endSwipe }),
    [beginSwipe, canPress, endSwipe],
  );

  return (
    <SwipePressGuardContext.Provider value={value}>{children}</SwipePressGuardContext.Provider>
  );
}

export function useSwipePressGuard() {
  return useContext(SwipePressGuardContext);
}
