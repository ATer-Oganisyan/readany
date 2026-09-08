import { NativeContextMenuButton } from "@/components/ui/NativeContextMenuButton.android";
import { radius, useColors } from "@/styles/theme";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import type { BookCardContextMenuProps } from "./BookCardContextMenu.types";

export function BookCardContextMenu({
  accessibilityLabel,
  children,
  items,
  onPress,
}: BookCardContextMenuProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const openMenu = () => setExpanded(true);

  return (
    <View>
      {children}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={t("common.holdForMenu", "Удерживайте, чтобы открыть меню")}
        accessibilityActions={[{ name: "longpress", label: accessibilityLabel }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "longpress") openMenu();
        }}
        style={[StyleSheet.absoluteFill, styles.pressTarget]}
        onPress={onPress}
        onLongPress={openMenu}
        android_ripple={{ color: colors.primary5, foreground: true }}
      />
      {/* Keep card touches in the RN tree: hosting the card in Compose cancels the swipe guard. */}
      <View style={{ position: "absolute", left: 0, bottom: 0 }}>
        <NativeContextMenuButton
          accessibilityLabel={accessibilityLabel}
          items={items}
          expanded={expanded}
          onOpenChange={setExpanded}
          renderTrigger={() => <View style={{ width: 1, height: 1 }} />}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressTarget: {
    borderRadius: radius.sm,
    overflow: "hidden",
  },
});

export type { BookCardContextMenuProps } from "./BookCardContextMenu.types";
