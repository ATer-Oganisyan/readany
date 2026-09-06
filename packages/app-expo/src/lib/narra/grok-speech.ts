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
import {
  readGatewayResponseBytes,
  withGatewayConsumer,
  type GatewayConsumerScope,
} from "@/lib/ai/narra-gateway-consumer";
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

function delay(ms: number, scope: GatewayConsumerScope): Promise<void> {
  scope.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(scope.signal.reason);
    };
    const timer = setTimeout(() => {
      scope.signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    scope.signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function requestOnce(
  body: string,
  scope: GatewayConsumerScope,
  apiKey: string,
): Promise<Uint8Array> {
  scope.throwIfAborted();
  const pendingResponse = fetch(SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
    signal: scope.signal,
  }).then((response) => {
    if (scope.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      scope.throwIfAborted();
    }
    return response;
  });
  const response = await scope.wait(pendingResponse);

  if (!response.ok) {
    // Provider errors may echo credentials or book text. Never read/log them.
    void response.body?.cancel().catch(() => {});
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
      `Grok TTS HTTP ${response.status}`,
    );
  }

  const maxBytes = 16 * 1024 * 1024;
  const mime = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (
    mime &&
    !["audio/mpeg", "audio/mp3", "audio/x-mp3", "application/octet-stream"].includes(mime)
  ) {
    void response.body?.cancel().catch(() => {});
    throw new NarraServiceError("REQUEST", "Сервис вернул неподдерживаемый формат озвучки.");
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new NarraServiceError("REQUEST", "Ответ озвучки превышает допустимый размер.");
  }
  let bytes: Uint8Array;
  try {
    bytes = await readGatewayResponseBytes(response, scope, maxBytes);
  } catch {
    scope.throwIfAborted();
    // Headers already succeeded. Do not pay for another generation when its
    // body is oversized/broken; never expose native/provider body diagnostics.
    throw new NarraServiceError("REQUEST", "Не удалось загрузить звук.");
  }
  const id3 = bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const frame = bytes.length >= 4 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  if (!id3 && !frame) {
    throw new NarraServiceError(
      "REQUEST",
      "Не удалось озвучить фрагмент.",
      undefined,
      "Grok TTS returned invalid MP3 audio",
    );
  }
  return bytes;
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

  return withGatewayConsumer(
    async (scope) => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
        try {
          return await requestOnce(body, scope, apiKey);
        } catch (error) {
          lastError = error;
          scope.throwIfAborted();
          const retriable =
            error instanceof NarraServiceError
              ? error.code === "SERVICE" || error.code === "RATE" || error.code === "TIMEOUT"
              : true;
          if (!retriable || attempt === MAX_REQUEST_ATTEMPTS) throw error;
          await delay(RETRY_DELAY_MS, scope);
        }
      }
      throw lastError;
    },
    { signal: options.signal, timeoutMs: REQUEST_TIMEOUT_MS },
  );
}
