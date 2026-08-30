import { describe, expect, it } from "vitest";
import type { BackendBookTtsSection } from "./backend-book-api";
import {
  activatePendingTtsMarkupAtChapterBoundary,
  initialTtsMarkupActivation,
  projectTtsScriptOntoReaderSegments,
  receiveReadyTtsMarkup,
} from "./tts-script";

const section: BackendBookTtsSection = {
  key: "chapter-1",
  title: "Глава 1",
  index: 0,
  startOffset: 0,
  endOffset: 36,
  segments: [
    {
      id: "tts:0:0",
      startOffset: 0,
      endOffset: 9,
      text: "— Привет,",
      kind: "speech",
      characterKey: "character:ivan",
      confidence: 0.95,
    },
    {
      id: "tts:0:1",
      startOffset: 9,
      endOffset: 24,
      text: " — сказал Иван.",
      kind: "narration",
      characterKey: null,
      confidence: 1,
    },
    {
      id: "tts:0:2",
      startOffset: 24,
      endOffset: 36,
      text: " — Как дела?",
      kind: "speech",
      characterKey: "character:ivan",
      confidence: 0.95,
    },
  ],
};

describe("TTS script activation", () => {
  it("keeps a newly arrived revision pending until another chapter begins", () => {
    const playing = { ...initialTtsMarkupActivation(), playbackSectionIndex: 3 };
    const pending = receiveReadyTtsMarkup(playing, {
      revision: 2,
      currentSectionIndex: 3,
      playbackActive: true,
    });
    expect(pending).toMatchObject({ activeRevision: null, pendingRevision: 2 });

    expect(activatePendingTtsMarkupAtChapterBoundary(pending, 3)).toMatchObject({
      activeRevision: null,
      pendingRevision: 2,
    });
    expect(activatePendingTtsMarkupAtChapterBoundary(pending, 4)).toMatchObject({
      activeRevision: 2,
      pendingRevision: null,
      playbackSectionIndex: 4,
    });
  });

  it("activates ready markup immediately before playback starts", () => {
    expect(
      receiveReadyTtsMarkup(initialTtsMarkupActivation(), {
        revision: 1,
        currentSectionIndex: 0,
        playbackActive: false,
      }),
    ).toMatchObject({ activeRevision: 1, pendingRevision: null });
  });
});

describe("reader projection", () => {
  it("uses one narrator voice when no TTS markup is available", () => {
    expect(
      projectTtsScriptOntoReaderSegments([{ text: "Обычный текст.", cfi: "epubcfi(/6/2)" }], null),
    ).toEqual([
      {
        text: "Обычный текст.",
        cfi: "epubcfi(/6/2)",
        ttsKind: "narration",
        ttsCharacterKey: null,
      },
    ]);
  });

  it("splits a reader sentence so the author remark remains narration", () => {
    expect(
      projectTtsScriptOntoReaderSegments(
        [
          {
            text: "— Привет, — сказал Иван. — Как дела?",
            cfi: "epubcfi(/6/4)",
          },
        ],
        section,
      ),
    ).toEqual([
      {
        text: "— Привет,",
        cfi: "epubcfi(/6/4)",
        ttsKind: "speech",
        ttsCharacterKey: "character:ivan",
        sectionIndex: 0,
      },
      {
        text: " — сказал Иван.",
        cfi: "epubcfi(/6/4)",
        ttsKind: "narration",
        ttsCharacterKey: null,
        sectionIndex: 0,
      },
      {
        text: " — Как дела?",
        cfi: "epubcfi(/6/4)",
        ttsKind: "speech",
        ttsCharacterKey: "character:ivan",
        sectionIndex: 0,
      },
    ]);
  });
});
