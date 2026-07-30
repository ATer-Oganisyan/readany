import { HStack, Host, Slider, Text } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  glassEffect,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import type { ReaderBottomToolbarProps } from "./ReaderBottomToolbar.types";

export function ReaderBottomToolbar(props: ReaderBottomToolbarProps) {
  const supportsGlass = Number.parseInt(String(Platform.Version), 10) >= 26;
  const [localProgress, setLocalProgress] = useState(props.progress);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) setLocalProgress(props.progress);
  }, [isEditing, props.progress]);

  return (
    <Host
      colorScheme={props.isDark ? "dark" : "light"}
      style={{ width: "100%", height: 44 + Math.max(props.bottomInset, 8) }}
    >
      <HStack
        spacing={10}
        alignment="center"
        modifiers={[
          padding({ top: 6, bottom: Math.max(props.bottomInset, 8), horizontal: 12 }),
          ...(supportsGlass
            ? [glassEffect({ glass: { variant: "regular" }, shape: "rectangle" })]
            : []),
        ]}
      >
        <Text
          modifiers={[
            frame({ width: 34, alignment: "trailing" }),
            font({ size: 12, weight: "semibold" }),
            foregroundStyle({ type: "hierarchical", style: "secondary" }),
          ]}
        >
          {`${Math.round(localProgress * 100)}%`}
        </Text>
        <Slider
          value={localProgress}
          min={0}
          max={1}
          step={0.001}
          onValueChange={setLocalProgress}
          onEditingChanged={(editing) => {
            setIsEditing(editing);
            if (editing) {
              props.onDragStart();
            } else {
              props.onSeek(localProgress);
              props.onDragEnd();
            }
          }}
          modifiers={[frame({ maxWidth: 10_000 }), tint(props.accentColor)]}
        />
      </HStack>
    </Host>
  );
}

export type { ReaderBottomToolbarProps } from "./ReaderBottomToolbar.types";
