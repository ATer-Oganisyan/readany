import { XIcon } from "@/components/ui/Icon";
import { useColors } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import type { TTSPageSheetProps } from "./TTSPageSheet.types";

export function TTSPageSheet({ visible, onClose, children }: TTSPageSheetProps) {
  const colors = useColors();
  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      hardwareAccelerated
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel={t("tts.closePlayer", "Закрыть озвучку")}
        />
        <View style={[styles.screen, { backgroundColor: colors.background }]}>
          <View style={[styles.appBar, { paddingTop: 8 }]}>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel={t("tts.closePlayer", "Закрыть озвучку")}
            >
              <XIcon size={20} color={colors.foreground} />
            </Pressable>
          </View>
          <View style={[styles.content, { borderTopColor: colors.border }]}>{children}</View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { height: "80%", borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
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
