import {
  bundledOpenRouterEndpoint,
  getBundledApiKey,
  hasBundledOpenRouterKey,
} from "@/config/bundled-ai";
import { fetch } from "expo/fetch";

const REQUEST_TIMEOUT_MS = 180_000;

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
      throw new Error(
        payload.error?.message || `OpenRouter image request failed (${response.status})`,
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
  } finally {
    clearTimeout(timeout);
  }
}
