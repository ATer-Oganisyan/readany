import type { ReactNode } from "react";
import { Platform } from "react-native";
import { FullWindowOverlay } from "react-native-screens";

/** Notifications stay above screens without making the reading UI AX-modal. */
export function ToastOverlay({ children }: { children: ReactNode }) {
  if (Platform.OS !== "ios") return <>{children}</>;
  return (
    <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
      {children}
    </FullWindowOverlay>
  );
}
