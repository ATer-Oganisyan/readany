import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/bundled-ai", () => ({
  bundledOpenRouterEndpoint: {
    baseUrl: "https://openrouter.ai/api/v1",
  },
  getBundledApiKey: vi.fn(() => "test-openrouter-key"),
  hasBundledOpenRouterKey: true,
}));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

import { fetch } from "expo/fetch";
import { generateOpenRouterImage } from "./openrouter-image";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateOpenRouterImage", () => {
  it("calls the dedicated Images API and normalizes its base64 response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ b64_json: "data:image/png;base64,AQID", media_type: "image/png" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ) as never,
    );

    await expect(
      generateOpenRouterImage({
        model: "openai/gpt-image-2",
        prompt: "book portrait",
        aspectRatio: "3:4",
        quality: "high",
        outputFormat: "png",
      }),
    ).resolves.toEqual({ base64: "AQID", mimeType: "image/png" });

    const [url, request] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("https://openrouter.ai/api/v1/images");
    expect(JSON.parse(String(request?.body))).toEqual({
      model: "openai/gpt-image-2",
      prompt: "book portrait",
      aspect_ratio: "3:4",
      quality: "high",
      output_format: "png",
      n: 1,
    });
  });

  it("surfaces the provider error without hiding it behind the gateway", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "User not found." } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }) as never,
    );

    await expect(
      generateOpenRouterImage({
        model: "openai/gpt-image-2",
        prompt: "cover",
        aspectRatio: "2:3",
        outputFormat: "jpeg",
      }),
    ).rejects.toThrow("User not found.");
  });
});
