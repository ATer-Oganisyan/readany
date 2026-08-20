import { describe, expect, it } from "vitest";
import {
  GROK_FALLBACK_VOICE,
  GROK_VOICES,
  NARRA_VOICE_TO_GROK,
  resolveGrokVoice,
} from "./grok-voices";
import { VOICES } from "./voice-rules";

describe("grok voice catalog", () => {
  it("покрывает все коды озвучки Narra", () => {
    for (const code of Object.keys(VOICES)) {
      expect(NARRA_VOICE_TO_GROK[code], `нет маппинга для ${code}`).toBeDefined();
    }
  });

  it("не назначает один голос двум ролям", () => {
    const assigned = Object.values(NARRA_VOICE_TO_GROK);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("сохраняет пол при маппинге", () => {
    for (const [code, grokVoice] of Object.entries(NARRA_VOICE_TO_GROK)) {
      expect(GROK_VOICES[grokVoice], `${grokVoice} нет в каталоге`).toBeDefined();
      expect(GROK_VOICES[grokVoice].gender, `пол разошёлся у ${code}`).toBe(VOICES[code].gender);
    }
  });

  it("держит мужские и женские голоса в непересекающихся диапазонах тона", () => {
    const male = Object.values(GROK_VOICES).filter((v) => v.gender === "male");
    const female = Object.values(GROK_VOICES).filter((v) => v.gender === "female");
    expect(Math.max(...male.map((v) => v.pitchHz))).toBeLessThan(
      Math.min(...female.map((v) => v.pitchHz)),
    );
  });
});

describe("resolveGrokVoice", () => {
  it("возвращает базовый голос без просодии", () => {
    expect(resolveGrokVoice("Che")).toBe(NARRA_VOICE_TO_GROK.Che);
    expect(resolveGrokVoice("Ast", {})).toBe(NARRA_VOICE_TO_GROK.Ast);
  });

  it("подменяет голос вместо сдвига тона и сохраняет пол", () => {
    const resolved = resolveGrokVoice("Ast", { pitch: -2 });
    expect(resolved).not.toBe(NARRA_VOICE_TO_GROK.Ast);
    expect(GROK_VOICES[resolved].gender).toBe("male");

    const female = resolveGrokVoice("Ste", { pitch: 2 });
    expect(female).not.toBe(NARRA_VOICE_TO_GROK.Ste);
    expect(GROK_VOICES[female].gender).toBe("female");
  });

  it("детерминирован: один и тот же вариант даёт один и тот же голос", () => {
    expect(resolveGrokVoice("Gal", { pitch: 2, rate: 0.9 })).toBe(
      resolveGrokVoice("Gal", { pitch: 2, rate: 0.9 }),
    );
  });

  it("разводит разные варианты просодии по разным голосам", () => {
    const variants = [
      { pitch: -2 },
      { pitch: 2 },
      { rate: 0.9 },
      { rate: 1.1 },
      { pitch: -2, rate: 1.1 },
      { pitch: 2, rate: 0.9 },
    ];
    const resolved = variants.map((prosody) => resolveGrokVoice("Bez", prosody));
    // Мужской запасной пул из девяти голосов покрывает все шесть вариантов.
    expect(new Set(resolved).size).toBe(variants.length);
  });

  it("не падает на неизвестном коде", () => {
    expect(resolveGrokVoice("НетТакого")).toBe(GROK_FALLBACK_VOICE);
    expect(resolveGrokVoice("", { pitch: 2 })).toBe(GROK_FALLBACK_VOICE);
  });
});
