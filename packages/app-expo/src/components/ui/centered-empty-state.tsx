import { fontSize, fontWeight, useColors, withOpacity } from "@/styles/theme";
import { interfaceFontFamily } from "@deslop/primitives/native";
import type { ReactNode } from "react";
import { Platform, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Typography";

interface CenteredEmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
  variant?: "default" | "compact";
  avoidNativeTabBar?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Shared empty state for full-screen and section-level content gaps. */
export function CenteredEmptyState({
  title,
  description,
  icon,
  children,
  variant = "default",
  avoidNativeTabBar = false,
  style,
}: CenteredEmptyStateProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const nativeTabBarHeight = Platform.OS === "android" ? 80 : Platform.OS === "ios" ? 49 : 0;
  const bottomInset = avoidNativeTabBar ? nativeTabBarHeight + insets.bottom : 0;

  return (
    <View
      style={[
        styles.container,
        variant === "compact" && styles.compactContainer,
        bottomInset > 0 && { paddingBottom: bottomInset },
        style,
      ]}
    >
      <View style={styles.content}>
        {icon ? (
          <View
            style={[
              styles.icon,
              {
                backgroundColor: withOpacity(colors.muted, 0.2),
                borderColor: withOpacity(colors.border, 0.3),
              },
            ]}
          >
            {icon}
          </View>
        ) : null}
        <View style={[styles.copy, variant === "compact" && styles.compactCopy]}>
          <Text
            style={[
              styles.title,
              variant === "compact" && styles.compactTitle,
              { color: colors.foreground },
            ]}
          >
            {title}
          </Text>
          {description ? (
            <Text
              style={[
                styles.description,
                variant === "compact" && styles.compactDescription,
                { color: colors.mutedForeground },
              ]}
            >
              {description}
            </Text>
          ) : null}
        </View>
        {children ? <View style={styles.action}>{children}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { width: "100%", maxWidth: 300, alignItems: "center" },
  compactContainer: { flex: 0, width: "100%", paddingVertical: 40 },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  copy: { alignItems: "center", gap: 8 },
  compactCopy: { gap: 4 },
  title: {
    fontFamily: interfaceFontFamily.semibold,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    textAlign: "center",
  },
  compactTitle: { fontSize: fontSize.base, opacity: 0.75 },
  description: {
    fontFamily: interfaceFontFamily.regular,
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * 1.3,
    textAlign: "center",
    maxWidth: 240,
  },
  compactDescription: { fontSize: fontSize.sm, opacity: 0.5 },
  action: { alignItems: "center", marginTop: 24 },
});
