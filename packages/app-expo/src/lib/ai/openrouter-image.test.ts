import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/bundled-ai", () => ({
  bundledOpenRouterEndpoint: { baseUrl: "https://openrouter.ai/api/v1" },
  getBundledApiKey: vi.fn(() => "test-openrouter-key"),
  hasBundledOpenRouterKey: true,
}));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

import { fetch } from "expo/fetch";
import {
  OPENROUTER_FALLBACK_IMAGE_MODEL,
  OPENROUTER_PRIMARY_IMAGE_MODEL,
  OpenRouterImageFallbackError,
  generateOpenRouterImage,
  generateOpenRouterImageWithFallback,
} from "./openrouter-image";

const request = {
  model: OPENROUTER_PRIMARY_IMAGE_MODEL,
  prompt: "secret book portrait prompt",
  aspectRatio: "3:4" as const,
  quality: "high" as const,
  outputFormat: "jpeg" as const,
  outputCompression: 88,
};

function response(payload: unknown, status = 200, headers?: Record<string, string>): never {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  }) as never;
}

function modelAt(index: number): string {
  const [, init] = vi.mocked(fetch).mock.calls[index] ?? [];
  return JSON.parse(String(init?.body)).model as string;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("generateOpenRouterImage", () => {
  it("returns GPT Image 2 output with the model-specific request body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      response({
        data: [{ b64_json: "data:image/jpeg;base64,/9j/AQID", media_type: "image/jpeg" }],
      }),
    );

    await expect(generateOpenRouterImage(request)).resolves.toEqual({
      base64: "/9j/AQID",
      mimeType: "image/jpeg",
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("https://openrouter.ai/api/v1/images");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: OPENROUTER_PRIMARY_IMAGE_MODEL,
      prompt: request.prompt,
      aspect_ratio: "3:4",
      n: 1,
      quality: "high",
      output_format: "jpeg",
      output_compression: 88,
    });
  });

  it("retries a quick transient failure and respects Retry-After", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        response({ error: { message: "temporarily unavailable" } }, 503, {
          "retry-after": "2",
        }),
      )
      .mockResolvedValueOnce(response({ data: [{ b64_json: "/9j/AQID" }] }));

    const result = generateOpenRouterImage(request);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({ base64: "/9j/AQID", mimeType: "image/jpeg" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("generateOpenRouterImageWithFallback", () => {
  it("falls back after a permanent GPT policy failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ error: { message: "content policy refusal" } }, 400))
      .mockResolvedValueOnce(response({ data: [{ b64_json: "iVBORw0KGgoNANO" }] }));

    await expect(generateOpenRouterImageWithFallback(request)).resolves.toEqual({
      base64: "iVBORw0KGgoNANO",
      mimeType: "image/png",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(modelAt(1)).toBe(OPENROUTER_FALLBACK_IMAGE_MODEL);
  });

  it("sends Nano Banana only the parameters it supports", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(response({ data: [{ b64_json: "iVBORw0KGgoNANO" }] }));

    await generateOpenRouterImageWithFallback(request);

    const [, init] = vi.mocked(fetch).mock.calls[1] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      model: OPENROUTER_FALLBACK_IMAGE_MODEL,
      prompt: request.prompt,
      aspect_ratio: "3:4",
      n: 1,
      resolution: "1K",
      provider: { allow_fallbacks: true },
    });
    expect(String(init?.body)).not.toContain("output_format");
    expect(String(init?.body)).not.toContain("output_compression");
  });

  it("moves directly to Nano Banana after a provider timeout", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(Object.assign(new Error("Aborted"), { name: "AbortError" }))
      .mockResolvedValueOnce(response({ data: [{ b64_json: "iVBORw0KGgoTIMEOUT" }] }));

    await expect(generateOpenRouterImageWithFallback(request)).resolves.toEqual({
      base64: "iVBORw0KGgoTIMEOUT",
      mimeType: "image/png",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([401, 402])("does not retry a shared account failure (%s)", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      response({ error: { message: "Shared account failure" } }, status),
    );

    await expect(generateOpenRouterImageWithFallback(request)).rejects.toThrow(
      "Shared account failure",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports both providers without exposing the embedded key or prompt", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        response({ error: { message: `invalid test-openrouter-key for ${request.prompt}` } }, 400),
      )
      .mockResolvedValueOnce(response({ error: { message: "fallback quota exhausted" } }, 400));

    const error = await generateOpenRouterImageWithFallback(request).catch((cause) => cause);
    expect(error).toBeInstanceOf(OpenRouterImageFallbackError);
    expect(String(error)).toContain(OPENROUTER_PRIMARY_IMAGE_MODEL);
    expect(String(error)).toContain(OPENROUTER_FALLBACK_IMAGE_MODEL);
    expect(String(error)).not.toContain("test-openrouter-key");
    expect(String(error)).not.toContain(request.prompt);
  });
});
