import { useTTSStore } from "@/stores/tts-store";
import { useEffect, useRef } from "react";

/** The global player resumes from the visible text if the reader moved after pausing. */
export function useResumeFromReader(
  bookId: string,
  currentCfi: string,
  ready: boolean,
  startFromVisibleText: (isCurrent: () => boolean) => Promise<void>,
) {
  const latest = useRef({ currentCfi, ready, startFromVisibleText });
  latest.current = { currentCfi, ready, startFromVisibleText };

  useEffect(() => {
    const initial = useTTSStore.getState();
    let pausedCfi: string | null =
      initial.currentBookId === bookId && initial.playState === "paused"
        ? latest.current.currentCfi
        : null;
    let restarting = false;
    let generation = 0;
    let mounted = true;
    const unsubscribe = useTTSStore.subscribe((state, previous) => {
      if (state.currentBookId !== previous.currentBookId || state.playState !== previous.playState) {
        generation += 1;
        restarting = false;
      }
      if (
        state.currentBookId === bookId &&
        state.playState === "paused" &&
        previous.playState !== "paused"
      ) {
        pausedCfi = latest.current.currentCfi;
      }
    });
    const resumeFromReader = () => {
      if (useTTSStore.getState().currentBookId !== bookId) return false;
      if (restarting) return true;
      const current = latest.current;
      if (!current.ready || !pausedCfi || !current.currentCfi || pausedCfi === current.currentCfi)
        return false;
      restarting = true;
      const request = ++generation;
      const isCurrent = () => mounted && request === generation &&
        useTTSStore.getState().currentBookId === bookId;
      void current
        .startFromVisibleText(isCurrent)
        .catch((error) => console.warn("[TTS] Could not restart from the visible text", error))
        .finally(() => {
          if (request === generation) restarting = false;
        });
      return true;
    };
    useTTSStore.setState({ resumeFromReader });
    return () => {
      mounted = false;
      generation += 1;
      unsubscribe();
      if (useTTSStore.getState().resumeFromReader === resumeFromReader) {
        useTTSStore.setState({ resumeFromReader: null });
      }
    };
  }, [bookId]);
}
