import { useTheme } from "@/styles/theme";
import { spacingPixels } from "@deslop/primitives";
import { ListItem } from "@expo/ui";
import { Host, List, Text } from "@expo/ui/swift-ui";
import {
  foregroundStyle,
  listRowBackground,
  listStyle,
  padding,
  scrollContentBackground,
} from "@expo/ui/swift-ui/modifiers";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type ReaderTOCPanelProps, flattenTocItems } from "./reader-toc-items";

export function ReaderTOCPanel({
  toc,
  currentChapter,
  currentChapterHref,
  onSelectTocItem,
}: ReaderTOCPanelProps) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const rows = useMemo(
    () => flattenTocItems(toc, currentChapter, currentChapterHref),
    [toc, currentChapter, currentChapterHref],
  );
  return (
    <Host style={{ flex: 1 }} colorScheme={isDark ? "dark" : "light"}>
      <List
        testID="reader-toc-list"
        modifiers={[listStyle("insetGrouped"), scrollContentBackground("hidden")]}
      >
        {rows.length ? (
          rows.map((row) => {
            const href = row.href;
            const label = (
              <Text
                key={row.key}
                modifiers={[
                  ...(row.isCurrent ? [foregroundStyle(colors.primary)] : []),
                  padding({ leading: row.level * spacingPixels[16] }),
                ]}
              >
                {row.title}
              </Text>
            );
            return href ? (
              <ListItem
                key={row.key}
                testID={`reader-toc-row-${row.key}`}
                modifiers={[listRowBackground(colors.primary5)]}
                onPress={() => onSelectTocItem(href)}
              >
                {label}
              </ListItem>
            ) : (
              <Text key={row.key} modifiers={[listRowBackground(colors.primary5)]}>
                {row.title}
              </Text>
            );
          })
        ) : (
          <Text modifiers={[listRowBackground(colors.primary5)]}>
            {t("reader.noToc", "Нет оглавления")}
          </Text>
        )}
      </List>
    </Host>
  );
}
