export interface BookSelectionState {
  selectionMode: boolean;
  selectedBookIds: Set<string>;
}

/** Apply only this confirmed operation's successful deletions to the current
 * selection. New choices survive, and failures never reselect deselected books.
 * The caller separately guards selection-session identity.
 */
export function reconcileBookSelection(
  current: BookSelectionState,
  requestedIds: Iterable<string>,
  failedIds: Iterable<string>,
): BookSelectionState {
  const selectedBookIds = new Set(current.selectedBookIds);
  const failed = new Set(failedIds);
  for (const id of requestedIds) {
    if (!failed.has(id)) selectedBookIds.delete(id);
  }
  return { selectionMode: selectedBookIds.size > 0, selectedBookIds };
}
