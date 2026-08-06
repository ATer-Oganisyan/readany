import { spacing, useTheme } from "@/styles/theme";
import { interfaceFontFamily } from "@deslop/primitives/native";
import { Button, HStack, Host, Picker, ScrollView, Text } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  font,
  frame,
  padding,
  pickerStyle,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { StyleSheet, useWindowDimensions } from "react-native";
import type { NativeThemePickerProps } from "./NativeThemePicker.types";

export function NativeThemePicker({
  values,
  selectedIndex,
  onSelect,
  colorScheme,
  accessibilityLabel,
  scrollable = false,
}: NativeThemePickerProps) {
  const { colors } = useTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const picker = (
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
  );

  return (
    <Host matchContents={{ vertical: true }} style={styles.host} colorScheme={colorScheme}>
      {scrollable ? (
        <ScrollView
          axes="horizontal"
          showsIndicators={false}
          modifiers={[frame({ width: viewportWidth })]}
        >
          <HStack spacing={spacing.sm} modifiers={[padding({ horizontal: spacing.lg })]}>
            {values.map((label, index) => (
              <Button
                key={label}
                label={label}
                onPress={() => onSelect(index)}
                modifiers={[
                  controlSize("regular"),
                  font({ family: interfaceFontFamily.semibold, size: 17 }),
                  tint(selectedIndex === index ? colors.primary : colors.mutedForeground),
                  buttonStyle(selectedIndex === index ? "borderedProminent" : "bordered"),
                ]}
              />
            ))}
          </HStack>
        </ScrollView>
      ) : (
        picker
      )}
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { width: "100%", minHeight: 36 },
});
