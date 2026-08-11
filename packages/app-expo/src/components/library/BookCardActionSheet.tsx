import type { NativeContextMenuItem } from "@/components/ui/NativeContextMenuButton.types";
import type { Book } from "@readany/core/types";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { BookCardContextMenu } from "./BookCardContextMenu";

interface BookCardActionSheetProps {
  book: Book;
  children: ReactElement;
  onDelete: (bookId: string, options?: { preserveData?: boolean }) => void;
  onOpen: (book: Book) => void;
}

/**
 * The historical name is kept to avoid a noisy migration. The visible control
 * is now a platform menu: SwiftUI Menu/UIMenu on iOS and a native dialog on Android.
 */
export function BookCardActionSheet({
  book,
  children,
  onDelete,
  onOpen,
}: BookCardActionSheetProps) {
  const { t } = useTranslation();

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
    {
      key: "delete",
      label: t("common.remove", "Удалить"),
      sfSymbol: "trash",
      destructive: true,
      onPress: confirmDelete,
    },
  ];

  return (
    <BookCardContextMenu
      accessibilityLabel={t("common.actions", "Действия с книгой")}
      items={items}
      onPress={() => onOpen(book)}
    >
      {children}
    </BookCardContextMenu>
  );
}
