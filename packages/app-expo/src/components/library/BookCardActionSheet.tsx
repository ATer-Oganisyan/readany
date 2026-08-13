import type { NativeContextMenuItem } from "@/components/ui/NativeContextMenuButton.types";
import { useSwipePressGuard } from "@/components/ui/swipe-press-guard";
import type { Book } from "@readany/core/types";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
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
  const swipePressGuard = useSwipePressGuard();

  const items: NativeContextMenuItem[] = [
    {
      key: "delete",
      label: t("common.remove", "Удалить"),
      sfSymbol: "trash",
      destructive: true,
      onPress: () => onDelete(book.id),
    },
  ];

  return (
    <BookCardContextMenu
      accessibilityLabel={t("common.actions", "Действия с книгой")}
      items={items}
      onPress={() => {
        if (swipePressGuard?.canPress() === false) return;
        onOpen(book);
      }}
    >
      {children}
    </BookCardContextMenu>
  );
}
