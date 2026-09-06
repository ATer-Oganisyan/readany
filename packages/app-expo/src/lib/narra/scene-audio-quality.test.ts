// Source-integrity regressions: actual generator and mocked gateway, no model calls.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("expo-secure-store", () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn() }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "own-scene-quality-fixture" }));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("@/stores/narra-store", () => ({
  useNarraStore: { getState: () => ({ narratorVoicePreference: "female" }) },
}));
import { setNarraGatewayAdapter } from "@/lib/ai/narra-gateway-fetch";
import {
  generateNarraAudioScenario,
  getNarratorVoice,
  validateNarraSceneAudioSegments,
} from "./scene-audio";
import type { NarraCharacter } from "./types";
const anna: NarraCharacter = {
  id: "own-anna",
  name: "Анна",
  fullName: "Анна",
  role: "",
  gender: "female",
  voice: "Ast",
  traits: [],
  speechStyle: "",
  speechExamples: [],
  appearancePrompt: "",
  unlockProgress: 0,
};
const request = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  request.mockReset();
  setNarraGatewayAdapter(request);
});
afterEach(() => {
  setNarraGatewayAdapter(null);
});
function reply(segments: unknown[]) {
  request.mockResolvedValueOnce(new Response(JSON.stringify({ text: JSON.stringify(segments) })));
}
it.each(["text", "content", "array", "fenced"])(
  "accepts complete source in %s response format",
  async (format) => {
    const scenario = JSON.stringify([
      { type: "narration", character: null, text: "Анна открыла окно." },
    ]);
    const body =
      format === "array"
        ? scenario
        : format === "fenced"
          ? `\`\`\`json\n${scenario}\n\`\`\``
          : JSON.stringify({ [format]: scenario });
    request.mockResolvedValueOnce(new Response(body));
    const segments = await generateNarraAudioScenario("Анна открыла окно.", [anna]);
    expect(segments.map((segment) => segment.text).join("")).toBe("Анна открыла окно.");
  },
);

it("accepts exactly 12000 characters and rejects 12001 before a request", async () => {
  const source = "а".repeat(12000);
  reply([{ type: "narration", text: source }]);
  expect((await generateNarraAudioScenario(source, []))[0].text).toBe(source);
  expect(request).toHaveBeenCalledTimes(1);
  await expect(generateNarraAudioScenario(`${source}б`, [])).rejects.toMatchObject({
    code: "REQUEST",
    backendCode: "SCENE_AUDIO_TOO_LONG",
  });
  expect(request).toHaveBeenCalledTimes(1);
});

it("preserves the complete source at exactly 24 segments", async () => {
  const sentences = Array.from({ length: 24 }, (_, index) => `Шаг ${index + 1}.`);
  const source = sentences.join(" \n");
  reply(sentences.map((text) => ({ type: "narration", text })));
  const segments = await generateNarraAudioScenario(source, []);
  expect(segments).toHaveLength(24);
  expect(segments.map((segment) => segment.text).join("")).toBe(source);
});

it.each([{ text: 4 }, { content: [] }, { text: {}, content: "[]" }, null, 4])(
  "rejects unsafe envelope %j with a safe code",
  async (payload) => {
    request.mockResolvedValueOnce(new Response(JSON.stringify(payload)));
    await expect(generateNarraAudioScenario("Анна.", [])).rejects.toMatchObject({
      backendCode: "SCENE_AUDIO_TEXT_MISMATCH",
    });
  },
);
it("rejects invented words", async () => {
  reply([
    { type: "narration", character: null, text: "Анна открыла окно. За окном появился дракон." },
  ]);
  await expect(generateNarraAudioScenario("Анна открыла окно.", [anna])).rejects.toMatchObject({
    code: "SERVICE",
  });
  expect(request).toHaveBeenCalledTimes(1);
});
it("rejects missing and reordered sentences", async () => {
  const source = "Анна открыла окно. Потом она зажгла лампу. Наконец она села.";
  reply([
    { type: "narration", text: "Наконец она села." },
    { type: "narration", text: "Анна открыла окно." },
  ]);
  await expect(generateNarraAudioScenario(source, [anna])).rejects.toMatchObject({
    code: "SERVICE",
  });
});
it("rejects rather than truncates the twenty-fifth segment", async () => {
  const sentences = Array.from({ length: 25 }, (_, index) => `Шаг ${index + 1}.`);
  reply(sentences.map((text) => ({ type: "narration", text })));
  await expect(generateNarraAudioScenario(sentences.join(" "), [])).rejects.toMatchObject({
    code: "SERVICE",
  });
});
it("rejects rather than filters a malformed segment", async () => {
  reply([
    { type: "narration", text: "Анна открыла окно." },
    { type: "narration", text: null },
  ]);
  await expect(
    generateNarraAudioScenario("Анна открыла окно. Потом она села.", [anna]),
  ).rejects.toMatchObject({ code: "SERVICE" });
});
it("forces narration to use the narrator even with a character ID", async () => {
  reply([{ type: "narration", character: anna.id, text: "Анна открыла окно." }]);
  const result = await generateNarraAudioScenario("Анна открыла окно.", [anna]);
  expect(result[0]).toMatchObject({
    type: "narration",
    characterId: null,
    voice: getNarratorVoice(),
    speaker: "Рассказчик",
  });
});
it("rejects oversized input before making a paid call", async () => {
  const prefix = "а".repeat(12_000);
  reply([{ type: "narration", text: prefix }]);
  await expect(
    generateNarraAudioScenario(`${prefix} НЕПРОЧИТАННЫЙ КОНЕЦ.`, []),
  ).rejects.toMatchObject({ code: "REQUEST" });
  expect(request).not.toHaveBeenCalled();
});

it("restores original whitespace and covers the exact complete source", async () => {
  const source = "\n  Анна\tоткрыла  окно.\r\n— Привет!  \n";
  reply([
    { type: "narration", text: "Анна открыла окно." },
    { type: "speech", character: anna.id, text: "— Привет!" },
  ]);
  const segments = await generateNarraAudioScenario(source, [anna]);
  expect(segments.map((segment) => segment.text).join("")).toBe(source);
  expect(segments[1]).toMatchObject({ voice: "Ast", characterId: anna.id });
  const cached = segments.map((segment) => ({ ...segment, audioUri: "file:///fixture.mp3" }));
  expect(validateNarraSceneAudioSegments(cached, source)).toEqual(cached);
});

it.each([
  ["Анна. Борис.", ["Анна."]],
  ["Анна. Борис.", ["Анна.", "Анна.", "Борис."]],
  ["— Привет!", ["Привет!"]],
  ["Анна не спит.", ["Анна спит."]],
  ["Анна спит.", ["Аннаспит."]],
  ["Аннаспит.", ["Анна спит."]],
])("rejects omitted, duplicated or rewritten source %s", async (source, text) => {
  reply(text.map((text) => ({ type: "narration", text })));
  await expect(generateNarraAudioScenario(source, [])).rejects.toMatchObject({
    backendCode: "SCENE_AUDIO_TEXT_MISMATCH",
  });
});

it.each([null, 4, {}, { type: "wrong", text: "Анна." }, { type: "narration", text: 42 }])(
  "rejects malformed model item %j safely",
  async (item) => {
    reply([item]);
    await expect(generateNarraAudioScenario("Анна.", [])).rejects.toMatchObject({
      backendCode: "SCENE_AUDIO_TEXT_MISMATCH",
    });
  },
);

it("drops cached audio when correcting voice or text without mutating the original", () => {
  const original = [
    {
      type: "narration" as const,
      characterId: anna.id,
      speaker: "Анна",
      voice: "Ast",
      text: "Анна.",
      audioUri: "file:///wrong-voice.mp3",
    },
  ];
  const result = validateNarraSceneAudioSegments(original, "Анна.");
  expect(result[0]).toMatchObject({ voice: getNarratorVoice(), characterId: null });
  expect(result[0].audioUri).toBeUndefined();
  expect(original[0].audioUri).toBe("file:///wrong-voice.mp3");
  const spaced = [{ ...original[0], type: "speech" as const }];
  expect(validateNarraSceneAudioSegments(spaced, " Анна. ")[0].audioUri).toBeUndefined();
});

it("rejects corrupted cached text and exposes no source in the error", () => {
  const segments = [
    {
      type: "speech" as const,
      characterId: anna.id,
      speaker: "Анна",
      voice: "Ast",
      text: "PRIVATE_SOURCE_OTHER",
      audioUri: "file:///old.mp3",
    },
  ];
  let error: unknown;
  try {
    validateNarraSceneAudioSegments(segments, "PRIVATE_SOURCE");
  } catch (cause) {
    error = cause;
  }
  expect(error).toMatchObject({ backendCode: "SCENE_AUDIO_TEXT_MISMATCH" });
  expect(String(error) + JSON.stringify(error)).not.toContain("PRIVATE_SOURCE");
});
