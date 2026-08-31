import { Text } from "@/components/ui/Typography";
import { bodyTypography, spacing, subtitleTypography } from "@/styles/theme";
import { StyleSheet, View } from "react-native";
import type { NativeCharacterDetailsCellsProps } from "./NativeCharacterDetailsCells.types";

/** Резервное представление для платформ без SwiftUI. */
export function NativeCharacterDetailsCells({
  cellBackgroundColor,
  items,
  isDark,
}: NativeCharacterDetailsCellsProps) {
  const primaryColor = isDark ? "rgba(255,255,255,0.96)" : "rgba(0,0,0,0.9)";

  return (
    <View style={[styles.group, { backgroundColor: cellBackgroundColor }]}>
      {items.map((item, index) => (
        <View key={item.key}>
          {index > 0 ? <View style={styles.divider} /> : null}
          <View style={styles.row}>
            <Text style={[styles.label, { color: primaryColor }]}>{item.label}</Text>
            <Text style={[styles.value, { color: primaryColor }]}>{item.value}</Text>
          </View>
        </View>
      ))}
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
