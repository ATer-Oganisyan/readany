/** Нативное оглавление: системный List и tappable ListItem вместо кастомных строк. */
import { useTheme } from "@/styles/theme";
import { spacingPixels } from "@deslop/primitives";
import { Host, List, ListItem, Text } from "@expo/ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type ReaderTOCPanelProps, flattenTocItems } from "./reader-toc-items";

export function ReaderTOCPanel({
  toc,
  currentChapter,
  currentChapterHref,
  onSelectTocItem,
}: ReaderTOCPanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const rows = useMemo(
    () => flattenTocItems(toc, currentChapter, currentChapterHref),
    [currentChapter, currentChapterHref, toc],
  );

  return (
    <Host style={{ flex: 1 }}>
      <List testID="reader-toc-list">
        {rows.length > 0 ? (
          rows.map((row) => {
            const href = row.href;

            return (
              <ListItem
                key={row.key}
                testID={`reader-toc-row-${row.key}`}
                onPress={href ? () => onSelectTocItem(href) : undefined}
              >
                <Text
                  numberOfLines={2}
                  style={{ paddingLeft: row.level * spacingPixels[16] }}
                  textStyle={{
                    color: row.isCurrent ? colors.primary : colors.foreground,
                    fontWeight: row.isCurrent ? "600" : "400",
                  }}
                >
                  {row.title}
                </Text>
              </ListItem>
            );
          })
        ) : (
          <ListItem>
            <Text textStyle={{ color: colors.mutedForeground }}>
              {t("reader.noToc", "Нет оглавления")}
            </Text>
          </ListItem>
        )}
      </List>
    </Host>
  );
}
