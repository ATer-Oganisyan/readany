import { Picker } from "@expo/ui";
import { StyleSheet, Text, View } from "react-native";
import type { NativeSettingsPickerProps } from "./NativeSettingsPicker.types";

/** Web fallback for the native settings row picker. */
export function NativeSettingsPicker({
  label,
  selectedValue,
  options,
  onValueChange,
}: NativeSettingsPickerProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Picker selectedValue={selectedValue} onValueChange={onValueChange}>
        {options.map((option) => (
          <Picker.Item key={option.value} label={option.label} value={option.value} />
        ))}
      </Picker>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  label: { fontSize: 16 },
});

export type { NativeSettingsPickerProps } from "./NativeSettingsPicker.types";
