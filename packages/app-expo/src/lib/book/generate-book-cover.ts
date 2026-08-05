import { useSettingsStore } from "@/stores/settings-store";
import type { AIEndpoint } from "@readany/core/types";
import { providerRequiresApiKey } from "@readany/core/utils";
import { fetch } from "expo/fetch";
import { budgetPrompt } from "../narra/art-style";

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

export function coverPrompt(input: {
  title: string;
  author?: string;
  description?: string;
  excerpt?: string;
}) {
  return budgetPrompt([
    "Вертикальная обложка книги: единая иллюстрация занимает весь кадр.",
    "Не иллюстрируй название буквально: передай книгу через настроение, жесты, среду и детали. Композиция выразительная и читается в миниатюре.",
    "Без текста, надписей, рамок, макетов, корешков и водяных знаков — только сама иллюстрация.",
    `Книга: «${input.title}». Автор: ${input.author || "неизвестен"}.`,
    input.description ? `О книге: ${input.description.slice(0, MAX_CONTEXT_CHARS)}` : "",
    input.excerpt ? `Фрагмент: ${input.excerpt.slice(0, MAX_CONTEXT_CHARS)}` : "",
  ]);
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
