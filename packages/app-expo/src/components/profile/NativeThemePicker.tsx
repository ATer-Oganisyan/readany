import SegmentedControl from "@expo/ui/community/segmented-control";
import { StyleSheet } from "react-native";
import type { NativeThemePickerProps } from "./NativeThemePicker.types";

/** Web fallback. Native builds resolve the platform-specific SwiftUI/Compose files. */
export function NativeThemePicker({
  values,
  selectedIndex,
  onSelect,
  colorScheme,
}: NativeThemePickerProps) {
  return (
    <SegmentedControl
      values={[...values]}
      selectedIndex={selectedIndex}
      onChange={({ nativeEvent }) => onSelect(nativeEvent.selectedSegmentIndex)}
      appearance={colorScheme}
      style={styles.control}
    />
  );
}

const styles = StyleSheet.create({
  control: { width: "100%", minHeight: 36 },
});
