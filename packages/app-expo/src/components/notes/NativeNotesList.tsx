import { Text } from "@/components/ui/Typography";
import { useColors } from "@/styles/theme";
import { Pressable, SectionList, StyleSheet, View } from "react-native";

export interface NativeNoteListItem {
  id: string;
  title: string;
  preview: string;
  dateLabel: string;
  bookTitle?: string;
}

export interface NativeNoteListSection {
  title: string;
  data: NativeNoteListItem[];
}

export interface NativeNotesListProps {
  sections: NativeNoteListSection[];
  onPress: (id: string) => void;
}

/** Cross-platform fallback. iOS replaces this with a real SwiftUI inset-grouped List. */
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
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{section.title}</Text>
      )}
      renderItem={({ item, index, section }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Открыть заметку «${item.title}»`}
          onPress={() => onPress(item.id)}
          style={({ pressed }) => [
            styles.row,
            {
              backgroundColor: pressed ? colors.primary : colors.card,
              borderBottomColor: colors.border,
              borderBottomWidth: index === section.data.length - 1 ? 0 : StyleSheet.hairlineWidth,
            },
          ]}
        >
          {({ pressed }) => (
            <View style={styles.rowContent}>
              <Text
                numberOfLines={1}
                style={[
                  styles.title,
                  { color: pressed ? colors.primaryForeground : colors.foreground },
                ]}
              >
                {item.title}
              </Text>
              <View style={styles.metaRow}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.meta,
                    { color: pressed ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {item.dateLabel}
                </Text>
                {item.preview ? (
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.preview,
                      { color: pressed ? colors.primaryForeground : colors.mutedForeground },
                    ]}
                  >
                    {item.preview}
                  </Text>
                ) : null}
              </View>
              {item.bookTitle ? (
                <Text
                  numberOfLines={1}
                  style={[
                    styles.book,
                    { color: pressed ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {item.bookTitle}
                </Text>
              ) : null}
            </View>
          )}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 28 },
  sectionTitle: { fontSize: 20, fontWeight: "600", marginTop: 22, marginBottom: 8 },
  row: { overflow: "hidden", paddingHorizontal: 16 },
  rowContent: { paddingVertical: 12 },
  title: { fontSize: 17, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  meta: { fontSize: 15, flexShrink: 0 },
  preview: { fontSize: 15, flex: 1 },
  book: { fontSize: 14, marginTop: 2 },
});
