import { describe, expect, it } from "vitest";
import {
  normalizeCharacterAnalysisResponse,
  parseNarraStreamText,
} from "./character-normalization";

describe("Narra analysis normalization", () => {
  it("keeps complete characters when the outer JSON array is truncated", () => {
    const characters = normalizeCharacterAnalysisResponse(
      '{"characters":[{"id":"stiva","name":"Стива","fullName":"Степан Облонский","gender":"male"},{"id":"anna","name":"Анна","fullName":"Анна Каренина","gender":"female"},{"id":"cut',
    );

    expect(characters.map((character) => character.name)).toEqual(["Стива", "Анна"]);
  });

  it("normalizes fenced JSON and preserves an explicit zero unlockProgress", () => {
    const characters = normalizeCharacterAnalysisResponse(`Ответ:\n\`\`\`json
      {"characters":[
        {"name":"Пьер","fullName":"Пьер Безухов","gender":"male","unlockProgress":0.2},
        {"name":"Анна","gender":"female","unlockProgress":0,"traits":["смелая"]}
      ]}
    \`\`\``);

    expect(characters).toHaveLength(2);
    // Нарратор по умолчанию — Афина (Che); главный герой (Пьер, м) — Сбер (She);
    // Анна уходит в актёрский пул: первая женская — Стремпаржевская (Ste).
    expect(characters[0]).toMatchObject({ id: "пьер", unlockProgress: 0.2, voice: "She" });
    expect(characters[1]).toMatchObject({ id: "анна", unlockProgress: 0, voice: "Ste" });
  });

  it("сохраняет опциональный stressedName и не требует его (P9)", () => {
    const characters = normalizeCharacterAnalysisResponse(
      '{"characters":[{"name":"Одинцова","fullName":"Анна Одинцова","gender":"female","stressedName":"Одинцо\'ва"},{"name":"Фенечка","gender":"female"},{"name":"Пустой","gender":"male","stressedName":"null"}]}',
    );

    expect(characters[0].stressedName).toBe("Одинцо'ва");
    expect(characters[1].stressedName).toBeUndefined();
    expect(characters[2].stressedName).toBeUndefined();
  });

  it("drops invalid entries and clamps unlockProgress to Arsen's 0.95 ceiling", () => {
    const characters = normalizeCharacterAnalysisResponse({
      characters: [
        null,
        { name: "" },
        { name: "Герой", unlockProgress: 8 },
        { name: "Спутник", unlockProgress: 0.5 },
      ],
    });
    expect(characters).toHaveLength(2);
    expect(characters[0]?.unlockProgress).toBe(0.95);
    expect(characters[1]?.unlockProgress).toBe(0);
  });

  it("accepts a direct character array and unlocks the earliest valid character", () => {
    const characters = normalizeCharacterAnalysisResponse([
      { name: "Поздний герой", unlockProgress: 0.7 },
      { name: "Ранний герой", unlockProgress: 0.2 },
    ]);

    expect(characters.map(({ name, unlockProgress }) => ({ name, unlockProgress }))).toEqual([
      { name: "Поздний герой", unlockProgress: 0.7 },
      { name: "Ранний герой", unlockProgress: 0 },
    ]);
  });

  it("accepts characters nested under data", () => {
    const characters = normalizeCharacterAnalysisResponse({
      data: { characters: [{ name: "Героиня", gender: "female" }] },
    });

    expect(characters).toHaveLength(1);
    expect(characters[0]).toMatchObject({ name: "Героиня", unlockProgress: 0 });
  });

  it("unwraps a standard OpenAI non-SSE response", () => {
    const envelope = {
      choices: [
        {
          message: {
            content: '```json\n{"characters":[{"name":"Князь Мышкин","unlockProgress":0.4}]}\n```',
          },
        },
      ],
    };
    const characters = normalizeCharacterAnalysisResponse(envelope);
    const charactersFromBody = normalizeCharacterAnalysisResponse(JSON.stringify(envelope));

    expect(characters).toHaveLength(1);
    expect(characters[0]).toMatchObject({ fullName: "Князь Мышкин", unlockProgress: 0 });
    expect(charactersFromBody[0]).toMatchObject({ fullName: "Князь Мышкин", unlockProgress: 0 });
  });

  it("joins OpenAI-compatible SSE chunks", () => {
    const text = parseNarraStreamText(
      'data: {"choices":[{"delta":{"content":"{\\"characters\\":"}}]}\n' +
        'data: {"choices":[{"delta":{"content":"[]}"}}]}\n' +
        "data: [DONE]",
    );
    expect(text).toBe('{"characters":[]}');
  });

  it("joins all supported SSE completion shapes", () => {
    const text = parseNarraStreamText(
      [
        'data: {"choices":[{"delta":{"content":"A"}}]}',
        'data: {"choices":[{"text":"B"}]}',
        'data: {"text":"C"}',
        'data: {"content":"D"}',
        'data: {"delta":"E"}',
        'data: {"delta":{"text":"F"}}',
        "data: [DONE]",
      ].join("\n"),
    );

    expect(text).toBe("ABCDEF");
  });

  it("ignores SSE metadata even when it contains text-like fields", () => {
    const text = parseNarraStreamText(
      [
        "event: metadata",
        'data: {"text":"not completion text"}',
        "",
        'data: {"type":"response.metadata","content":"also metadata"}',
        'data: {"metadata":{"text":"nested metadata"},"request_id":"req_1"}',
        'data: {"delta":{"text":"completion"}}',
      ].join("\n"),
    );

    expect(text).toBe("completion");
  });
});
