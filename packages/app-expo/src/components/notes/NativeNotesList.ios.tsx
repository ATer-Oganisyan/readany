import { Text } from "@/components/ui/Typography";
import { radius, useColors } from "@/styles/theme";
import { Pressable, SectionList, StyleSheet, View } from "react-native";
import type { NativeNotesListProps } from "./NativeNotesList";

/** Native RN list keeps UINavigationBar large-title transitions connected to scrolling. */
export function NativeNotesList({ sections, onPress }: NativeNotesListProps) {
  const colors = useColors();

  return (
    <SectionList
      style={{ backgroundColor: colors.background }}
      sections={sections}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      renderSectionHeader={({ section }) => (
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          {section.title}
        </Text>
      )}
      renderItem={({ item, index, section }) => {
        const isFirst = index === 0;
        const isLast = index === section.data.length - 1;

        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Открыть заметку «${item.title}»`}
            onPress={() => onPress(item.id)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? colors.primary5 : colors.elevation1,
                borderColor: colors.primary5,
                borderTopWidth: isFirst ? 0.5 : 0,
                borderBottomWidth: 0.5,
                borderTopLeftRadius: isFirst ? radius.card : 0,
                borderTopRightRadius: isFirst ? radius.card : 0,
                borderBottomLeftRadius: isLast ? radius.card : 0,
                borderBottomRightRadius: isLast ? radius.card : 0,
              },
            ]}
          >
            <View style={styles.rowContent}>
              <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
                {item.title}
              </Text>
              <View style={styles.metaRow}>
                <Text numberOfLines={1} style={[styles.meta, { color: colors.mutedForeground }]}>
                  {item.dateLabel}
                </Text>
                {item.preview ? (
                  <Text
                    numberOfLines={1}
                    style={[styles.preview, { color: colors.mutedForeground }]}
                  >
                    {item.preview}
                  </Text>
                ) : null}
              </View>
              {item.bookTitle ? (
                <Text numberOfLines={1} style={[styles.book, { color: colors.mutedForeground }]}>
                  {item.bookTitle}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

export type {
  NativeNoteListItem,
  NativeNoteListSection,
  NativeNotesListProps,
} from "./NativeNotesList";

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 28 },
  sectionTitle: { fontSize: 20, fontWeight: "600", paddingTop: 22, paddingBottom: 8 },
  row: { overflow: "hidden", paddingHorizontal: 16, borderLeftWidth: 0.5, borderRightWidth: 0.5 },
  rowContent: { paddingVertical: 12 },
  title: { fontSize: 17, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  meta: { fontSize: 15, flexShrink: 0 },
  preview: { fontSize: 15, flex: 1 },
  book: { fontSize: 14, marginTop: 2 },
});
