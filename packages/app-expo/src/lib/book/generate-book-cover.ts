import { useSettingsStore } from "@/stores/settings-store";
import type { AIEndpoint } from "@readany/core/types";
import { providerRequiresApiKey } from "@readany/core/utils";
import { fetch } from "expo/fetch";

const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-lite-image";
const MAX_CONTEXT_CHARS = 3_000;
const REQUEST_TIMEOUT_MS = 90_000;

export interface GeneratedBookCover {
  bytes: Uint8Array;
  mimeType: string;
}

interface OpenRouterImageResponse {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  error?: { message?: string };
}

async function resolveConnectedOpenRouter(): Promise<AIEndpoint | null> {
  const state = useSettingsStore.getState();
  await state.loadApiKeys();
  const refreshed = useSettingsStore.getState();
  const config = refreshed.aiConfig;
  const endpoints = [...config.endpoints].sort(
    (a, b) => Number(b.id === config.activeEndpointId) - Number(a.id === config.activeEndpointId),
  );

  for (const endpoint of endpoints) {
    if (endpoint.provider !== "openrouter") continue;
    const hydrated = await refreshed.getEndpointById(endpoint.id);
    if (!hydrated) continue;
    if (providerRequiresApiKey(hydrated.provider) && !hydrated.apiKey) continue;
    return hydrated;
  }

  return null;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function coverPrompt(input: {
  title: string;
  author?: string;
  description?: string;
  excerpt?: string;
}) {
  return [
    "Create an original portrait-oriented painting for a book cover.",
    "Interpret the book through the visual language of late 19th- and 20th-century Eastern European figurative painting: psychological realism, intimate domestic scenes, restrained symbolism, social observation, monumental compositions, and atmospheric landscapes.",
    "Choose the type of painting that best matches the book: a psychologically charged portrait, an intimate genre scene, a symbolic still life, an atmospheric landscape, or a restrained multi-figure composition.",
    "The image must feel like a real painted canvas from a museum archive: visible brushwork, layered pigments, natural imperfections, complex muted colors, believable materials, and carefully observed light.",
    "Do not illustrate the title literally. Express the book through mood, gesture, spatial relationships, objects, environment, and subtle visual symbolism.",
    "Avoid fantasy art, digital illustration, glossy rendering, cinematic concept art, surreal AI imagery, neon colors, glowing objects, anatomical brains, generic smiling portraits, and decorative abstraction.",
    "The composition should be emotionally specific and slightly enigmatic. It may feel historical, but it must not reproduce an existing artwork or imitate one identifiable artist.",
    "Use an unusual crop suitable for a contemporary book cover. The painting should remain expressive and readable at thumbnail size.",
    "Do not render letters, words, typography, logos, frames, mockups, spines, badges, or watermarks. Generate only the flat painted artwork.",
    `Book title: ${input.title}`,
    `Author: ${input.author || "unknown"}`,
    input.description ? `Description: ${input.description.slice(0, MAX_CONTEXT_CHARS)}` : "",
    input.excerpt ? `Book excerpt: ${input.excerpt.slice(0, MAX_CONTEXT_CHARS)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateBookCoverWithOpenRouter(input: {
  title: string;
  author?: string;
  description?: string;
  excerpt?: string;
}): Promise<GeneratedBookCover | null> {
  const endpoint = await resolveConnectedOpenRouter();
  if (!endpoint?.apiKey) return null;

  const baseUrl = endpoint.baseUrl.replace(/\/+$/, "");
  const model = process.env.EXPO_PUBLIC_OPENROUTER_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${endpoint.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: coverPrompt(input),
        aspect_ratio: "2:3",
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
    if (!image?.b64_json) return null;
    return {
      bytes: decodeBase64(image.b64_json),
      mimeType: image.media_type || "image/png",
    };
  } finally {
    clearTimeout(timeout);
  }
}
