import { StyleSheet, View } from "react-native";

interface BookSpineOverlayProps {
  coverWidth?: number;
  showForeEdge?: boolean;
}

/** Общий физический корешок: не зависит от наличия изображения или текста обложки. */
export function BookSpineOverlay({ coverWidth = 0, showForeEdge = true }: BookSpineOverlayProps) {
  return (
    <View pointerEvents="none" style={styles.spineOverlay}>
      <View style={styles.spineStrip1} />
      <View style={styles.spineStrip2} />
      <View style={styles.spineStrip3} />
      <View style={styles.spineStrip4} />
      <View style={styles.spineStrip5} />
      <View style={styles.spineStrip6} />
      <View style={styles.spineStrip7} />
      {showForeEdge ? (
        <View
          style={[styles.spineEdgeRight, { right: -coverWidth * 0.92, width: coverWidth * 0.02 }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  spineOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: "8%",
    flexDirection: "row",
    zIndex: 2,
  },
  spineStrip1: { width: "6%", height: "100%", backgroundColor: "rgba(0,0,0,0.10)" },
  spineStrip2: { width: "8%", height: "100%", backgroundColor: "rgba(20,20,20,0.20)" },
  spineStrip3: { width: "5%", height: "100%", backgroundColor: "rgba(240,240,240,0.40)" },
  spineStrip4: { width: "18%", height: "100%", backgroundColor: "rgba(215,215,215,0.35)" },
  spineStrip5: { width: "12%", height: "100%", backgroundColor: "rgba(150,150,150,0.25)" },
  spineStrip6: { width: "20%", height: "100%", backgroundColor: "rgba(100,100,100,0.18)" },
  spineStrip7: { width: "31%", height: "100%", backgroundColor: "rgba(175,175,175,0.12)" },
  spineEdgeRight: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(30,30,30,0.12)",
  },
});
