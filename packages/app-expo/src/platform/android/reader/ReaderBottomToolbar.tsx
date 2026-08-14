import { ReadingProgressSlider } from "@/components/reader/ReadingProgressSlider";
import type { ReaderBottomToolbarProps } from "@/screens/reader/ReaderBottomToolbar.types";
import { withOpacity } from "@/styles/theme";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, StyleSheet, View } from "react-native";

export function ReaderBottomToolbar(props: ReaderBottomToolbarProps) {
  const actions = [
    {
      key: "toc",
      icon: "format-list-bulleted" as const,
      label: props.labels.toc,
      onPress: props.onOpenToc,
    },
    {
      key: "bookmark",
      icon: props.isBookmarked ? "bookmark" : "bookmark-border",
      label: props.labels.bookmarks,
      onPress: props.onToggleBookmark,
    },
    {
      key: "notes",
      icon: "edit-note" as const,
      label: props.labels.notes,
      onPress: props.onOpenNotes,
    },
    {
      key: "search",
      icon: "search" as const,
      label: props.labels.search,
      onPress: props.onOpenSearch,
    },
  ];

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(props.bottomInset, 8),
          backgroundColor: props.mutedColor,
          borderTopColor: withOpacity(props.foregroundColor, 0.1),
        },
      ]}
    >
      <ReadingProgressSlider
        progress={props.progress}
        onSeek={props.onSeek}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
        accentColor={props.accentColor}
        trackColor={withOpacity(props.foregroundColor, 0.12)}
        textColor={withOpacity(props.foregroundColor, 0.6)}
      />
      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            style={({ pressed }) => [
              styles.action,
              action.key === "bookmark" && props.isBookmarked
                ? { backgroundColor: withOpacity(props.accentColor, 0.18) }
                : null,
              pressed ? { backgroundColor: withOpacity(props.foregroundColor, 0.1) } : null,
            ]}
          >
            <MaterialIcons
              name={action.icon as keyof typeof MaterialIcons.glyphMap}
              size={26}
              color={
                action.key === "bookmark" && props.isBookmarked
                  ? props.accentColor
                  : props.foregroundColor
              }
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 6,
    paddingHorizontal: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    elevation: 8,
  },
  actions: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  action: {
    width: 64,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});

export type { ReaderBottomToolbarProps } from "@/screens/reader/ReaderBottomToolbar.types";
