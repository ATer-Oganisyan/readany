import {
  Host,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Text,
} from "@expo/ui/jetpack-compose";
import { StyleSheet } from "react-native";
import type { NativeThemePickerProps } from "./NativeThemePicker.types";

export function NativeThemePicker({
  values,
  selectedIndex,
  onSelect,
  colorScheme,
}: NativeThemePickerProps) {
  return (
    <Host matchContents={{ vertical: true }} style={styles.host} colorScheme={colorScheme}>
      <SingleChoiceSegmentedButtonRow>
        {values.map((label, index) => (
          <SegmentedButton
            key={label}
            selected={selectedIndex === index}
            onClick={() => onSelect(index)}
          >
            <SegmentedButton.Label>
              <Text>{label}</Text>
            </SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { width: "100%", minHeight: 48 },
});
