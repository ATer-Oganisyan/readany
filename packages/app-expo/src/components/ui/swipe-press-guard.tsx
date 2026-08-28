import { type SwipePressGuard, createSwipePressGuard } from "@/lib/narra/swipe-press-guard";
import { createSwipePressGuardBinding } from "@/lib/narra/swipe-press-guard-binding";
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";

const SwipePressGuardContext = createContext<SwipePressGuard | null>(null);

export function SwipePressGuardProvider({ children }: { children: ReactNode }) {
  const [guard] = useState(createSwipePressGuard);

  useEffect(() => () => guard.reset(), [guard]);

  return (
    <SwipePressGuardContext.Provider value={guard}>{children}</SwipePressGuardContext.Provider>
  );
}

/**
 * Each hook owns only its own scroll/pager leases. The shared provider identity
 * stays stable while gestures change, so cards do not rerender on focus/swipes.
 * Spread touchHandlers on the existing screen and scroll wrappers; keep action
 * ownership in Pressable and call canPress(event) only at its action boundary.
 */
export function useSwipePressGuard() {
  const guard = useContext(SwipePressGuardContext);
  const binding = useMemo(() => (guard ? createSwipePressGuardBinding(guard) : null), [guard]);

  useEffect(() => {
    binding?.activate();
    return () => binding?.dispose();
  }, [binding]);

  return binding;
}
