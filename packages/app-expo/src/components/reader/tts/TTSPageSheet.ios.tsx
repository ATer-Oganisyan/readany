import { NativeSheetNavigationBar } from "@/components/ui/NativeSheetNavigationBar";
import { useTheme } from "@/styles/theme";
import { BottomSheet, Group, Host, RNHostView } from "@expo/ui/swift-ui";
import { presentationDetents, presentationDragIndicator } from "@expo/ui/swift-ui/modifiers";
import { PlatformColor, StyleSheet, View } from "react-native";
import type { TTSPageSheetProps } from "./TTSPageSheet.types";

export function TTSPageSheet({ visible, onClose, children }: TTSPageSheetProps) {
  const { isDark } = useTheme();

  return (
    <Host colorScheme={isDark ? "dark" : "light"} style={styles.host}>
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={(isPresented) => {
          if (!isPresented && visible) onClose();
        }}
      >
        <Group modifiers={[presentationDetents(["large"]), presentationDragIndicator("visible")]}>
          <RNHostView>
            <View style={[styles.content, { backgroundColor: PlatformColor("systemBackground") }]}>
              {children}
              <NativeSheetNavigationBar
                isDark={isDark}
                onClosePress={onClose}
                style={styles.navigationBar}
              />
            </View>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 1,
    height: 1,
  },
  content: {
    flex: 1,
  },
  navigationBar: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    height: 44,
    zIndex: 10,
  },
});

export type { TTSPageSheetProps } from "./TTSPageSheet.types";
