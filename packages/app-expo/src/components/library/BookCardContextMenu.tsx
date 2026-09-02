import { radius, useColors } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import { Alert, type AlertButton, Pressable, StyleSheet, View } from "react-native";
import type { BookCardContextMenuProps } from "./BookCardContextMenu.types";

export function BookCardContextMenu({
  accessibilityLabel,
  children,
  items,
  onPress,
}: BookCardContextMenuProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const openMenu = () => {
    const buttons: AlertButton[] = [
      ...items.map(
        (item): AlertButton => ({
          text: item.label,
          style: item.destructive ? "destructive" : "default",
          onPress: item.onPress,
        }),
      ),
      { text: t("common.cancel", "Отмена"), style: "cancel" },
    ];
    Alert.alert(accessibilityLabel, undefined, buttons);
  };

  return (
    <View>
      {children}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={t("common.holdForMenu", "Удерживайте, чтобы открыть меню")}
        style={[StyleSheet.absoluteFill, styles.pressTarget]}
        onPress={onPress}
        onLongPress={openMenu}
        android_ripple={
          process.env.EXPO_OS === "android"
            ? { color: colors.primary5, foreground: true }
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // The overlay owns only touch feedback, so clipping the ripple does not cut
  // off the book shadow rendered by the card underneath it.
  pressTarget: {
    borderRadius: radius.sm,
    overflow: "hidden",
  },
});

export type { BookCardContextMenuProps } from "./BookCardContextMenu.types";
