import type { TFunction } from "i18next";

export function getReaderBookmarkCopy(t: TFunction) {
  return {
    added: t("bookmarks.added", "Добавлено в закладки"),
    removed: t("bookmarks.removed", "Закладка удалена"),
  };
}
