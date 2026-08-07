import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NarraCharacter } from "./types";

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  EncodingType: { Base64: "base64" },
  getInfoAsync: vi.fn(async () => ({ exists: true })),
  makeDirectoryAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
}));
vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ narraGatewayRequest: vi.fn() }));
vi.mock("@/lib/analytics/telemetry", () => ({ recordTelemetry: vi.fn() }));

import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import { ART_STYLE, PROMPT_CHAR_LIMIT } from "./art-style";
import {
  buildNarraSpeechSsml,
  buildSafetyFallbackSceneImagePrompt,
  buildSceneImagePrompt,
  generateBookCoverImage,
  generateSceneImage,
  normalizePersistedNarraMediaUri,
  portraitPrompt,
  synthesizeNarraSpeech,
} from "./media";
import { applyActiveStressMarkup, primeCharacterStressForms } from "./stress-markup";

beforeEach(() => {
  vi.clearAllMocks();
});

const anna: NarraCharacter = {
  id: "anna",
  name: "Анна",
  fullName: "Анна Каренина",
  role: "Главная героиня",
  gender: "female",
  voice: "Che",
  traits: ["искренняя"],
  speechStyle: "эмоциональная",
  speechExamples: [],
  appearancePrompt: "аристократичная женщина",
  passport: {
    age: 28,
    gender: "female",
    build: "стройная",
    hair: "тёмные волосы",
    eyes: "серые глаза",
    face: "овальное лицо",
    outfit: "чёрное платье XIX века",
  },
  unlockProgress: 0,
};

const vronsky: NarraCharacter = {
  ...anna,
  id: "vronsky",
  name: "Вронский",
  fullName: "Алексей Вронский",
  gender: "male",
  passport: {
    age: 30,
    gender: "male",
    build: "атлетичный",
    hair: "светлые волосы",
    eyes: "голубые глаза",
    face: "правильные черты",
    outfit: "мундир XIX века",
  },
};

describe("portrait prompt", () => {
  it("follows the narra canon and ends with the full art style", () => {
    const prompt = portraitPrompt(anna);

    expect(prompt).toContain("Погрудный портрет: голова и плечи, строго анфас");
    expect(prompt).toContain("Внешность (соблюдать точно):");
    expect(prompt).toContain("тёмные волосы");
    expect(prompt.endsWith(`Стиль: ${ART_STYLE}.`)).toBe(true);
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
  });

  it("demands exactly one named person first and keeps it within budget", () => {
    const prompt = portraitPrompt(vronsky);

    expect(prompt.startsWith("Ровно один человек в кадре — Алексей Вронский, никого больше")).toBe(
      true,
    );
    expect(prompt).toContain("без второстепенных персонажей");
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);

    const verbose: NarraCharacter = {
      ...vronsky,
      appearancePrompt: `статный офицер, ${"выразительные детали мундира и осанки, ".repeat(40)}`,
    };
    const longPrompt = portraitPrompt(verbose, "«Анна Каренина» (Лев Толстой)");
    expect(longPrompt).toContain("Ровно один человек в кадре — Алексей Вронский");
    expect(longPrompt.endsWith(`Стиль: ${ART_STYLE}.`)).toBe(true);
    expect(longPrompt.length).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
  });
});

describe("scene image prompt", () => {
  it("fits the Kandinsky budget with the full style on a long excerpt", () => {
    const excerpt = `Анна вошла в зал. ${"Свет свечей дрожал на паркете, гости расступались. ".repeat(60)}`;
    const prompt = buildSceneImagePrompt("Бал", excerpt, [anna, vronsky]);

    expect(prompt.length).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
    expect(prompt).toContain(ART_STYLE);
    expect(prompt.endsWith(`Стиль: ${ART_STYLE}.`)).toBe(true);
    expect(prompt).toContain("Анна Каренина");
  });

  it("adds passport canon only for characters mentioned in the excerpt", () => {
    const prompt = buildSceneImagePrompt("Бал", "Анна вошла в зал и остановилась у двери.", [
      anna,
      vronsky,
    ]);

    expect(prompt).toContain("Анна Каренина");
    expect(prompt).toContain("тёмные волосы");
    expect(prompt).not.toContain("Алексей Вронский");
    expect(prompt).toContain("Не добавляй отсутствующих героев");
  });

  it("routes square scene illustrations through Kandinsky", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "stop after request inspection" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(generateSceneImage("book-1", "Бал", "Анна вошла в зал.", [anna])).rejects.toThrow(
      "stop after request inspection",
    );

    const [, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      width: 1024,
      height: 1024,
      engine: "kandinsky",
    });
  });

  it("retries a safety rejection with a neutral visual prompt", async () => {
    vi.mocked(narraGatewayRequest)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "Kandinsky: запрос или результат отклонён политикой безопасности",
          }),
          { status: 422, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "fallback inspected" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      );

    const excerpt = [
      "— Мы должны продолжать борьбу!",
      "— Восстание откроет миру глаза.",
      "Ван поднял глаза. Мир стал черно-белым, и в зал вошла Е Вэньцзе.",
      "Окруженная спутниками, она остановилась посередине прохода.",
    ].join("\n");

    await expect(generateSceneImage("book-1", "Отступники", excerpt, [])).rejects.toThrow(
      "fallback inspected",
    );

    expect(narraGatewayRequest).toHaveBeenCalledTimes(2);
    const [, fallbackRequest] = vi.mocked(narraGatewayRequest).mock.calls[1] ?? [];
    const fallbackPrompt = JSON.parse(String(fallbackRequest?.body)).prompt as string;
    expect(fallbackPrompt).toContain("Ван поднял глаза");
    expect(fallbackPrompt).not.toContain("борьбу");
    expect(fallbackPrompt).not.toContain("Восстание");
  });

  it("builds a neutral fallback from narration while keeping character canon", () => {
    const prompt = buildSafetyFallbackSceneImagePrompt(
      "— Поднять восстание!\nАнна вошла в зал и спокойно остановилась у двери.",
      [anna],
    );

    expect(prompt).toContain("Анна Каренина");
    expect(prompt).toContain("Анна вошла в зал");
    expect(prompt).not.toContain("восстание");
    expect(prompt).toContain("Не добавляй отсутствующих героев и лишних людей");
  });
});

describe("book cover generation", () => {
  it("sends only the prompt to /v2/media/cover and records cover telemetry", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(JSON.stringify({ image: "aGVsbG8=", mime_type: "image/jpeg" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(generateBookCoverImage("front cover artwork")).resolves.toEqual({
      base64: "aGVsbG8=",
      mimeType: "image/jpeg",
    });

    const [path, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    expect(path).toBe("/v2/media/cover");
    expect(JSON.parse(String(request?.body))).toEqual({ prompt: "front cover artwork" });
    expect(recordTelemetry).toHaveBeenCalledWith(
      "media_job_enqueued",
      expect.objectContaining({
        job_type: "cover",
        provider: "openrouter",
        model: "gpt-image-2",
        origin: "background",
      }),
    );
    expect(recordTelemetry).toHaveBeenCalledWith(
      "media_job_completed",
      expect.objectContaining({ job_type: "cover", origin: "background" }),
    );
  });

  it("surfaces the gateway error text and reports a failed cover job", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Обложки: лимит на сегодня исчерпан", code: "RATE" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(generateBookCoverImage("front cover artwork")).rejects.toThrow(
      "Обложки: лимит на сегодня исчерпан",
    );

    expect(recordTelemetry).toHaveBeenCalledWith(
      "media_job_failed",
      expect.objectContaining({ job_type: "cover", origin: "background" }),
    );
  });
});

describe("persisted Narra media URI", () => {
  it("moves an iOS URI from an old app container into the current document directory", () => {
    expect(
      normalizePersistedNarraMediaUri(
        "file:///var/mobile/Containers/Data/Application/OLD/Documents/narra-media/book-hero.png",
      ),
    ).toBe("file:///documents/narra-media/book-hero.png");
  });

  it("leaves remote and unrelated local URIs untouched", () => {
    expect(normalizePersistedNarraMediaUri("https://cdn.example/hero.png")).toBe(
      "https://cdn.example/hero.png",
    );
    expect(normalizePersistedNarraMediaUri("file:///documents/covers/book.png")).toBe(
      "file:///documents/covers/book.png",
    );
  });
});

describe("speech SSML (просодия и скорость)", () => {
  it("returns null for default rate and pitch — plain text synthesis", () => {
    expect(buildNarraSpeechSsml("Привет.")).toBeNull();
    expect(buildNarraSpeechSsml("Привет.", {}, 1)).toBeNull();
  });

  it("multiplies user rate by character prosody and converts pitch to percent", () => {
    expect(buildNarraSpeechSsml("Привет.", { pitch: 2, rate: 0.9 }, 1.5)).toBe(
      '<speak><prosody rate="135%" pitch="+8%">Привет.</prosody></speak>',
    );
    expect(buildNarraSpeechSsml("Привет.", { pitch: -2 })).toBe(
      '<speak><prosody rate="100%" pitch="-8%">Привет.</prosody></speak>',
    );
  });

  it("clamps extreme values and escapes XML", () => {
    const ssml = buildNarraSpeechSsml('Он сказал: "меньше & лучше" <тихо>.', { pitch: 20 }, 3);
    expect(ssml).toContain('rate="200%"');
    expect(ssml).toContain('pitch="+40%"');
    expect(ssml).toContain("&quot;меньше &amp; лучше&quot; &lt;тихо&gt;");
  });

  it("экранирует апостроф-ударение как &apos;, не ломая теги", () => {
    const marked = applyActiveStressMarkup("Базаров звонит");
    expect(marked).toBe("База'ров звони'т");
    const ssml = buildNarraSpeechSsml(marked, { pitch: 2 });
    expect(ssml).toBe(
      '<speak><prosody rate="100%" pitch="+8%">База&apos;ров звони&apos;т</prosody></speak>',
    );
  });
});

describe("synthesizeNarraSpeech — разметка ударений (P9)", () => {
  afterEach(() => {
    primeCharacterStressForms([]);
  });

  it("применяет активный словарь к тексту запроса в /v2/speech/synthesize", async () => {
    primeCharacterStressForms([{ ...anna, stressedName: "А'нна" }]);
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "stop after request inspection" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(synthesizeNarraSpeech("Анна звонит Хлестакову.", "Che")).rejects.toThrow(
      "stop after request inspection",
    );

    const [path, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    expect(path).toBe("/v2/speech/synthesize");
    expect(JSON.parse(String(request?.body))).toEqual({
      text: "А'нна звони'т Хлестако'ву.",
      voice: "Che",
    });
  });
});

describe("speech telemetry", () => {
  it("records first-audio readiness from the gateway sample-rate contract", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "x-audio-sample-rate": "48000" },
      }),
    );

    await expect(synthesizeNarraSpeech("Привет", "Che")).resolves.toContain(
      "file:///documents/narra-media/speech-",
    );

    expect(recordTelemetry).toHaveBeenCalledWith(
      "tts_first_audio_ready",
      expect.objectContaining({ sample_rate: 48_000, origin: "user" }),
    );
  });
});
