import { foregroundForBackground } from "@/styles/foreground-for-background";
import { spacing } from "@/styles/theme";
import { Host, ModalBottomSheet, RNHostView } from "@expo/ui/jetpack-compose";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CharacterProfileSheetProps } from "./CharacterProfileSheet";

export function CharacterProfileSheet({
  children,
  onDismiss,
  backgroundColor,
  portraitReady,
}: CharacterProfileSheetProps) {
  const { isDark } = foregroundForBackground(backgroundColor);
  const { height: windowHeight } = useWindowDimensions();
  const { top, bottom } = useSafeAreaInsets();
  const sheetHeight = windowHeight - top - spacing.sm;
  return (
    <Host colorScheme={isDark ? "dark" : "light"} style={{ flex: 1 }}>
      <ModalBottomSheet
        onDismissRequest={onDismiss}
        containerColor={backgroundColor}
        edgeToEdgeContent
        overlayDragHandle
        showDragHandle
        skipPartiallyExpanded
      >
        <RNHostView matchContents>
          {portraitReady ? (
            <View style={{ height: sheetHeight }}>{children}</View>
          ) : (
            <ScrollView
              style={{ flexGrow: 0, maxHeight: sheetHeight }}
              contentContainerStyle={{ paddingBottom: bottom }}
              contentInsetAdjustmentBehavior="never"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          )}
        </RNHostView>
      </ModalBottomSheet>
    </Host>
  );
}
