import { type ThemeColors, fontSize, fontWeight, headingFontFamily, radius } from "@/styles/theme";
import { StyleSheet } from "react-native";

export function getBookCardMetrics(cardWidth: number) {
  const coverWidth = cardWidth;
  const coverHeight = coverWidth * (41 / 28);
  return { coverWidth, coverHeight };
}

export const makeStyles = (colors: ThemeColors, cardWidth: number) => {
  const { coverWidth, coverHeight } = getBookCardMetrics(cardWidth);

  return StyleSheet.create({
    container: { width: coverWidth },
    coverWrap: {
      width: coverWidth,
      height: coverHeight,
      borderRadius: radius.sm,
      overflow: "hidden",
      position: "relative",
      isolation: "isolate",
    },
    coverCanvas: {
      width: "100%",
      height: "100%",
      position: "relative",
      isolation: "isolate",
    },
    coverImage: { width: "100%", height: "100%" },
    fallbackCover: {
      flex: 1,
      overflow: "hidden",
      padding: 16,
      backgroundColor: colors.bookCoverSurface,
    },
    progressChip: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.full,
      overflow: "hidden",
      backgroundColor: "rgba(0,0,0,0.5)",
    },
    cardProgress: {
      fontSize: 13,
      fontWeight: fontWeight.semibold,
      lineHeight: 18,
      flexShrink: 0,
      color: "rgba(255,255,255,0.92)",
      textAlign: "left",
      fontVariant: ["tabular-nums"],
    },
    fallbackTitle: {
      fontFamily: headingFontFamily,
      textAlign: "left",
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      color: colors.primary30,
      lineHeight: 24,
    },
    vecOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.5)",
      alignItems: "center",
      justifyContent: "center",
    },
    vecOverlayText: { marginTop: 6, fontSize: 14, fontWeight: fontWeight.medium, color: "#fff" },
    queuedOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.35)",
      alignItems: "center",
      justifyContent: "center",
    },
    queuedOverlayText: { marginTop: 4, fontSize: 12, fontWeight: fontWeight.medium, color: "#fff" },
    remoteOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(59, 130, 246, 0.6)",
      alignItems: "center",
      justifyContent: "center",
    },
    remoteOverlayText: {
      fontSize: 12,
      fontWeight: fontWeight.medium,
      color: "#fff",
      backgroundColor: "rgba(0,0,0,0.4)",
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.sm,
    },
    moreButtonWrap: {
      position: "absolute",
      right: 6,
      bottom: 6,
      zIndex: 22,
    },
    moreButton: {
      width: 28,
      height: 28,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.36)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.16)",
    },
    infoWrap: { width: coverWidth, paddingTop: 6 },
    bookTitle: {
      fontFamily: headingFontFamily,
      fontSize: 13,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      lineHeight: 18,
    },
    bookAuthor: {
      fontSize: 11,
      color: colors.mutedForeground,
      lineHeight: 13,
      marginTop: 2,
    },
    tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 3, marginTop: 3 },
    tagBadge: {
      backgroundColor: `${colors.muted}`,
      borderRadius: radius.full,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    tagText: { fontSize: 8, color: colors.mutedForeground },
    tagBadgeUncategorized: {
      backgroundColor: `${colors.muted}80`,
      borderRadius: radius.full,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    tagTextUncategorized: { fontSize: 8, color: `${colors.mutedForeground}99` },
    tagOverflow: { fontSize: 8, color: `${colors.mutedForeground}99`, alignSelf: "center" },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 3,
      minHeight: 14,
    },
    completeText: { fontSize: 9, fontWeight: fontWeight.medium, color: "#16a34a" },
    newBadge: {
      backgroundColor: `${colors.primary}14`,
      borderRadius: radius.full,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    newText: { fontSize: 8, fontWeight: fontWeight.medium, color: colors.primary },
    formatText: {
      fontSize: 8,
      color: `${colors.mutedForeground}99`,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
  });
};
