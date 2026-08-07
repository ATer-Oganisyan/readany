import { useSettingsStore } from "@/stores/settings-store";
import type { AIEndpoint } from "@readany/core/types";
import { providerRequiresApiKey } from "@readany/core/utils";
import { fetch } from "expo/fetch";
import coverGenerationConfig from "./cover-generation-config.json";
import { resolveCoverGenreProfile } from "./cover-genre";

const DEFAULT_IMAGE_MODEL = coverGenerationConfig.openRouterModel;
const MAX_THEME_CHARS = 800;
const REQUEST_TIMEOUT_MS = 180_000;
const COVER_PROMPT_TEMPLATE = coverGenerationConfig.promptParagraphs.join("\n\n");

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

export function coverPrompt(input: {
  title: string;
  author?: string;
  description?: string;
  excerpt?: string;
  subjects?: string[];
  metaphor?: string;
  imageType?: string;
  accentColor1?: string;
  accentColor2?: string;
}) {
  const title = input.title.trim() || "Untitled book";
  const author = input.author?.trim() || "Unknown author";
  const themeSource = input.description?.trim() || input.excerpt?.trim();
  const theme = themeSource
    ? themeSource.replace(/\s+/gu, " ").slice(0, MAX_THEME_CHARS)
    : "Infer the central idea, mood, symbols and historical context from the title and author without reproducing their names as text.";
  const genre = resolveCoverGenreProfile(input);

  const colorSeed = Array.from(`${title}:${author}`).reduce(
    (hash, character) => (hash * 31 + (character.codePointAt(0) || 0)) >>> 0,
    0,
  );
  const backgroundColor =
    input.accentColor1?.trim() ||
    coverGenerationConfig.backgroundColors[
      colorSeed % coverGenerationConfig.backgroundColors.length
    ];

  const replacements: Record<string, string> = {
    "{{BOOK_TITLE}}": title,
    "{{AUTHOR}}": author,
    "{{BOOK_DESCRIPTION}}": theme,
    "{{BOOK_GENRE}}": genre.label,
    "{{GENRE_ART_DIRECTION}}": genre.artDirection,
    "{{BACKGROUND_COLOR}}": backgroundColor,
  };

  return Object.entries(replacements).reduce(
    (prompt, [placeholder, value]) => prompt.replaceAll(placeholder, value),
    COVER_PROMPT_TEMPLATE,
  );
}

export async function generateBookCoverWithOpenRouter(input: {
  title: string;
  author?: string;
  description?: string;
  excerpt?: string;
  subjects?: string[];
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
        quality: "high",
        output_format: "jpeg",
        output_compression: 90,
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
