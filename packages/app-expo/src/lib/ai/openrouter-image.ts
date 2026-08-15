import {
  bundledOpenRouterEndpoint,
  getBundledApiKey,
  hasBundledOpenRouterKey,
} from "@/config/bundled-ai";
import { fetch } from "expo/fetch";

export const OPENROUTER_PRIMARY_IMAGE_MODEL = "openai/gpt-image-2";
export const OPENROUTER_FALLBACK_IMAGE_MODEL = "google/gemini-3.1-flash-image";

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_REQUEST_ATTEMPTS = 2;
const RETRY_DELAYS_MS = [1_000] as const;
const MAX_RETRY_AFTER_MS = 15_000;

interface OpenRouterProviderError {
  message?: string;
  code?: string | number;
  metadata?: {
    error_type?: string;
    provider_name?: string;
  };
}

export class OpenRouterImageRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly model: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "OpenRouterImageRequestError";
  }
}

class OpenRouterImageResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterImageResponseError";
  }
}

class OpenRouterImageTimeoutError extends Error {
  constructor(readonly model: string) {
    super(`OpenRouter image request timed out for ${model}`);
    this.name = "OpenRouterImageTimeoutError";
  }
}

export class OpenRouterImageFallbackError extends Error {
  readonly attempts: ReadonlyArray<{ model: string; message: string }>;

  constructor(
    attempts: ReadonlyArray<{ model: string; cause: unknown }>,
    secrets: { apiKey: string; prompt: string },
  ) {
    const safeAttempts = attempts.map(({ model, cause }) => ({
      model,
      message: safeErrorSummary(cause, secrets),
    }));
    super(
      `OpenRouter image generation failed: ${safeAttempts
        .map(({ model, message }) => `${model}: ${message}`)
        .join("; ")}`,
    );
    this.name = "OpenRouterImageFallbackError";
    this.attempts = safeAttempts;
  }
}

export function isRetryableImageError(cause: unknown): boolean {
  if (cause instanceof OpenRouterImageRequestError) {
    return cause.status === 408 || cause.status === 429 || cause.status >= 500;
  }
  if (cause instanceof Error && cause.name === "AbortError") return false;
  return (
    cause instanceof TypeError ||
    (cause instanceof Error && /network|connection|fetch failed/iu.test(cause.message))
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const parsedMs = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(parsedMs) || parsedMs < 0) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.round(parsedMs));
}

function retryDelayMs(cause: unknown, attempt: number): number {
  if (cause instanceof OpenRouterImageRequestError && cause.retryAfterMs != null) {
    return cause.retryAfterMs;
  }
  return RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS.at(-1) ?? 0;
}

function safeErrorSummary(cause: unknown, secrets: { apiKey: string; prompt: string }): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  let redacted = raw;
  if (secrets.apiKey) redacted = redacted.replaceAll(secrets.apiKey, "[redacted]");
  if (secrets.prompt) redacted = redacted.replaceAll(secrets.prompt, "[prompt redacted]");
  return redacted
    .replace(/Bearer\s+[^\s]+/giu, "Bearer [redacted]")
    .replace(/sk-[a-z0-9_-]{12,}/giu, "[redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 300);
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
  maxAttempts?: number;
}

interface OpenRouterImageResponse {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  error?: OpenRouterProviderError;
}

function isGeminiImageModel(model: string): boolean {
  return model.startsWith("google/gemini-") && model.endsWith("-image");
}

function requestBody(request: OpenRouterImageRequest): Record<string, unknown> {
  const common = {
    model: request.model,
    prompt: request.prompt,
    aspect_ratio: request.aspectRatio,
    n: 1,
  };

  if (isGeminiImageModel(request.model)) {
    return {
      ...common,
      ...(request.model === OPENROUTER_FALLBACK_IMAGE_MODEL ? { resolution: "1K" } : {}),
      provider: { allow_fallbacks: true },
    };
  }

  return {
    ...common,
    quality: request.quality ?? "high",
    output_format: request.outputFormat,
    ...(request.outputCompression != null ? { output_compression: request.outputCompression } : {}),
  };
}

function normalizeImageBase64(value?: string): string {
  if (!value) throw new OpenRouterImageResponseError("OpenRouter image response is empty");
  const comma = value.startsWith("data:") ? value.indexOf(",") : -1;
  const normalized = (comma >= 0 ? value.slice(comma + 1) : value).replace(/\s+/gu, "");
  if (!normalized) throw new OpenRouterImageResponseError("OpenRouter image response is empty");
  return normalized;
}

function imageMimeType(
  originalValue: string,
  base64: string,
  declaredMediaType: string | undefined,
): string {
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("UklGR")) return "image/webp";

  const dataUrlMediaType = originalValue.match(/^data:(image\/[a-z0-9.+-]+)[;,]/iu)?.[1];
  const declared = declaredMediaType?.startsWith("image/") ? declaredMediaType : dataUrlMediaType;
  if (declared) return declared.toLowerCase();
  throw new OpenRouterImageResponseError("OpenRouter image response has unsupported image bytes");
}

async function requestImageOnce(
  request: OpenRouterImageRequest,
  apiKey: string,
  baseUrl: string,
): Promise<OpenRouterGeneratedImage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody(request)),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as OpenRouterImageResponse;
    if (!response.ok || payload.error) {
      throw new OpenRouterImageRequestError(
        payload.error?.message || `OpenRouter image request failed (${response.status})`,
        response.ok ? 502 : response.status,
        request.model,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }

    const image = payload.data?.[0];
    const originalValue = image?.b64_json ?? "";
    const base64 = normalizeImageBase64(originalValue);
    return {
      base64,
      mimeType: imageMimeType(originalValue, base64, image?.media_type),
    };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new OpenRouterImageTimeoutError(request.model);
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}

/** Единичная OpenRouter Images-модель с коротким повтором только для быстрых сетевых сбоев. */
export async function generateOpenRouterImage(
  request: OpenRouterImageRequest,
): Promise<OpenRouterGeneratedImage> {
  if (!hasBundledOpenRouterKey) {
    throw new Error("OpenRouter image generation is not configured");
  }

  const apiKey = getBundledApiKey(bundledOpenRouterEndpoint);
  const baseUrl = bundledOpenRouterEndpoint.baseUrl.replace(/\/+$/, "");
  const maxAttempts = Math.max(
    1,
    Math.min(MAX_REQUEST_ATTEMPTS, request.maxAttempts ?? MAX_REQUEST_ATTEMPTS),
  );
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await requestImageOnce(request, apiKey, baseUrl);
    } catch (cause) {
      lastError = cause;
      if (attempt === maxAttempts - 1 || !isRetryableImageError(cause)) throw cause;
      await wait(retryDelayMs(cause, attempt));
    }
  }

  throw lastError;
}

/** GPT Image 2, затем модель с другим провайдером; общий максимум ожидания — около 4 минут. */
export async function generateOpenRouterImageWithFallback(
  request: OpenRouterImageRequest,
  fallbackModel = OPENROUTER_FALLBACK_IMAGE_MODEL,
): Promise<OpenRouterGeneratedImage> {
  if (!hasBundledOpenRouterKey) {
    throw new Error("OpenRouter image generation is not configured");
  }

  const apiKey = getBundledApiKey(bundledOpenRouterEndpoint);
  let primaryError: unknown;
  try {
    return await generateOpenRouterImage({ ...request, maxAttempts: MAX_REQUEST_ATTEMPTS });
  } catch (cause) {
    primaryError = cause;
  }

  // Авторизация и баланс общие для всех моделей: повтор другим провайдером их не исправит.
  if (
    primaryError instanceof OpenRouterImageRequestError &&
    (primaryError.status === 401 || primaryError.status === 402)
  ) {
    throw primaryError;
  }

  if (fallbackModel === request.model) throw primaryError;

  try {
    return await generateOpenRouterImage({
      ...request,
      model: fallbackModel,
      maxAttempts: 1,
    });
  } catch (fallbackError) {
    throw new OpenRouterImageFallbackError(
      [
        { model: request.model, cause: primaryError },
        { model: fallbackModel, cause: fallbackError },
      ],
      { apiKey, prompt: request.prompt },
    );
  }
}
