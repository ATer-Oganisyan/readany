import { ReadingProgressSlider } from "@/components/reader/ReadingProgressSlider";
import {
  BookmarkFilledIcon,
  BookmarkIcon,
  NotebookPenIcon,
  SearchIcon,
} from "@/components/ui/Icon";
import { Text } from "@/components/ui/Typography";
import { withOpacity } from "@/styles/theme";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import type { ReaderBottomToolbarProps } from "./ReaderBottomToolbar.types";
import { ListIcon } from "./reader-icons";

export function ReaderBottomToolbar(props: ReaderBottomToolbarProps) {
  const actions = [
    {
      key: "toc",
      icon: <ListIcon size={22} color={props.foregroundColor} />,
      onPress: props.onOpenToc,
    },
    {
      key: "bookmarks",
      icon: props.isBookmarked ? (
        <BookmarkFilledIcon size={22} color={props.accentColor} />
      ) : (
        <BookmarkIcon size={22} color={props.foregroundColor} />
      ),
      onPress: props.onToggleBookmark,
    },
    {
      key: "notes",
      icon: <NotebookPenIcon size={22} color={props.foregroundColor} />,
      onPress: props.onOpenNotes,
    },
    {
      key: "search",
      icon: <SearchIcon size={22} color={props.foregroundColor} />,
      onPress: props.onOpenSearch,
    },
  ] as const;

  return (
    <View style={[styles.container, { paddingBottom: Math.max(props.bottomInset, 8) + 6 }]}>
      <ReadingProgressSlider
        progress={props.progress}
        onSeek={props.onSeek}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
        accentColor={props.accentColor}
        trackColor={withOpacity(props.foregroundColor, 0.12)}
        textColor={withOpacity(props.foregroundColor, 0.6)}
      />
      <View style={styles.row}>
        {actions.map((action) => (
          <TouchableOpacity key={action.key} style={styles.button} onPress={action.onPress}>
            {action.icon}
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                {
                  color:
                    action.key === "bookmarks" && props.isBookmarked
                      ? props.accentColor
                      : props.mutedColor,
                },
              ]}
            >
              {props.labels[action.key]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 8, paddingHorizontal: 18 },
  row: { flexDirection: "row", alignItems: "center" },
  button: {
    flex: 1,
    minWidth: 0,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  label: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
});

export type { ReaderBottomToolbarProps } from "./ReaderBottomToolbar.types";
