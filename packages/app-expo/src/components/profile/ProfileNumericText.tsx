import { Text } from "@/components/ui/Typography";
import type { StyleProp, TextStyle } from "react-native";

export interface ProfileNumericTextProps {
  value: string;
  color: string;
  style?: StyleProp<TextStyle>;
}

export function ProfileNumericText({ value, style }: ProfileNumericTextProps) {
  return (
    <Text style={style} numberOfLines={1} maxFontSizeMultiplier={1.8}>
      {value}
    </Text>
  );
}
