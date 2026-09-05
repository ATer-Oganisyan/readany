/** Whether every book in the current filtered view is selected. */
export function areAllVisibleBooksSelected(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
}

/** The bulk toggle acts on the visible view, not on hidden selections. */
export function toggleVisibleBookSelection(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): Set<string> {
  const next = new Set(selected);
  const removeVisible = areAllVisibleBooksSelected(selected, visibleIds);
  for (const id of visibleIds) {
    if (removeVisible) next.delete(id);
    else next.add(id);
  }
  return next;
}
