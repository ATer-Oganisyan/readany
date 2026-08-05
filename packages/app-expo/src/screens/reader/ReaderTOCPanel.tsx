/**
 * ReaderTOCPanel — единая выдвижная панель читалки в стиле Apple Books:
 * вкладки «Оглавление · Закладки · Поиск» в одном bottom-sheet.
 * Темы и шрифты живут отдельно в Aa-панели (ReaderSettingsPanel).
 */
import {
  BookmarkFilledIcon,
  BookmarkIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { Text, TextInput } from "@/components/ui/Typography";
import type { ReaderSearchResultItem } from "@/hooks/use-reader-bridge";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useColors } from "@/styles/theme";
import { fontSize } from "@/styles/theme";
import type { TOCItem } from "@readany/core/types";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TOCTreeItem } from "./TOCTreeItem";
import { SCREEN_HEIGHT } from "./reader-constants";
import { ListIcon } from "./reader-icons";
import { makeStyles } from "./reader-styles";

export type Bookmark = {
  id: string;
  bookId: string;
  cfi: string;
  label?: string;
  chapterTitle?: string;
  createdAt: number;
};

export type ReaderNavTab = "toc" | "bookmarks" | "search";

interface Props {
  visible: boolean;
  activeTab: ReaderNavTab;
  toc: TOCItem[];
  bookmarks: Bookmark[];
  currentChapter: string;
  isBookmarked: boolean;
  searchQuery: string;
  searchResults: ReaderSearchResultItem[];
  searchResultCount: number;
  isSearching: boolean;
  onClose: () => void;
  onTabChange: (tab: ReaderNavTab) => void;
  onSelectTocItem: (href: string) => void;
  onGoToBookmark: (cfi: string) => void;
  onDeleteBookmark: (id: string) => void;
  onToggleBookmark: () => void;
  onSearchInput: (query: string) => void;
  onSelectSearchResult: (cfi: string) => void;
}

export function ReaderTOCPanel({
  visible,
  activeTab,
  toc,
  bookmarks,
  currentChapter,
  isBookmarked,
  searchQuery,
  searchResults,
  searchResultCount,
  isSearching,
  onClose,
  onTabChange,
  onSelectTocItem,
  onGoToBookmark,
  onDeleteBookmark,
  onToggleBookmark,
  onSearchInput,
  onSelectSearchResult,
}: Props) {
  const colors = useColors();
  const s = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const { t, i18n } = useTranslation();

  const tabs: Array<{ id: ReaderNavTab; label: string; icon: React.ReactNode }> = [
    {
      id: "toc",
      label: t("reader.toc", "Оглавление"),
      icon: (
        <ListIcon size={14} color={activeTab === "toc" ? colors.primary : colors.mutedForeground} />
      ),
    },
    {
      id: "bookmarks",
      label:
        t("bookmarks.title", "Закладки") + (bookmarks.length > 0 ? ` (${bookmarks.length})` : ""),
      icon:
        activeTab === "bookmarks" ? (
          <BookmarkFilledIcon size={14} color={colors.primary} />
        ) : (
          <BookmarkIcon size={14} color={colors.mutedForeground} />
        ),
    },
    {
      id: "search",
      label: t("reader.search", "Поиск"),
      icon: (
        <SearchIcon
          size={14}
          color={activeTab === "search" ? colors.primary : colors.mutedForeground}
        />
      ),
    },
  ];

  const trimmedQuery = searchQuery.trim();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: "flex-end" }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={s.modalBackdrop} onPress={onClose} />
        <View
          style={[
            s.bottomSheet,
            { maxHeight: SCREEN_HEIGHT * 0.7, paddingBottom: insets.bottom || 16 },
            layout.isTablet && {
              width: "100%",
            },
          ]}
        >
          <View style={s.sheetHeader}>
            <View style={s.tocTabBar}>
              {tabs.map((tab) => (
                <TouchableOpacity
                  key={tab.id}
                  style={[
                    s.tocTab,
                    activeTab === tab.id && { backgroundColor: `${colors.primary}14` },
                  ]}
                  onPress={() => onTabChange(tab.id)}
                >
                  {tab.icon}
                  <Text
                    style={[
                      s.tocTabText,
                      { color: activeTab === tab.id ? colors.primary : colors.mutedForeground },
                    ]}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={onClose}>
              <XIcon size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {activeTab === "toc" && (
            <ScrollView showsVerticalScrollIndicator={false} style={s.sheetScroll}>
              {toc.length > 0 ? (
                toc.map((item) => (
                  <TOCTreeItem
                    key={item.id || item.href}
                    item={item}
                    level={0}
                    currentChapter={currentChapter}
                    onSelect={onSelectTocItem}
                  />
                ))
              ) : (
                <Text style={s.sheetEmpty}>{t("reader.noToc", "Нет оглавления")}</Text>
              )}
            </ScrollView>
          )}

          {activeTab === "bookmarks" && (
            <>
              <TouchableOpacity
                style={s.bookmarkAddBtn}
                onPress={onToggleBookmark}
                accessibilityRole="button"
              >
                {isBookmarked ? (
                  <BookmarkFilledIcon size={16} color={colors.primary} />
                ) : (
                  <BookmarkIcon size={16} color={colors.primary} />
                )}
                <Text style={s.bookmarkAddBtnText}>
                  {isBookmarked
                    ? t("bookmarks.removeCurrent", "Убрать закладку с этой страницы")
                    : t("bookmarks.addCurrent", "Добавить закладку на эту страницу")}
                </Text>
              </TouchableOpacity>
              {bookmarks.length > 0 ? (
                <ScrollView showsVerticalScrollIndicator={false} style={s.sheetScroll}>
                  {bookmarks.map((bm) => (
                    <TouchableOpacity
                      key={bm.id}
                      style={s.bookmarkItem}
                      onPress={() => onGoToBookmark(bm.cfi)}
                      activeOpacity={0.6}
                    >
                      <BookmarkFilledIcon size={14} color={colors.primary} />
                      <View style={s.bookmarkContent}>
                        <Text
                          style={[s.bookmarkLabel, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {bm.chapterTitle || t("common.unnamed")}
                        </Text>
                        {bm.label ? (
                          <Text
                            style={[s.bookmarkSnippet, { color: colors.mutedForeground }]}
                            numberOfLines={2}
                          >
                            {bm.label}
                          </Text>
                        ) : null}
                        <Text style={[s.bookmarkDate, { color: colors.mutedForeground }]}>
                          {new Date(bm.createdAt).toLocaleDateString(i18n.language, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={s.bookmarkDeleteBtn}
                        onPress={() => onDeleteBookmark(bm.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Trash2Icon size={14} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : (
                <View style={s.notebookPlaceholder}>
                  <BookmarkIcon size={32} color={`${colors.mutedForeground}60`} />
                  <Text style={s.notebookPlaceholderText}>
                    {t("bookmarks.empty", "Закладок пока нет")}
                  </Text>
                  <Text
                    style={[s.notebookPlaceholderText, { fontSize: fontSize.xs, opacity: 0.6 }]}
                  >
                    {t("bookmarks.emptyHint", "Отмечайте страницы кнопкой закладки")}
                  </Text>
                </View>
              )}
            </>
          )}

          {activeTab === "search" && (
            <>
              <View style={s.navSearchInputWrap}>
                <SearchIcon size={16} color={colors.mutedForeground} />
                <TextInput
                  style={s.navSearchInput}
                  placeholder={t("reader.searchInBook", "Искать в книге…")}
                  placeholderTextColor={colors.mutedForeground}
                  value={searchQuery}
                  onChangeText={onSearchInput}
                  autoFocus
                  returnKeyType="search"
                />
                {isSearching ? (
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                ) : trimmedQuery ? (
                  <Text style={s.navSearchCount}>{searchResultCount}</Text>
                ) : null}
              </View>
              {trimmedQuery && !isSearching && searchResultCount === 0 ? (
                <Text style={s.sheetEmpty}>{t("reader.noSearchResults", "Нет результатов")}</Text>
              ) : !trimmedQuery ? (
                <Text style={s.sheetEmpty}>
                  {t("reader.searchEmptyHint", "Введите слово или фразу — найдём по всей книге")}
                </Text>
              ) : (
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  style={s.sheetScroll}
                  keyboardShouldPersistTaps="handled"
                >
                  {searchResults.map((result, index) => (
                    <TouchableOpacity
                      key={`${result.cfi}-${index}`}
                      style={s.navSearchResult}
                      onPress={() => onSelectSearchResult(result.cfi)}
                      activeOpacity={0.6}
                    >
                      <Text style={s.navSearchResultText} numberOfLines={3}>
                        {result.pre}
                        <Text style={[s.navSearchResultText, s.navSearchResultMatch]}>
                          {result.match}
                        </Text>
                        {result.post}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
