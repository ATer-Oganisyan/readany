import {
  bundledOpenRouterEndpoint,
  bundledOpenRouterModel,
  getBundledApiKey,
  hasBundledOpenRouterKey,
} from "@/config/bundled-ai";
import { fetch } from "expo/fetch";

import { NarraServiceError } from "../narra/errors";

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_REQUEST_ATTEMPTS = 2;
const MAX_RETRY_AFTER_MS = 10_000;

export interface OpenRouterChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterChatRequest {
  messages: OpenRouterChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

interface OpenRouterChatPayload {
  choices?: Array<{
    message?: {
      content?: OpenRouterChatContent;
    };
  }>;
  error?: {
    message?: string;
    code?: string | number;
  };
}

type OpenRouterChatContent = string | Array<{ type?: string; text?: string }>;

class OpenRouterChatHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "OpenRouterChatHttpError";
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const parsedMs = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(parsedMs) || parsedMs < 0) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.round(parsedMs));
}

function contentText(content: OpenRouterChatContent | undefined): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part?.type === "text" || part?.type == null ? (part?.text ?? "") : ""))
    .join("")
    .trim();
}

function safeProviderMessage(payload: OpenRouterChatPayload, apiKey: string): string {
  const raw = payload.error?.message || "OpenRouter request failed";
  return raw
    .replaceAll(apiKey, "[redacted]")
    .replace(/Bearer\s+[^\s]+/giu, "Bearer [redacted]")
    .replace(/sk-[a-z0-9_-]{12,}/giu, "[redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

function isRetryable(cause: unknown): boolean {
  if (cause instanceof OpenRouterChatHttpError) {
    return cause.status === 408 || cause.status === 429 || cause.status >= 500;
  }
  return (
    cause instanceof TypeError ||
    (cause instanceof Error && /network|connection|fetch failed/iu.test(cause.message))
  );
}

function asNarraServiceError(cause: unknown): NarraServiceError {
  if (cause instanceof NarraServiceError) return cause;
  if (cause instanceof OpenRouterChatHttpError) {
    if (cause.status === 401 || cause.status === 403) {
      return new NarraServiceError("AUTH", "OpenRouter отклонил ключ.");
    }
    if (cause.status === 429) {
      return new NarraServiceError("RATE", "Слишком много запросов. Попробуйте немного позже.");
    }
    return new NarraServiceError("SERVICE", "OpenRouter временно не отвечает.");
  }
  if (cause instanceof Error && cause.name === "AbortError") {
    return new NarraServiceError(
      "TIMEOUT",
      "OpenRouter отвечает дольше обычного. Попробуйте ещё раз.",
    );
  }
  return new NarraServiceError(
    "CONNECTION",
    "Не удалось связаться с OpenRouter. Проверьте подключение.",
  );
}

async function requestOnce(
  request: OpenRouterChatRequest,
  apiKey: string,
  baseUrl: string,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://narra.app",
        "X-Title": "Narra",
      },
      body: JSON.stringify({
        model: bundledOpenRouterModel,
        messages: request.messages,
        temperature: request.temperature ?? 0.8,
        max_tokens: Math.max(32, Math.min(2_000, request.maxTokens ?? 500)),
        provider: {
          allow_fallbacks: true,
          data_collection: "deny",
          zdr: true,
        },
      }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as OpenRouterChatPayload;
    if (!response.ok || payload.error) {
      throw new OpenRouterChatHttpError(
        safeProviderMessage(payload, apiKey),
        response.ok ? 502 : response.status,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }
    const content = contentText(payload.choices?.[0]?.message?.content);
    if (!content) {
      throw new OpenRouterChatHttpError("OpenRouter returned an empty response", 502);
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/** Direct character chat that never depends on Narra Gateway installation authorization. */
export async function completeOpenRouterChat(request: OpenRouterChatRequest): Promise<string> {
  if (!hasBundledOpenRouterKey) {
    throw new NarraServiceError("CONFIG", "OpenRouter не настроен в этой сборке.");
  }

  const apiKey = getBundledApiKey(bundledOpenRouterEndpoint);
  const baseUrl = bundledOpenRouterEndpoint.baseUrl.replace(/\/+$/, "");
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await requestOnce(request, apiKey, baseUrl);
    } catch (cause) {
      lastError = cause;
      if (attempt === MAX_REQUEST_ATTEMPTS - 1 || !isRetryable(cause)) {
        throw asNarraServiceError(cause);
      }
      const retryAfter = cause instanceof OpenRouterChatHttpError ? cause.retryAfterMs : undefined;
      await new Promise((resolve) => setTimeout(resolve, retryAfter ?? 750));
    }
  }

  throw asNarraServiceError(lastError);
}
