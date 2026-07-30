import { ReadingProgressSlider } from "@/components/reader/ReadingProgressSlider";
import { withOpacity } from "@/styles/theme";
import { StyleSheet, View } from "react-native";
import type { ReaderBottomToolbarProps } from "./ReaderBottomToolbar.types";

export function ReaderBottomToolbar(props: ReaderBottomToolbarProps) {
  return (
    <View style={[styles.container, { paddingBottom: Math.max(props.bottomInset, 8) + 4 }]}>
      <ReadingProgressSlider
        progress={props.progress}
        onSeek={props.onSeek}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
        accentColor={props.accentColor}
        trackColor={withOpacity(props.foregroundColor, 0.12)}
        textColor={withOpacity(props.foregroundColor, 0.6)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 4, paddingHorizontal: 18 },
});

export type { ReaderBottomToolbarProps } from "./ReaderBottomToolbar.types";
