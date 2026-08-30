import type { VisibleTTSSegment } from "@/hooks/use-reader-bridge";
import type { BackendBookTtsSection } from "./backend-book-api";

export interface ScriptedReaderTtsSegment extends VisibleTTSSegment {
  ttsKind: "narration" | "speech";
  ttsCharacterKey: string | null;
  sectionIndex?: number;
}

export interface TtsMarkupActivationState {
  activeRevision: number | null;
  pendingRevision: number | null;
  playbackSectionIndex: number | null;
}

export function initialTtsMarkupActivation(): TtsMarkupActivationState {
  return { activeRevision: null, pendingRevision: null, playbackSectionIndex: null };
}

export function receiveReadyTtsMarkup(
  state: TtsMarkupActivationState,
  input: { revision: number; currentSectionIndex: number; playbackActive: boolean },
): TtsMarkupActivationState {
  if (!input.playbackActive) {
    return {
      activeRevision: input.revision,
      pendingRevision: null,
      playbackSectionIndex: input.currentSectionIndex,
    };
  }
  if (state.activeRevision === input.revision || state.pendingRevision === input.revision) {
    return state;
  }
  return {
    ...state,
    pendingRevision: input.revision,
    playbackSectionIndex: state.playbackSectionIndex ?? input.currentSectionIndex,
  };
}

export function activatePendingTtsMarkupAtChapterBoundary(
  state: TtsMarkupActivationState,
  nextSectionIndex: number,
): TtsMarkupActivationState {
  const changed =
    state.playbackSectionIndex != null && state.playbackSectionIndex !== nextSectionIndex;
  if (!changed || state.pendingRevision == null) {
    return { ...state, playbackSectionIndex: nextSectionIndex };
  }
  return {
    activeRevision: state.pendingRevision,
    pendingRevision: null,
    playbackSectionIndex: nextSectionIndex,
  };
}

function narratorSegment(segment: VisibleTTSSegment): ScriptedReaderTtsSegment {
  return {
    ...segment,
    ttsKind: "narration",
    ttsCharacterKey: null,
  };
}

function bestVisibleStart(sectionText: string, texts: readonly string[]): number {
  const first = texts.find((text) => text.length > 0);
  if (!first) return -1;
  const candidates: number[] = [];
  let cursor = 0;
  while (cursor <= sectionText.length - first.length) {
    const found = sectionText.indexOf(first, cursor);
    if (found < 0) break;
    candidates.push(found);
    cursor = found + Math.max(1, first.length);
  }
  let best = -1;
  let bestScore = -1;
  for (const candidate of candidates) {
    let score = 0;
    let search = candidate;
    for (const text of texts) {
      const found = sectionText.indexOf(text, search);
      if (found < 0) break;
      score += 1;
      search = found + text.length;
    }
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function projectTtsScriptOntoReaderSegments(
  readerSegments: readonly VisibleTTSSegment[],
  section: BackendBookTtsSection | null,
): ScriptedReaderTtsSegment[] {
  if (!section?.segments.length) return readerSegments.map(narratorSegment);
  const sectionText = section.segments.map(({ text }) => text).join("");
  let cursor = bestVisibleStart(
    sectionText,
    readerSegments.map(({ text }) => text),
  );
  if (cursor < 0) return readerSegments.map(narratorSegment);
  const result: ScriptedReaderTtsSegment[] = [];
  for (const readerSegment of readerSegments) {
    const localStart = sectionText.indexOf(readerSegment.text, cursor);
    if (localStart < 0) {
      result.push(narratorSegment(readerSegment));
      continue;
    }
    const localEnd = localStart + readerSegment.text.length;
    const globalStart = section.startOffset + localStart;
    const globalEnd = section.startOffset + localEnd;
    for (const scriptSegment of section.segments) {
      const start = Math.max(globalStart, scriptSegment.startOffset);
      const end = Math.min(globalEnd, scriptSegment.endOffset);
      if (end <= start) continue;
      const text = sectionText.slice(start - section.startOffset, end - section.startOffset);
      if (!text.trim()) continue;
      result.push({
        text,
        cfi: readerSegment.cfi,
        ttsKind: scriptSegment.kind,
        ttsCharacterKey: scriptSegment.characterKey,
        sectionIndex: section.index,
      });
    }
    cursor = localEnd;
  }
  return result.length ? result : readerSegments.map(narratorSegment);
}
