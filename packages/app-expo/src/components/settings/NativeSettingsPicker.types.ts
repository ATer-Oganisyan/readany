export interface NativeSettingsPickerOption {
  label: string;
  value: string;
}

export interface NativeSettingsPickerProps {
  label: string;
  selectedValue: string;
  options: readonly NativeSettingsPickerOption[];
  onValueChange: (value: string) => void;
  colorScheme: "light" | "dark";
}
