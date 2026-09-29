import { BookCardContextMenu } from "@/components/library/BookCardContextMenu";
import { Text } from "@/components/ui/Typography";
import { radius, useColors } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import { Pressable, SectionList, StyleSheet, View } from "react-native";

export interface NativeNoteListItem {
  id: string;
  title: string;
  bookTitle?: string;
}

export interface NativeNoteListSection {
  title: string;
  data: NativeNoteListItem[];
}

export interface NativeNotesListProps {
  sections: NativeNoteListSection[];
  onPress: (id: string) => void;
  onDelete: (id: string) => void;
  itemAccessibilityKey?: string;
}

/** Android note list. */
export function NativeNotesList({
  sections,
  onPress,
  onDelete,
  itemAccessibilityKey = "notes.openNote",
}: NativeNotesListProps) {
  const colors = useColors();
  const { t } = useTranslation();

  return (
    <SectionList
      style={{ backgroundColor: colors.background }}
      sections={sections}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      alwaysBounceVertical
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      renderSectionHeader={({ section }) => (
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          {section.title}
        </Text>
      )}
      renderItem={({ item, index, section }) => (
        <BookCardContextMenu
          accessibilityLabel={t(itemAccessibilityKey, "Открыть «{{title}}»", {
            title: item.title,
          })}
          onPress={() => onPress(item.id)}
          items={[
            {
              key: "delete",
              label: t("common.delete", "Удалить"),
              sfSymbol: "trash",
              destructive: true,
              onPress: () => onDelete(item.id),
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(itemAccessibilityKey, "Открыть «{{title}}»", {
              title: item.title,
            })}
            onPress={() => onPress(item.id)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? colors.primary5 : colors.elevation1,
                borderTopLeftRadius: index === 0 ? radius.card : 0,
                borderTopRightRadius: index === 0 ? radius.card : 0,
                borderBottomLeftRadius: index === section.data.length - 1 ? radius.card : 0,
                borderBottomRightRadius: index === section.data.length - 1 ? radius.card : 0,
                borderBottomColor: colors.border,
                borderBottomWidth: index === section.data.length - 1 ? 0 : StyleSheet.hairlineWidth,
              },
            ]}
          >
            {() => (
              <View style={styles.rowContent}>
                <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
                  {item.title}
                </Text>
                {item.bookTitle ? (
                  <Text numberOfLines={1} style={[styles.book, { color: colors.mutedForeground }]}>
                    {item.bookTitle}
                  </Text>
                ) : null}
              </View>
            )}
          </Pressable>
        </BookCardContextMenu>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 28 },
  sectionTitle: {
    paddingHorizontal: 16,
    fontSize: 14,
    marginTop: 22,
    marginBottom: 8,
  },
  row: { overflow: "hidden", paddingHorizontal: 16 },
  rowContent: { paddingVertical: 12 },
  title: { fontSize: 17, fontWeight: "600" },
  book: { fontSize: 14, marginTop: 2 },
});
