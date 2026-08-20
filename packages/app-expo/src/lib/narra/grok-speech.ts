/**
 * Синтез речи через Grok TTS на OpenRouter (`POST /api/v1/audio/speech`).
 *
 * Заменяет путь через гейтвей (`/v2/speech/synthesize`, SaluteSpeech). Модуль
 * отвечает только за сеть и возвращает байты mp3 — запись в файл остаётся в
 * media.ts, где она общая для всех видов медиа.
 *
 * Проверено живыми запросами 2026-08-20:
 * - `speed` модель игнорирует (1.3 и 0.7 дают ту же длительность), pitch в API
 *   нет вообще — вся просодия разрешается подменой голоса в grok-voices.ts;
 * - SSML не озвучивается вслух, но и не применяется — теги просто вырезаются,
 *   поэтому на вход идёт чистый текст;
 * - inline-теги Grok (`[pause]`, `<whisper>…</whisper>`) работают;
 * - формат ответа mp3 24 кГц моно 128 кбит/с — TrackPlayer играет напрямую.
 */

import { getBundledApiKey, hasBundledOpenRouterKey } from "@/config/bundled-ai";
import { fetch } from "expo/fetch";
import { NarraServiceError } from "./errors";
import { resolveGrokVoice } from "./grok-voices";
import type { NarraProsody } from "./voice-rules";

export const GROK_TTS_MODEL = "x-ai/grok-voice-tts-1.0";
/** Формат ответа модели: mp3 24 кГц моно (замер, 2026-08-20). */
export const GROK_TTS_SAMPLE_RATE = 24_000;
const SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_REQUEST_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1_000;
/** Документированный предел Grok на один HTTP-запрос. */
export const GROK_TTS_MAX_INPUT_CHARS = 15_000;

export interface GrokSpeechOptions {
  prosody?: NarraProsody;
  signal?: AbortSignal;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Текст ошибки без ключа и без тела книги — оно попадает в логи. */
function safeDetail(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 200);
}

async function requestOnce(
  body: string,
  signal: AbortSignal | undefined,
  apiKey: string,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetch(SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = safeDetail(await response.text().catch(() => ""));
      throw new NarraServiceError(
        response.status === 401 || response.status === 403
          ? "AUTH"
          : response.status === 429
            ? "RATE"
            : isRetriableStatus(response.status)
              ? "SERVICE"
              : "REQUEST",
        "Не удалось озвучить фрагмент.",
        undefined,
        `Grok TTS ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new NarraServiceError(
        "SERVICE",
        "Не удалось озвучить фрагмент.",
        undefined,
        "Grok TTS returned an empty audio body",
      );
    }
    return bytes;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Озвучивает фрагмент голосом персонажа. `narraVoice` — код Narra (`Che`,
 * `Ast`, …), он переводится в голос Grok здесь же.
 */
export async function fetchGrokSpeechAudio(
  text: string,
  narraVoice: string,
  options: GrokSpeechOptions = {},
): Promise<Uint8Array> {
  if (!hasBundledOpenRouterKey) {
    throw new NarraServiceError(
      "CONFIG",
      "Озвучка не настроена в этой сборке.",
      undefined,
      "EXPO_PUBLIC_OPENROUTER_API_KEY is empty",
    );
  }

  const input = text.slice(0, GROK_TTS_MAX_INPUT_CHARS);
  const body = JSON.stringify({
    model: GROK_TTS_MODEL,
    input,
    voice: resolveGrokVoice(narraVoice, options.prosody),
    response_format: "mp3",
  });
  const apiKey = getBundledApiKey({ provider: "openrouter" });

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
    try {
      return await requestOnce(body, options.signal, apiKey);
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw error;
      const retriable =
        error instanceof NarraServiceError
          ? error.code === "SERVICE" || error.code === "RATE" || error.code === "TIMEOUT"
          : true;
      if (!retriable || attempt === MAX_REQUEST_ATTEMPTS) throw error;
      await delay(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}
