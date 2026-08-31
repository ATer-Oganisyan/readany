import { Text } from "@/components/ui/Typography";
import { countRender } from "@/lib/diagnostics/interaction-performance";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useTheme } from "@/styles/theme";
import { type ReactNode, memo } from "react";
import { type GestureResponderEvent, StyleSheet, TouchableOpacity, View } from "react-native";

export interface CharacterChatListItem {
  key: string;
  accessibilityLabel: string;
  avatar: ReactNode;
  title: string;
  subtitle?: string;
  dimmed?: boolean;
  disabled?: boolean;
  onPress: (event?: GestureResponderEvent) => void;
}

interface CharacterChatListProps {
  items: readonly CharacterChatListItem[];
}

export const CharacterChatList = memo(function CharacterChatList({
  items,
}: CharacterChatListProps) {
  return (
    <View>
      {items.map((item, index) => (
        <CharacterChatListRow key={item.key} item={item} separator={index < items.length - 1} />
      ))}
    </View>
  );
});

export const CharacterChatListRow = memo(function CharacterChatListRow({
  item,
  separator,
}: {
  item: CharacterChatListItem;
  separator: boolean;
}) {
  countRender("chats.row");
  const { colors } = useTheme();
  const styles = getStyles(colors);

  return (
    <View>
      <TouchableOpacity
        accessibilityRole="button"
        disabled={item.disabled}
        accessibilityState={{ disabled: item.disabled ?? false }}
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
            <Text style={styles.subtitle} numberOfLines={2} ellipsizeMode="tail">
              {item.subtitle}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
      {separator ? <View style={styles.separator} /> : null}
    </View>
  );
});

export const CharacterChatAvatar = memo(function CharacterChatAvatar({
  children,
  muted = false,
  overlay,
}: {
  children: ReactNode;
  muted?: boolean;
  overlay?: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  return (
    <View style={[styles.avatar, muted && styles.avatarMuted]}>
      {children}
      {overlay ? <View style={styles.avatarOverlay}>{overlay}</View> : null}
    </View>
  );
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      minHeight: 80,
      flexDirection: "row",
      alignItems: "flex-start",
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
    avatarMuted: { backgroundColor: colors.primary5 },
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
      backgroundColor: colors.primary20,
    },
  });

const styleCache = new WeakMap<ThemeColors, ReturnType<typeof makeStyles>>();

function getStyles(colors: ThemeColors) {
  let styles = styleCache.get(colors);
  if (!styles) {
    styles = makeStyles(colors);
    styleCache.set(colors, styles);
  }
  return styles;
}
