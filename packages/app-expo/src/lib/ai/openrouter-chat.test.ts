import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/bundled-ai", () => ({
  bundledOpenRouterEndpoint: { baseUrl: "https://openrouter.ai/api/v1", provider: "openrouter" },
  bundledOpenRouterModel: "google/test-chat-model",
  getBundledApiKey: vi.fn(() => "test-openrouter-key"),
  hasBundledOpenRouterKey: true,
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("expo/fetch", () => ({ fetch: fetchMock }));

import { completeOpenRouterChat } from "./openrouter-chat";

function response(payload: object, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
  });
}

describe("direct OpenRouter character chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends character messages directly to OpenRouter", async () => {
    fetchMock.mockResolvedValueOnce(
      response({ choices: [{ message: { content: "  Привет, читатель.  " } }] }),
    );

    await expect(
      completeOpenRouterChat({
        messages: [{ role: "user", content: "Привет" }],
        temperature: 0.85,
        maxTokens: 300,
      }),
    ).resolves.toBe("Привет, читатель.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-openrouter-key");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "google/test-chat-model",
      messages: [{ role: "user", content: "Привет" }],
      temperature: 0.85,
      max_tokens: 300,
      provider: { allow_fallbacks: true, data_collection: "deny", zdr: true },
    });
  });

  it("retries a temporary provider failure once", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ error: { message: "busy" } }, 503))
      .mockResolvedValueOnce(response({ choices: [{ message: { content: "Готово" } }] }));

    await expect(
      completeOpenRouterChat({ messages: [{ role: "user", content: "Ответь" }] }),
    ).resolves.toBe("Готово");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports an invalid bundled key without leaking it", async () => {
    fetchMock.mockResolvedValueOnce(
      response({ error: { message: "invalid test-openrouter-key" } }, 401),
    );

    const result = completeOpenRouterChat({
      messages: [{ role: "user", content: "Привет" }],
    });
    await expect(result).rejects.toMatchObject({ code: "AUTH" });
    await expect(result).rejects.not.toThrow(/test-openrouter-key/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts OpenRouter text content parts", async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        choices: [{ message: { content: [{ type: "text", text: "Первая" }, { text: " часть" }] } }],
      }),
    );

    await expect(
      completeOpenRouterChat({ messages: [{ role: "user", content: "Продолжай" }] }),
    ).resolves.toBe("Первая часть");
  });
});
