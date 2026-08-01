export const EMPTY_STATE_ACTION_HEIGHT = 56;

/** Matches the native title, SF Symbol, gap, and asymmetric UIKit content insets. */
export function getEmptyStateActionWidth(label: string): number {
  return Math.max(56, Math.ceil(label.length * 11.5) + 76);
}
