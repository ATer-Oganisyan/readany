import { bodyTypography, useTheme } from "@/styles/theme";
import { interfaceFontFamily } from "@deslop/primitives/native";
import {
  Button,
  Text as ComposeText,
  Host,
  LazyRow,
  SegmentedButton,
  Shape,
  SingleChoiceSegmentedButtonRow,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth, height } from "@expo/ui/jetpack-compose/modifiers";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeThemePickerProps } from "./NativeThemePicker.types";

export function NativeThemePicker({
  values,
  selectedIndex,
  onSelect,
  colorScheme,
  accessibilityLabel,
  scrollable = false,
  variant = "segmented",
}: NativeThemePickerProps) {
  const { colors } = useTheme();
  const chipShape = Shape.RoundedCorner({
    cornerRadii: { topStart: 22, topEnd: 22, bottomStart: 22, bottomEnd: 22 },
  });

  if (variant === "tabs") {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="tablist"
        style={[styles.tabs, { borderBottomColor: colors.border }]}
      >
        {values.map((label, index) => {
          const selected = selectedIndex === index;
          return (
            <Pressable
              key={label}
              accessibilityLabel={label}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onSelect(index)}
              style={({ pressed }) => [
                styles.tab,
                selected && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
                pressed && styles.tabPressed,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.tabLabel,
                  {
                    color: selected ? colors.foreground : colors.mutedForeground,
                    fontFamily: selected
                      ? interfaceFontFamily.semibold
                      : interfaceFontFamily.regular,
                  },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  if (scrollable) {
    return (
      <Host style={styles.chipHost} colorScheme={colorScheme}>
        <LazyRow
          horizontalArrangement={{ spacedBy: 8 }}
          verticalAlignment="center"
          contentPadding={{ start: 16, end: 16 }}
          modifiers={[fillMaxWidth(), height(44)]}
        >
          {values.map((label, index) => {
            const selected = selectedIndex === index;
            return (
              <Button
                key={label}
                onClick={() => onSelect(index)}
                modifiers={[height(44)]}
                shape={chipShape}
                contentPadding={{ start: 20, end: 20, top: 0, bottom: 0 }}
                colors={{
                  containerColor: selected ? colors.primary : colors.primary5,
                  contentColor: selected ? colors.primaryForeground : colors.mutedForeground,
                }}
              >
                <ComposeText maxLines={1} style={bodyTypography}>
                  {label}
                </ComposeText>
              </Button>
            );
          })}
        </LazyRow>
      </Host>
    );
  }

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
              <ComposeText>{label}</ComposeText>
            </SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { width: "100%", minHeight: 48 },
  chipHost: { width: "100%", height: 44 },
  tabs: {
    width: "100%",
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  tab: {
    minHeight: 48,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  tabPressed: { opacity: 0.7 },
  tabLabel: { fontSize: 16, lineHeight: 22 },
});
