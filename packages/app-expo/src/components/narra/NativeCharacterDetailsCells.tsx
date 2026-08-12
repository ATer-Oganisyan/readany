import { Text } from "@/components/ui/Typography";
import { bodyTypography, spacing, subtitleTypography } from "@/styles/theme";
import { StyleSheet, View } from "react-native";
import type { NativeCharacterDetailsCellsProps } from "./NativeCharacterDetailsCells.types";

/** Резервное представление для платформ без SwiftUI. */
export function NativeCharacterDetailsCells({
  bio,
  bioLabel,
  cellBackgroundColor,
  character,
  characterLabel,
  isDark,
}: NativeCharacterDetailsCellsProps) {
  const primaryColor = isDark ? "rgba(255,255,255,0.96)" : "rgba(0,0,0,0.9)";

  return (
    <View style={[styles.group, { backgroundColor: cellBackgroundColor }]}>
      <View style={styles.row}>
        <Text style={[styles.label, { color: primaryColor }]}>{bioLabel}</Text>
        <Text style={[styles.value, { color: primaryColor }]}>{bio}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={[styles.label, { color: primaryColor }]}>{characterLabel}</Text>
        <Text style={[styles.value, { color: primaryColor }]}>{character}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    alignSelf: "stretch",
    overflow: "hidden",
    marginHorizontal: spacing.lg,
    borderRadius: 20,
  },
  row: {
    gap: 3,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  label: {
    ...subtitleTypography,
    opacity: 0.6,
  },
  value: {
    ...bodyTypography,
  },
  divider: {
    height: 1,
    marginLeft: 16,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
});

export type { NativeCharacterDetailsCellsProps } from "./NativeCharacterDetailsCells.types";
