export const EMPTY_STATE_ACTION_HEIGHT = 56;

/** Matches the native title, SF Symbol, gap, and UIKit content insets. */
export function getEmptyStateActionWidth(label: string): number {
  return Math.max(56, Math.ceil(label.length * 11.5) + 76);
}

/** Matches the import menu title without a leading icon. */
export function getEmptyStateMenuButtonWidth(label: string): number {
  return Math.max(56, Math.ceil(label.length * 11.5) + 36);
}
