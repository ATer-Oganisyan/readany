import { NativeContextMenuButton } from "@/components/ui/NativeContextMenuButton.android";
import { Text } from "@/components/ui/Typography";
import { bodyTypography, useColors } from "@/styles/theme";
import { Pressable, StyleSheet, View } from "react-native";
import type { NativeSettingsPickerProps } from "./NativeSettingsPicker.types";

export function NativeSettingsPicker({
  label,
  selectedValue,
  options,
  onValueChange,
}: NativeSettingsPickerProps) {
  const colors = useColors();
  const selectedLabel = options.find((option) => option.value === selectedValue)?.label ?? "";

  return (
    <View style={styles.row}>
      <Text style={[bodyTypography, styles.label, { color: colors.foreground }]}>{label}</Text>
      <NativeContextMenuButton
        accessibilityLabel={label}
        items={options.map((option) => ({
          key: option.value,
          label: option.label,
          icon: option.value === selectedValue ? "check" : null,
          onPress: () => onValueChange(option.value),
        }))}
        renderTrigger={(openMenu) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${selectedLabel}`}
            onPress={openMenu}
            style={({ pressed }) => [styles.valueButton, pressed && styles.pressed]}
          >
            <Text style={[bodyTypography, styles.value, { color: colors.primary }]}>
              {selectedLabel}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: "100%",
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 16,
    paddingRight: 16,
    gap: 12,
  },
  label: { flex: 1 },
  valueButton: { minHeight: 48, justifyContent: "center", alignItems: "flex-end" },
  value: { textAlign: "right" },
  pressed: { opacity: 0.6 },
});

export type { NativeSettingsPickerProps } from "./NativeSettingsPicker.types";
