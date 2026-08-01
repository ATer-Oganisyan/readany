import { Host, Picker, Text } from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { StyleSheet } from "react-native";
import type { NativeThemePickerProps } from "./NativeThemePicker.types";

export function NativeThemePicker({
  values,
  selectedIndex,
  onSelect,
  colorScheme,
  accessibilityLabel,
}: NativeThemePickerProps) {
  return (
    <Host matchContents={{ vertical: true }} style={styles.host} colorScheme={colorScheme}>
      <Picker
        label={accessibilityLabel}
        selection={selectedIndex}
        onSelectionChange={onSelect}
        modifiers={[pickerStyle("segmented")]}
      >
        {values.map((label, index) => (
          <Text key={label} modifiers={[tag(index)]}>
            {label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { width: "100%", minHeight: 36 },
});
