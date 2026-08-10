import { Text } from "@/components/ui/Typography";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useTheme } from "@/styles/theme";
import type { ReactNode } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

export interface CharacterChatListItem {
  key: string;
  accessibilityLabel: string;
  avatar: ReactNode;
  title: string;
  subtitle?: string;
  dimmed?: boolean;
  onPress: () => void;
}

interface CharacterChatListProps {
  items: CharacterChatListItem[];
}

export function CharacterChatList({ items }: CharacterChatListProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View>
      {items.map((item, index) => (
        <View key={item.key}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={item.accessibilityLabel}
            activeOpacity={0.62}
            onPress={item.onPress}
            style={[styles.row, item.dimmed && styles.rowDimmed]}
          >
            {item.avatar}
            <View style={styles.copy}>
              <Text style={styles.title} numberOfLines={1}>
                {item.title}
              </Text>
              {item.subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {item.subtitle}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
          {index < items.length - 1 ? <View style={styles.separator} /> : null}
        </View>
      ))}
    </View>
  );
}

export function CharacterChatAvatar({
  children,
  muted = false,
  overlay,
}: {
  children: ReactNode;
  muted?: boolean;
  overlay?: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={[styles.avatar, muted && styles.avatarMuted]}>
      {children}
      {overlay ? <View style={styles.avatarOverlay}>{overlay}</View> : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      minHeight: 80,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.lg,
      paddingVertical: spacing.md,
    },
    rowDimmed: { opacity: 0.45 },
    avatar: {
      width: 56,
      height: 56,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    avatarMuted: { backgroundColor: colors.elevation2 },
    avatarOverlay: {
      ...StyleSheet.absoluteFill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.3)",
    },
    copy: { flex: 1, gap: 2 },
    title: {
      color: colors.foreground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    subtitle: {
      color: colors.mutedForeground,
      fontSize: fontSize.base,
      lineHeight: 20,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: 56 + spacing.lg,
      backgroundColor: colors.border,
    },
  });
