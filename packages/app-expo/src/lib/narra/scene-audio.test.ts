import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateNarraAudioScenario, parseNarraAudioScenario } from "./scene-audio";
import type { NarraCharacter } from "./types";

vi.mock("@/lib/ai/narra-gateway-fetch", () => ({ narraGatewayRequest: vi.fn() }));
vi.mock("@/stores/narra-store", () => ({
  useNarraStore: { getState: () => ({ narratorVoicePreference: "female" }) },
}));

const character: NarraCharacter = {
  id: "shi-qiang",
  name: "Ши Цян",
  fullName: "Ши Цян",
  role: "Следователь",
  gender: "male",
  voice: "Che",
  traits: ["прямолинейный"],
  speechStyle: "резкий",
  speechExamples: [],
  appearancePrompt: "",
  unlockProgress: 0,
};

describe("Narra scene audio", () => {
  beforeEach(() => vi.clearAllMocks());

  it("matches character names and uses the narrator for unknown speakers", () => {
    const segments = parseNarraAudioScenario(
      '```json\n[{"type":"speech","character":"Ши Цян","text":"Пойдём."},{"type":"narration","character":null,"text":"Они вышли."},{"type":"speech","character":"unknown","text":"Стойте."}]\n```',
      [character],
    );

    expect(segments).toEqual([
      expect.objectContaining({ characterId: "shi-qiang", speaker: "Ши Цян", voice: "Che" }),
      // Нарратор по настройке пользователя (женский дефолт — Афина).
      expect.objectContaining({ characterId: null, speaker: "Рассказчик", voice: "Che" }),
      expect.objectContaining({ characterId: null, speaker: "Рассказчик", voice: "Che" }),
    ]);
  });

  it("requests a verbatim structured scenario", async () => {
    vi.mocked(narraGatewayRequest).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          text: '[{"type":"speech","character":"shi-qiang","text":"Пойдём."}]',
        }),
        { status: 200 },
      ),
    );

    await expect(
      generateNarraAudioScenario("— Пойдём, — сказал Ши Цян.", [character]),
    ).resolves.toEqual([expect.objectContaining({ speaker: "Ши Цян", text: "Пойдём." })]);

    const [path, request] = vi.mocked(narraGatewayRequest).mock.calls[0] ?? [];
    expect(path).toBe("/v2/ai/chat/complete");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      purpose: "structured_task",
      origin: "user",
    });
  });
});
