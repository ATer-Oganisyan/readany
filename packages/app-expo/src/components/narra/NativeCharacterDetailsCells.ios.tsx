import { spacingPixels } from "@deslop/primitives";
import { interfaceFontFamily } from "@deslop/primitives/native";
import { Divider, Host, Text, VStack } from "@expo/ui/swift-ui";
import {
  background,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  lineLimit,
  opacity,
  overlay,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { Platform } from "react-native";
import type { NativeCharacterDetailsCellsProps } from "./NativeCharacterDetailsCells.types";

const WHITE_20 = "rgba(255,255,255,0.2)";
// Both Liquid Glass surfaces overdraw their layout bounds by 8 pt.
const DETAILS_SECTION_GAP = spacingPixels[24] + spacingPixels[16];

function DetailsRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <VStack
      alignment="leading"
      spacing={3}
      modifiers={[frame({ maxWidth: 10_000, alignment: "leading" })]}
    >
      <Text
        modifiers={[
          font({ family: interfaceFontFamily.regular, size: 13 }),
          foregroundStyle({ type: "hierarchical", style: "primary" }),
          opacity(0.6),
        ]}
      >
        {label}
      </Text>
      <Text
        modifiers={[
          font({ family: interfaceFontFamily.regular, size: 16 }),
          foregroundStyle({ type: "hierarchical", style: "primary" }),
          lineLimit(),
          fixedSize({ horizontal: false, vertical: true }),
        ]}
      >
        {value}
      </Text>
    </VStack>
  );
}

/** Один Expo-компонент: на iOS 26+ рендерится нативной поверхностью Liquid Glass. */
export function NativeCharacterDetailsCells({
  bio,
  bioLabel,
  cellBackgroundColor,
  character,
  characterLabel,
  isDark,
}: NativeCharacterDetailsCellsProps) {
  const supportsGlass = Number.parseInt(String(Platform.Version), 10) >= 26;

  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={isDark ? "dark" : "light"}
      style={{ width: "100%" }}
    >
      <VStack
        alignment="leading"
        spacing={0}
        modifiers={[
          frame({ maxWidth: 10_000, alignment: "leading" }),
          padding({ horizontal: 16, vertical: 12 }),
          ...(supportsGlass
            ? [
                glassEffect({
                  glass: { variant: "regular" },
                  shape: "roundedRectangle",
                  cornerRadius: 28,
                }),
              ]
            : [
                background(
                  cellBackgroundColor,
                  shapes.roundedRectangle({ cornerRadius: 28, roundedCornerStyle: "continuous" }),
                ),
              ]),
          padding({ horizontal: 20, top: DETAILS_SECTION_GAP }),
        ]}
      >
        <DetailsRow label={bioLabel} value={bio} />
        <Divider modifiers={[overlay({ color: WHITE_20 }), padding({ vertical: 9 })]} />
        <DetailsRow label={characterLabel} value={character} />
      </VStack>
    </Host>
  );
}

export type { NativeCharacterDetailsCellsProps } from "./NativeCharacterDetailsCells.types";
