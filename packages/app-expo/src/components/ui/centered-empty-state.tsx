import { getNativeTabBarContentInset } from "@/platform/navigation/native-tab-bar";
import { fontSize, fontWeight, headingFontFamily, useColors } from "@/styles/theme";
import type { ReactNode } from "react";
import { Platform, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Typography";

interface CenteredEmptyStateProps {
  title: string;
  description: string;
  children: ReactNode;
  avoidNativeTabBar?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Shared centered empty state for adjacent top-level tabs. */
export function CenteredEmptyState({
  title,
  description,
  children,
  avoidNativeTabBar = false,
  style,
}: CenteredEmptyStateProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomInset = avoidNativeTabBar
    ? getNativeTabBarContentInset(Platform.OS, insets.bottom)
    : 0;

  return (
    <View style={[styles.container, bottomInset > 0 && { paddingBottom: bottomInset }, style]}>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.description, { color: colors.mutedForeground }]}>{description}</Text>
      </View>
      <View style={styles.action}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  copy: { alignItems: "center", gap: 8 },
  title: {
    fontFamily: headingFontFamily,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  description: { fontSize: fontSize.sm, textAlign: "center", maxWidth: 240 },
  action: { alignItems: "center", marginTop: 24 },
});
