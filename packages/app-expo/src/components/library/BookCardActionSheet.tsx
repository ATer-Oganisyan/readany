import { GroupPickerSheet } from "@/components/library/GroupPickerSheet";
import type { NativeContextMenuItem } from "@/components/ui/NativeContextMenuButton.types";
import { useLibraryStore } from "@/stores/library-store";
import type { Book } from "@readany/core/types";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { BookCardContextMenu } from "./BookCardContextMenu";

interface BookCardActionSheetProps {
  book: Book;
  onShowDetails?: (book: Book) => void;
  onManageTags?: (book: Book) => void;
  onVectorize?: (book: Book) => void;
  onDelete: (bookId: string, options?: { preserveData?: boolean }) => void;
  onOpen: (book: Book) => void;
}

/**
 * The historical name is kept to avoid a noisy migration. The visible control
 * is now a platform menu: SwiftUI Menu/UIMenu on iOS and a native dialog on Android.
 */
export function BookCardActionSheet({
  book,
  onShowDetails,
  onManageTags,
  onVectorize,
  onDelete,
  onOpen,
}: BookCardActionSheetProps) {
  const { t } = useTranslation();
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const groups = useLibraryStore((state) => state.groups);
  const moveBookToGroup = useLibraryStore((state) => state.moveBookToGroup);
  const removeBookFromGroup = useLibraryStore((state) => state.removeBookFromGroup);
  const addGroup = useLibraryStore((state) => state.addGroup);

  const confirmVectorization = () => {
    if (!onVectorize) return;
    if (!book.isVectorized) {
      onVectorize(book);
      return;
    }

    Alert.alert(
      t("home.vec_reindex", "Переиндексировать"),
      t("home.vec_reindexConfirm", "Текущий поисковый индекс будет удалён и создан заново."),
      [
        { text: t("common.cancel", "Отмена"), style: "cancel" },
        { text: t("common.confirm", "Продолжить"), onPress: () => onVectorize(book) },
      ],
    );
  };

  const confirmDelete = () => {
    Alert.alert(
      t("library.deleteBookTitle", "Удалить книгу?"),
      t(
        "library.deleteBookDescription",
        "Можно сохранить заметки и статистику чтения для повторного импорта.",
      ),
      [
        { text: t("common.cancel", "Отмена"), style: "cancel" },
        {
          text: t("library.deleteBookKeepData", "Удалить, сохранив данные"),
          style: "destructive",
          onPress: () => onDelete(book.id, { preserveData: true }),
        },
        {
          text: t("library.deleteBookWithData", "Удалить всё"),
          style: "destructive",
          onPress: () => onDelete(book.id, { preserveData: false }),
        },
      ],
    );
  };

  const items: NativeContextMenuItem[] = [
    ...(onShowDetails
      ? [
          {
            key: "details",
            label: t("library.detailsAction", "О книге"),
            sfSymbol: "info.circle",
            onPress: () => onShowDetails(book),
          },
        ]
      : []),
    {
      key: "group",
      label: book.groupId
        ? t("library.changeGroup", "Сменить группу")
        : t("library.moveToGroup", "Добавить в группу"),
      sfSymbol: "folder",
      onPress: () => setShowGroupPicker(true),
    },
    ...(onManageTags
      ? [
          {
            key: "tags",
            label: t("home.manageTags", "Теги"),
            sfSymbol: "tag",
            onPress: () => onManageTags(book),
          },
        ]
      : []),
    ...(onVectorize
      ? [
          {
            key: "vectorize",
            label: book.isVectorized
              ? t("home.vec_reindex", "Переиндексировать")
              : t("home.vec_vectorize", "Проиндексировать"),
            sfSymbol: "cylinder",
            onPress: confirmVectorization,
          },
        ]
      : []),
    {
      key: "delete",
      label: t("common.remove", "Удалить"),
      sfSymbol: "trash",
      destructive: true,
      onPress: confirmDelete,
    },
  ];

  return (
    <>
      <BookCardContextMenu
        accessibilityLabel={t("common.actions", "Действия с книгой")}
        items={items}
        onPress={() => onOpen(book)}
      />
      <GroupPickerSheet
        visible={showGroupPicker}
        groups={groups}
        currentGroupId={book.groupId}
        onSelect={(groupId) => {
          if (groupId) moveBookToGroup(book.id, groupId);
          else removeBookFromGroup(book.id);
        }}
        onCreateGroup={async (name) => {
          const group = await addGroup(name);
          if (group) moveBookToGroup(book.id, group.id);
        }}
        onClose={() => setShowGroupPicker(false)}
      />
    </>
  );
}
