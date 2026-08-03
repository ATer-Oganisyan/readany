import { describe, expect, it } from "vitest";
import {
  normalizeCharacterAnalysisResponse,
  parseNarraStreamText,
} from "./character-normalization";

describe("Narra analysis normalization", () => {
  it("normalizes fenced JSON and preserves an explicit zero unlockProgress", () => {
    const characters = normalizeCharacterAnalysisResponse(`Ответ:\n\`\`\`json
      {"characters":[
        {"name":"Пьер","fullName":"Пьер Безухов","gender":"male","unlockProgress":0.2},
        {"name":"Анна","gender":"female","unlockProgress":0,"traits":["смелая"]}
      ]}
    \`\`\``);

    expect(characters).toHaveLength(2);
    expect(characters[0]).toMatchObject({ id: "пьер", unlockProgress: 0.2, voice: "She" });
    expect(characters[1]).toMatchObject({ id: "анна", unlockProgress: 0, voice: "Che" });
  });

  it("drops invalid entries and clamps unlockProgress to Arsen's 0.95 ceiling", () => {
    const characters = normalizeCharacterAnalysisResponse({
      characters: [null, { name: "" }, { name: "Герой", unlockProgress: 8 }],
    });
    expect(characters).toHaveLength(1);
    expect(characters[0]?.unlockProgress).toBe(0.95);
  });

  it("joins OpenAI-compatible SSE chunks", () => {
    const text = parseNarraStreamText(
      'data: {"choices":[{"delta":{"content":"{\\"characters\\":"}}]}\n' +
        'data: {"choices":[{"delta":{"content":"[]}"}}]}\n' +
        "data: [DONE]",
    );
    expect(text).toBe('{"characters":[]}');
  });
});
