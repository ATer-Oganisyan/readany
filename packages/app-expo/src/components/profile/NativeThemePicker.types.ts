export interface NativeThemePickerProps {
  values: readonly string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  colorScheme: "light" | "dark";
  accessibilityLabel: string;
  scrollable?: boolean;
  variant?: "segmented" | "tabs";
}
