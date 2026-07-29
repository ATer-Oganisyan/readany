import { useTheme } from "@/styles/theme";
import { interfaceFontFamily } from "@deslop/primitives/native";
import { Host, Text } from "@expo/ui/swift-ui";
import {
  Animation,
  animation,
  contentTransition,
  font,
  foregroundStyle,
} from "@expo/ui/swift-ui/modifiers";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import type { ProfileNumericTextProps } from "./ProfileNumericText";

const getZeroValue = (value: string) => value.replace(/[\d\s.,]+/u, "0").trimStart();

/** SwiftUI numeric text transition replayed whenever the Profile tab becomes active. */
export function ProfileNumericText({ value, color }: ProfileNumericTextProps) {
  const { isDark } = useTheme();
  const [displayedValue, setDisplayedValue] = useState(() => getZeroValue(value));
  const [animationKey, setAnimationKey] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setDisplayedValue(getZeroValue(value));
      setAnimationKey((current) => current + 1);
      const timer = setTimeout(() => {
        setDisplayedValue(value);
        setAnimationKey((current) => current + 1);
      }, 80);
      return () => clearTimeout(timer);
    }, [value]),
  );

  return (
    <Host matchContents colorScheme={isDark ? "dark" : "light"}>
      <Text
        modifiers={[
          font({ family: interfaceFontFamily.bold, size: 25 }),
          foregroundStyle(color),
          contentTransition("numericText", { countsDown: false }),
          animation(Animation.easeInOut({ duration: 0.45 }), animationKey),
        ]}
      >
        {displayedValue}
      </Text>
    </Host>
  );
}

export type { ProfileNumericTextProps } from "./ProfileNumericText";
