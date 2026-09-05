import { setNarraGatewayAdapter } from "@/lib/ai/narra-gateway-fetch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateNarraAudioScenario, parseNarraAudioScenario } from "./scene-audio";
import type { NarraCharacter } from "./types";

vi.mock("expo-secure-store", () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn() }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "scenario-request" }));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
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
  const request = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    setNarraGatewayAdapter(request);
  });
  afterEach(() => {
    setNarraGatewayAdapter(null);
    vi.useRealTimers();
  });

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
    request.mockResolvedValueOnce(
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

    const [path, init] = request.mock.calls[0] ?? [];
    expect(path).toBe("/v2/ai/chat/complete");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      purpose: "structured_task",
      origin: "user",
    });
  });

  it.each(["headers", "body"])("bounds stalled %s and cancels its transport", async (stage) => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    request.mockImplementation(async () =>
      stage === "headers" ? new Promise(() => {}) : new Response(new ReadableStream({ cancel })),
    );
    const result = generateNarraAudioScenario("Окно открыто.", []).catch((error) => error);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await result).toMatchObject({ code: "TIMEOUT" });
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    if (stage === "body") expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Stop aborts an incomplete body without waiting for timeout", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const cancel = vi.fn();
    request.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const result = generateNarraAudioScenario("Окно открыто.", [], {
      signal: controller.signal,
    }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects oversized streamed scenarios and cancels their remaining body", async () => {
    const cancel = vi.fn();
    request.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(256 * 1024 + 1));
          },
          cancel,
        }),
      ),
    );
    await expect(generateNarraAudioScenario("Окно открыто.", [])).rejects.toMatchObject({
      code: "SERVICE",
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });

  it("never exposes or consumes private provider-error text", async () => {
    const response = new Response("PRIVATE_BOOK_SENTINEL", { status: 503 });
    const text = vi.spyOn(response, "text");
    const reader = vi.spyOn(response.body!, "getReader");
    request.mockResolvedValue(response);
    const error = await generateNarraAudioScenario("Окно открыто.", []).catch((error) => error);
    expect(error).toMatchObject({ code: "SERVICE" });
    expect(String(error) + JSON.stringify(error)).not.toContain("PRIVATE_BOOK_SENTINEL");
    expect(text).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
  });
});
