import { getFirstTocHref } from "@readany/core/reader";
import type { TOCItem } from "@readany/core/types";

export interface ReaderTOCPanelProps {
  toc: TOCItem[];
  currentChapter: string;
  currentChapterHref: string;
  onSelectTocItem: (href: string) => void;
}

interface NativeTocRow {
  key: string;
  title: string;
  level: number;
  href: string | null;
  isCurrent: boolean;
}

export function flattenTocItems(
  items: TOCItem[],
  currentChapter: string,
  currentChapterHref: string,
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
      isCurrent: currentChapterHref
        ? item.href === currentChapterHref
        : item.title === currentChapter,
    };

    return [
      row,
      ...flattenTocItems(item.subitems ?? [], currentChapter, currentChapterHref, level + 1, path),
    ];
  });
}
