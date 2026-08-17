import { useTheme } from "@/styles/theme";
import { interfaceFontFamily } from "@deslop/primitives/native";
import { HStack, Host, Picker, Spacer, Text } from "@expo/ui/swift-ui";
import { font, frame, padding, pickerStyle, tag, tint } from "@expo/ui/swift-ui/modifiers";
import type { NativeSettingsPickerProps } from "./NativeSettingsPicker.types";

export function NativeSettingsPicker({
  label,
  selectedValue,
  options,
  onValueChange,
  colorScheme,
}: NativeSettingsPickerProps) {
  const { colors } = useTheme();

  return (
    <Host matchContents={{ vertical: true }} style={{ width: "100%" }} colorScheme={colorScheme}>
      <HStack
        spacing={8}
        alignment="center"
        modifiers={[frame({ maxWidth: 10_000 }), padding({ horizontal: 16, vertical: 14 })]}
      >
        <Text modifiers={[font({ family: interfaceFontFamily.regular, size: 18 })]}>{label}</Text>
        <Spacer />
        <Picker
          label={label}
          selection={selectedValue}
          onSelectionChange={(value) => {
            if (typeof value === "string") onValueChange(value);
          }}
          modifiers={[pickerStyle("menu"), tint(colors.primary)]}
        >
          {options.map((option) => (
            <Text key={option.value} modifiers={[tag(option.value)]}>
              {option.label}
            </Text>
          ))}
        </Picker>
      </HStack>
    </Host>
  );
}

export type { NativeSettingsPickerProps } from "./NativeSettingsPicker.types";
