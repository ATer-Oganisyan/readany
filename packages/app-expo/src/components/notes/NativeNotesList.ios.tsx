import { Text as InterfaceText } from "@/components/ui/Typography";
import { useTheme } from "@/styles/theme";
import { interfaceFontFamily } from "@deslop/primitives/native";
import {
  Button,
  ContextMenu,
  Host,
  Label,
  List,
  RNHostView,
  Section,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listStyle,
  scrollContentBackground,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { useTranslation } from "react-i18next";
import type { NativeNotesListProps } from "./NativeNotesList";

export function NativeNotesList({ sections, onPress, onDelete }: NativeNotesListProps) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const subtitle = [
    font({ family: interfaceFontFamily.regular, size: 14 }),
    foregroundStyle(colors.mutedForeground),
  ];

  return (
    <Host
      style={{ flex: 1, backgroundColor: colors.background }}
      colorScheme={isDark ? "dark" : "light"}
    >
      <List modifiers={[listStyle("insetGrouped"), scrollContentBackground("hidden")]}>
        {sections.map((section) => (
          <Section
            key={section.title}
            header={
              <RNHostView matchContents>
                <InterfaceText
                  style={{ fontSize: 14, color: colors.mutedForeground, paddingHorizontal: 32 }}
                >
                  {section.title}
                </InterfaceText>
              </RNHostView>
            }
          >
            {section.data.map((item) => (
              <ContextMenu
                key={item.id}
                modifiers={[
                  listRowBackground(colors.elevation1),
                  listRowInsets({ top: 12, bottom: 12, leading: 16, trailing: 16 }),
                ]}
              >
                <ContextMenu.Trigger>
                  <Button onPress={() => onPress(item.id)} modifiers={[buttonStyle("plain")]}>
                    <VStack
                      alignment="leading"
                      spacing={2}
                      modifiers={[
                        frame({ maxWidth: 10000, alignment: "leading" }),
                        // Plain buttons only hit-test drawn text; make the whole row tappable.
                        contentShape(shapes.rectangle()),
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
                      {item.bookTitle ? (
                        <Text modifiers={[...subtitle, lineLimit(1)]}>{item.bookTitle}</Text>
                      ) : null}
                    </VStack>
                  </Button>
                </ContextMenu.Trigger>
                <ContextMenu.Items>
                  {/* biome-ignore lint/a11y/useValidAriaRole: destructive is an Expo UI button role, not an ARIA role. */}
                  <Button role="destructive" onPress={() => onDelete(item.id)}>
                    <Label title={t("common.delete", "Удалить")} systemImage="trash" />
                  </Button>
                </ContextMenu.Items>
              </ContextMenu>
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
