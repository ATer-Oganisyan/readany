import { foregroundForBackground } from "@/styles/foreground-for-background";
import { Host, ModalBottomSheet, RNHostView } from "@expo/ui/jetpack-compose";
import type { AudiobookPlayerSheetProps } from "./audiobook-player-sheet";

export function AudiobookPlayerSheet({
  children,
  onDismiss,
  backgroundColor,
}: AudiobookPlayerSheetProps) {
  const { isDark, primary } = foregroundForBackground(backgroundColor);
  return (
    <Host style={{ flex: 1 }} colorScheme={isDark ? "dark" : "light"}>
      <ModalBottomSheet
        onDismissRequest={onDismiss}
        containerColor={backgroundColor}
        contentColor={primary}
        skipPartiallyExpanded
        showDragHandle
      >
        <RNHostView matchContents>{children}</RNHostView>
      </ModalBottomSheet>
    </Host>
  );
}
