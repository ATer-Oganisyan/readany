import type { TFunction } from "i18next";

export function getReaderBookmarkCopy(t: TFunction) {
  return {
    pullToAdd: t("bookmarks.pullToAdd", "Потяните вниз, чтобы добавить закладку"),
    releaseToAdd: t("bookmarks.releaseToAdd", "Отпустите, чтобы добавить закладку"),
    pullToRemove: t("bookmarks.pullToRemove", "Потяните вниз, чтобы удалить закладку"),
    releaseToRemove: t("bookmarks.releaseToRemove", "Отпустите, чтобы удалить закладку"),
  };
}
