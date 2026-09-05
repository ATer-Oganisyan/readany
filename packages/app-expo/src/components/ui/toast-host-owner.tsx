import { createContext, useContext, type ReactNode } from "react";

export type ToastHostRoute = { name: string; key: string } | undefined;
const OwnerContext = createContext<string | null>(null);

export function ToastHostOwner({
  route,
  children,
}: { route: ToastHostRoute; children: ReactNode }) {
  return (
    <OwnerContext.Provider value={route?.name === "Reader" ? route.key : null}>
      {children}
    </OwnerContext.Provider>
  );
}

/** The same snapshot selects both sites, so no independently racing focus flags. */
export function ToastHostSlot({
  readerKey,
  children,
}: { readerKey?: string; children: ReactNode }) {
  const owner = useContext(OwnerContext);
  return owner === (readerKey ?? null) ? <>{children}</> : null;
}
