import {
  bundledOpenRouterEndpoint,
  getBundledApiKey,
  hasBundledOpenRouterKey,
} from "@/config/bundled-ai";
import { fetch } from "expo/fetch";

const REQUEST_TIMEOUT_MS = 180_000;
const MAX_REQUEST_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [750, 2_000] as const;

class OpenRouterImageRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenRouterImageRequestError";
  }
}

function isRetryableImageError(cause: unknown): boolean {
  if (cause instanceof OpenRouterImageRequestError) {
    return cause.status === 408 || cause.status === 429 || cause.status >= 500;
  }
  return cause instanceof TypeError || (cause instanceof Error && cause.name === "AbortError");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface OpenRouterGeneratedImage {
  base64: string;
  mimeType: string;
}

export interface OpenRouterImageRequest {
  model: string;
  prompt: string;
  aspectRatio: "1:1" | "2:3" | "3:2" | "3:4";
  outputFormat: "jpeg" | "png";
  quality?: "high" | "medium" | "low";
  outputCompression?: number;
}

interface OpenRouterImageResponse {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  error?: { message?: string };
}

/** Единый клиент OpenRouter Images для обложек, портретов и сцен. */
export async function generateOpenRouterImage(
  request: OpenRouterImageRequest,
): Promise<OpenRouterGeneratedImage> {
  if (!hasBundledOpenRouterKey) {
    throw new Error("OpenRouter image generation is not configured");
  }

  const apiKey = getBundledApiKey(bundledOpenRouterEndpoint);
  const baseUrl = bundledOpenRouterEndpoint.baseUrl.replace(/\/+$/, "");
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${baseUrl}/images`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          aspect_ratio: request.aspectRatio,
          quality: request.quality ?? "high",
          output_format: request.outputFormat,
          ...(request.outputCompression != null
            ? { output_compression: request.outputCompression }
            : {}),
          n: 1,
        }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as OpenRouterImageResponse;
      if (!response.ok) {
        throw new OpenRouterImageRequestError(
          payload.error?.message || `OpenRouter image request failed (${response.status})`,
          response.status,
        );
      }

      const image = payload.data?.[0];
      if (!image?.b64_json) throw new Error("OpenRouter image response is empty");
      return {
        base64: image.b64_json.includes(",")
          ? image.b64_json.slice(image.b64_json.indexOf(",") + 1)
          : image.b64_json,
        mimeType: image.media_type || `image/${request.outputFormat}`,
      };
    } catch (cause) {
      lastError = cause;
      if (attempt === MAX_REQUEST_ATTEMPTS - 1 || !isRetryableImageError(cause)) throw cause;
      await wait(RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS.at(-1) ?? 0);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}
