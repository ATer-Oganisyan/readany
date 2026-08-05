import { beforeEach, describe, expect, it, vi } from "vitest";
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
import {
  buildSafetyFallbackSceneImagePrompt,
  buildSceneImagePrompt,
  generateSceneImage,
  normalizePersistedNarraMediaUri,
  synthesizeNarraSpeech,
} from "./media";

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

describe("scene image prompt", () => {
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
