import { useTheme } from "@/styles/theme";
import { interfaceFontFamily } from "@deslop/primitives/native";
import { Button, HStack, Host, List, Section, Text, VStack } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listStyle,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { NativeNotesListProps } from "./NativeNotesList";

/** A real SwiftUI inset-grouped list, so rows, separators and press feedback stay native. */
export function NativeNotesList({ sections, onPress }: NativeNotesListProps) {
  const { colors, isDark } = useTheme();

  return (
    <Host
      colorScheme={isDark ? "dark" : "light"}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <List modifiers={[listStyle("insetGrouped")]}>
        {sections.map((section) => (
          <Section key={section.title} title={section.title}>
            {section.data.map((item) => (
              <Button
                key={item.id}
                onPress={() => onPress(item.id)}
                modifiers={[buttonStyle("plain")]}
              >
                <VStack
                  alignment="leading"
                  spacing={2}
                  modifiers={[
                    frame({ minWidth: 0, maxWidth: 10_000, alignment: "leading" }),
                    padding({ vertical: 4 }),
                  ]}
                >
                  <Text
                    modifiers={[
                      font({ family: interfaceFontFamily.semibold, size: 17 }),
                      foregroundStyle(colors.foreground),
                      lineLimit(1),
                    ]}
                  >
                    {item.title}
                  </Text>
                  <HStack spacing={6}>
                    <Text
                      modifiers={[
                        font({ family: interfaceFontFamily.regular, size: 15 }),
                        foregroundStyle({ type: "hierarchical", style: "secondary" }),
                        lineLimit(1),
                      ]}
                    >
                      {item.dateLabel}
                    </Text>
                    {item.preview ? (
                      <Text
                        modifiers={[
                          font({ family: interfaceFontFamily.regular, size: 15 }),
                          foregroundStyle({ type: "hierarchical", style: "secondary" }),
                          lineLimit(1),
                        ]}
                      >
                        {item.preview}
                      </Text>
                    ) : null}
                  </HStack>
                  <Text
                    modifiers={[
                      font({ family: interfaceFontFamily.regular, size: 14 }),
                      foregroundStyle({ type: "hierarchical", style: "secondary" }),
                      lineLimit(1),
                    ]}
                  >
                    {item.bookTitle}
                  </Text>
                </VStack>
              </Button>
            ))}
          </Section>
        ))}
      </List>
    </Host>
  );
}

export type {
  NativeNoteListItem,
  NativeNoteListSection,
  NativeNotesListProps,
} from "./NativeNotesList";
