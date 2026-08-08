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

  it("keeps book-derived passport values and replaces unknown markers", () => {
    const [character] = normalizeCharacterAnalysisResponse(
      '{"characters":[{"name":"Наташа","fullName":"Наталья Ростова","gender":"female",' +
        '"appearancePrompt":"тринадцатилетняя девочка",' +
        '"passport":{"age":13,"build":"хрупкое","hair":"не указано","eyes":"—","face":"","outfit":"платье"}}]}',
    );

    expect(character.passport).toMatchObject({
      age: 13,
      build: "хрупкое",
      outfit: "платье",
      // Признаки, которых нет в тексте, не должны утекать в промпт портрета.
      hair: "тёмные волосы",
      eyes: "карие глаза",
      face: "выразительные черты",
    });
    expect(character.appearancePrompt).toBe("тринадцатилетняя девочка");
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

  it("берёт своё приветствие героя и не подставляет шаблон, когда его нет", () => {
    const characters = normalizeCharacterAnalysisResponse(
      '{"characters":[{"name":"Анна","gender":"female","greeting":"Вы тоже не любите поезда?"},{"name":"Вронский","gender":"male"},{"name":"Каренин","gender":"male","greeting":"  "}]}',
    );

    expect(characters[0].greeting).toBe("Вы тоже не любите поезда?");
    expect(characters[1].greeting).toBeUndefined();
    expect(characters[2].greeting).toBeUndefined();
  });

  it("выставляет пороги открытия из appearanceChapter: первая глава — 0, дальше по числу глав", () => {
    const characters = normalizeCharacterAnalysisResponse(
      '{"characters":[{"name":"Ранний","gender":"male","appearanceChapter":1},{"name":"Поздняя","gender":"female","appearanceChapter":11}]}',
      { totalChapters: 20 },
    );

    expect(characters[0]).toMatchObject({ unlockProgress: 0, appearanceChapter: 1 });
    expect(characters[1]).toMatchObject({ unlockProgress: 0.5, appearanceChapter: 11 });
  });

  it("предпочитает unlockFraction, но сохраняет appearanceChapter для заглушки", () => {
    const characters = normalizeCharacterAnalysisResponse(
      '{"characters":[{"name":"Первый","gender":"male","appearanceChapter":1},{"name":"Вторая","gender":"female","appearanceChapter":4,"unlockFraction":0.3}]}',
      { totalChapters: 30 },
    );

    expect(characters[1]).toMatchObject({ unlockProgress: 0.3, appearanceChapter: 4 });
  });

  it("лояльно парсит главу («глава 3») и по умолчанию оставляет героя открытым", () => {
    const characters = normalizeCharacterAnalysisResponse(
      '{"characters":[{"name":"Первый","gender":"male","appearanceChapter":1},{"name":"Расплывчатый","gender":"male","appearanceChapter":"глава 3"},{"name":"Без данных","gender":"female","appearanceChapter":"неизвестно"}]}',
    );

    // Без числа глав знаменатель — консервативные 12 глав
    expect(characters[1].unlockProgress).toBeCloseTo(2 / 12);
    expect(characters[1].appearanceChapter).toBe(3);
    expect(characters[2]).toMatchObject({ unlockProgress: 0, appearanceChapter: undefined });
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
