import { retainBackendBookSync, updateBackendBookProgress } from "@/lib/narra/backend-book-sync";
import { useNarraStore } from "@/stores/narra-store";
import { useIsFocused } from "@react-navigation/native";
import type { Book } from "@readany/core/types";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

export function useBackendBook(
  book: Book | undefined,
  active = true,
  progress = book?.progress ?? 0,
) {
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  const focused = useIsFocused();
  const hydrated = useNarraStore((state) => state._hasHydrated);
  const latest = useRef(book);
  latest.current = book;
  const latestProgress = useRef(progress);
  latestProgress.current = progress;
  const id = book?.id;
  useEffect(() => {
    if (
      !focused ||
      !foreground ||
      !id ||
      !active ||
      !hydrated ||
      !latest.current ||
      latest.current.deletedAt
    )
      return;
    return retainBackendBookSync(latest.current, latestProgress.current);
  }, [focused, foreground, active, hydrated, id]);
  useEffect(() => {
    if (active && id) updateBackendBookProgress(id, progress);
  }, [active, id, progress]);
}
