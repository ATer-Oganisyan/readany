import { interfaceFontFamily } from "@deslop/primitives/native";
import { Picker } from "@expo/ui";
import { Host, Row, Text } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, padding } from "@expo/ui/jetpack-compose/modifiers";
import type { NativeSettingsPickerProps } from "./NativeSettingsPicker.types";

export function NativeSettingsPicker({
  label,
  selectedValue,
  options,
  onValueChange,
  colorScheme,
}: NativeSettingsPickerProps) {
  return (
    <Host matchContents={{ vertical: true }} colorScheme={colorScheme} style={{ width: "100%" }}>
      <Row
        horizontalArrangement="spaceBetween"
        verticalAlignment="center"
        modifiers={[fillMaxWidth(), padding(16, 4, 16, 4)]}
      >
        <Text
          maxLines={1}
          overflow="ellipsis"
          style={{ fontFamily: interfaceFontFamily.regular, fontSize: 16, lineHeight: 22 }}
        >
          {label}
        </Text>
        <Picker selectedValue={selectedValue} onValueChange={onValueChange}>
          {options.map((option) => (
            <Picker.Item key={option.value} label={option.label} value={option.value} />
          ))}
        </Picker>
      </Row>
    </Host>
  );
}

export type { NativeSettingsPickerProps } from "./NativeSettingsPicker.types";
