import { XIcon } from "@/components/ui/Icon";
import { useColors } from "@/styles/theme";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TTSPageSheetProps } from "./TTSPageSheet.types";

export function TTSPageSheet({ visible, onClose, children }: TTSPageSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      hardwareAccelerated
      onRequestClose={onClose}
    >
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.appBar, { paddingTop: Math.max(insets.top, 8) }]}>
          <Pressable
            onPress={onClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Закрыть озвучку"
          >
            <XIcon size={20} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={[styles.content, { borderTopColor: colors.border }]}>{children}</View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  appBar: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "flex-end",
  },
  closeButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  content: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth },
});

export type { TTSPageSheetProps } from "./TTSPageSheet.types";
