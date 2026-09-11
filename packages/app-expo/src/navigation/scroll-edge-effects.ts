export const NATIVE_SCROLL_EDGE_EFFECTS = {
  top: "hard",
  bottom: "automatic",
  left: "automatic",
  right: "automatic",
} as const;

/** iOS starts at -adjustedContentInset.top, not at zero. */
export function topScrollEdgeEffect(offsetY: number, insetTop: number): "hidden" | "hard" {
  return offsetY + insetTop > 1 ? "hard" : "hidden";
}
