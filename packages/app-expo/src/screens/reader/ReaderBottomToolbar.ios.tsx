import { Button, HStack, Host, Image, Slider, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  lineLimit,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { type ComponentProps, useEffect, useState } from "react";
import { Platform } from "react-native";
import type { ReaderBottomToolbarProps } from "./ReaderBottomToolbar.types";

type SFSymbol = NonNullable<ComponentProps<typeof Image>["systemName"]>;

interface ActionItem {
  key: keyof ReaderBottomToolbarProps["labels"];
  symbol: SFSymbol;
  onPress: () => void;
  active?: boolean;
}

export function ReaderBottomToolbar(props: ReaderBottomToolbarProps) {
  const supportsGlass = Number.parseInt(String(Platform.Version), 10) >= 26;
  const [localProgress, setLocalProgress] = useState(props.progress);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) setLocalProgress(props.progress);
  }, [isEditing, props.progress]);

  const actions: ActionItem[] = [
    { key: "toc", symbol: "list.bullet", onPress: props.onOpenToc },
    {
      key: "bookmarks",
      symbol: props.isBookmarked ? "bookmark.fill" : "bookmark",
      onPress: props.onToggleBookmark,
      active: props.isBookmarked,
    },
    { key: "notes", symbol: "square.and.pencil", onPress: props.onOpenNotes },
    { key: "search", symbol: "magnifyingglass", onPress: props.onOpenSearch },
  ];

  return (
    <Host
      colorScheme={props.isDark ? "dark" : "light"}
      style={{ width: "100%", height: 102 + Math.max(props.bottomInset, 8) }}
    >
      <VStack
        spacing={2}
        modifiers={[
          padding({ top: 8, bottom: Math.max(props.bottomInset, 8), horizontal: 12 }),
          ...(supportsGlass
            ? [glassEffect({ glass: { variant: "regular" }, shape: "rectangle" })]
            : []),
        ]}
      >
        <HStack spacing={10} alignment="center">
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
        <HStack spacing={0} alignment="center">
          {actions.map((action) => (
            <Button
              key={action.key}
              onPress={action.onPress}
              modifiers={[
                buttonStyle("plain"),
                frame({ minWidth: 0, maxWidth: 10_000, minHeight: 50 }),
                tint(action.active ? props.accentColor : props.foregroundColor),
                accessibilityLabel(props.labels[action.key]),
              ]}
            >
              <VStack spacing={3} alignment="center">
                <Image
                  systemName={action.symbol}
                  size={21}
                  color={action.active ? props.accentColor : props.foregroundColor}
                />
                <Text
                  modifiers={[
                    font({ size: 10, weight: "semibold" }),
                    foregroundStyle(action.active ? props.accentColor : props.mutedColor),
                    lineLimit(1),
                  ]}
                >
                  {props.labels[action.key]}
                </Text>
              </VStack>
            </Button>
          ))}
        </HStack>
      </VStack>
    </Host>
  );
}

export type { ReaderBottomToolbarProps } from "./ReaderBottomToolbar.types";
