import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-crypto", () => ({ randomUUID: vi.fn(() => "11111111-1111-4111-8111-111111111111") }));
vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ narraGatewayRequest: vi.fn() }));
vi.mock("./media", () => ({
  persistSceneImageBase64: vi.fn(async () => "file:///scene.png"),
  trackNarraMediaJob: vi.fn(async (_type, _origin, operation) => operation()),
}));
vi.mock("@/stores", () => ({
  useLibraryStore: {
    getState: () => ({
      books: [{
        id: "book-1",
        meta: {
          title: "Книга",
          author: "Автор",
          description: "Описание книги",
          subjects: ["фанфик"],
        },
      }],
    }),
  },
  useNarraStore: {
    getState: () => ({
      books: {
        "book-1": {
          scenes: {},
          genre: {
            primary: "fanfiction",
            secondary: [],
            confidence: 0.9,
            evidence: "жанр определён",
          },
        },
      },
    }),
  },
}));

import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { generateNarraSceneImage } from "./scene-image-openrouter";
import type { NarraCharacter } from "./types";

const hero: NarraCharacter = {
  id: "hero",
  name: "Герой",
  fullName: "Главный Герой",
  role: "главный герой",
  gender: "male",
  voice: "voice",
  traits: [],
  speechStyle: "",
  speechExamples: [],
  appearancePrompt: "высокий юноша",
  passport: {
    age: 20,
    gender: "male",
    build: "стройное телосложение",
    hair: "тёмные волосы",
    eyes: "серые глаза",
    face: "овальное лицо",
    outfit: "дорожный плащ",
  },
  unlockProgress: 0,
};

describe("backend scene generation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends structured facts without a provider key or model", async () => {
    vi.mocked(narraGatewayRequest)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        job_id: "job-1", status: "completed", image: "AQID", mime_type: "image/png",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(generateNarraSceneImage("book-1", "Глава", "Герой вошёл.", [hero]))
      .resolves.toBe("file:///scene.png");
    const first = vi.mocked(narraGatewayRequest).mock.calls[0];
    expect(first[0]).toBe("/v2/media/scene/jobs");
    const body = JSON.parse(String(first[1]?.body));
    expect(body).toMatchObject({
      book_title: "Книга",
      book_author: "Автор",
      book_description: "Описание книги",
      book_subjects: ["фанфик"],
      genre_id: "fanfiction",
      excerpt: "Герой вошёл.",
    });
    expect(body.characters[0].appearance).toContain("20 лет");
    expect(body.characters[0].appearance).toContain("дорожный плащ");
    expect(body).not.toHaveProperty("prompt");
    expect(body).not.toHaveProperty("model");
    expect(body).not.toHaveProperty("api_key");
  });
});
