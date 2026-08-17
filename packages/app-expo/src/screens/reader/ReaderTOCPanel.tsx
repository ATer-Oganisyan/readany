/** Нативное оглавление: системный List и tappable ListItem вместо кастомных строк. */
import { useTheme } from "@/styles/theme";
import { spacingPixels } from "@deslop/primitives";
import { Host, List, ListItem, Text } from "@expo/ui";
import { getFirstTocHref } from "@readany/core/reader";
import type { TOCItem } from "@readany/core/types";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  toc: TOCItem[];
  currentChapter: string;
  onSelectTocItem: (href: string) => void;
}

interface NativeTocRow {
  key: string;
  title: string;
  level: number;
  href: string | null;
  isCurrent: boolean;
}

function flattenTocItems(
  items: TOCItem[],
  currentChapter: string,
  level = 0,
  parentPath = "",
): NativeTocRow[] {
  return items.flatMap((item, index) => {
    const path = parentPath ? `${parentPath}.${index}` : `${index}`;
    const row: NativeTocRow = {
      key: `${path}:${item.id || item.href || item.title}`,
      title: item.title,
      level,
      href: getFirstTocHref(item),
      isCurrent: item.title === currentChapter,
    };

    return [row, ...flattenTocItems(item.subitems ?? [], currentChapter, level + 1, path)];
  });
}

export function ReaderTOCPanel({ toc, currentChapter, onSelectTocItem }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const rows = useMemo(() => flattenTocItems(toc, currentChapter), [currentChapter, toc]);

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
