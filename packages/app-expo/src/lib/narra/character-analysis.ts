import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { recordTelemetry } from "@/lib/analytics/telemetry";
import { useNarraStore } from "@/stores/narra-store";
import { getChunks } from "@readany/core/db/database";
import type { Book } from "@readany/core/types";
import { characterCountBucket, durationBucket } from "../analytics/contract";
import {
  normalizeCharacterAnalysisResponse,
  parseNarraStreamText,
} from "./character-normalization";
import { NarraServiceError, normalizeNarraError, reportNarraError } from "./errors";
import {
  NARRA_MOCK_CHARACTERS,
  NARRA_MOCK_CHARACTER_ID,
  createNarraMockMessages,
} from "./mock-characters";
import type { NarraCharacter } from "./types";

const MAX_ANALYSIS_TEXT_LENGTH = 48_000;

export type CharacterAnalysisTextFallback = string | (() => Promise<string>);

export function createAnalysisExcerpt(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= MAX_ANALYSIS_TEXT_LENGTH) return normalized;
  const sectionLength = Math.floor(MAX_ANALYSIS_TEXT_LENGTH / 3);
  const middleStart = Math.max(0, Math.floor(normalized.length / 2 - sectionLength / 2));
  return [
    normalized.slice(0, sectionLength),
    normalized.slice(middleStart, middleStart + sectionLength),
    normalized.slice(-sectionLength),
  ]
    .join("\n\n[…]\n\n")
    .slice(0, MAX_ANALYSIS_TEXT_LENGTH);
}

async function responseText(response: Response): Promise<string> {
  const body = await response.text();
  if (body.includes("data:")) return parseNarraStreamText(body);
  try {
    const payload = JSON.parse(body) as { text?: string; content?: string };
    return payload.text || payload.content || body;
  } catch {
    return body;
  }
}

export async function analyzeBookCharacters(
  book: Book,
  textFallback?: CharacterAnalysisTextFallback,
): Promise<NarraCharacter[]> {
  const startedAt = Date.now();
  const store = useNarraStore.getState();
  store.setAnalyzing(book.id);
  store.setAnalysisError(book.id);
  recordTelemetry("book_analysis_started", { analysis_version: "v1", origin: "user" });
  try {
    if (__DEV__ && process.env.EXPO_PUBLIC_NARRA_USE_MOCKS === "1") {
      store.setCharacters(book.id, NARRA_MOCK_CHARACTERS);
      const mockBook = useNarraStore.getState().books[book.id];
      if ((mockBook?.chats[NARRA_MOCK_CHARACTER_ID]?.length ?? 0) === 0) {
        for (const message of createNarraMockMessages()) {
          store.appendChatMessage(book.id, NARRA_MOCK_CHARACTER_ID, message);
        }
      }
      store.setMemory(
        book.id,
        NARRA_MOCK_CHARACTER_ID,
        "Читатель старается проверять необычные наблюдения и не торопится с выводами.",
      );
      recordTelemetry("book_analysis_completed", {
        analysis_version: "v1",
        character_count_bucket: characterCountBucket(NARRA_MOCK_CHARACTERS.length),
        duration_bucket: durationBucket(Date.now() - startedAt),
        pov: "unknown",
        confidence_bucket: "unknown",
        origin: "user",
      });
      return NARRA_MOCK_CHARACTERS;
    }
    const chunks = await getChunks(book.id);
    const chunkText = chunks
      .slice(0, 28)
      .map((chunk) => `${chunk.chapterTitle}\n${chunk.content}`.trim())
      .filter(Boolean)
      .join("\n\n");
    let fallbackText = "";
    if (!chunkText) {
      fallbackText =
        typeof textFallback === "function" ? await textFallback() : (textFallback ?? "");
    }
    const content = chunkText || fallbackText;
    const excerpt = createAnalysisExcerpt(content);
    if (!excerpt) throw new Error("No text could be extracted from the book");
    const response = await narraGatewayRequest("/v2/ai/chat/stream", {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "Ты анализируешь художественную книгу для Narra. Выдели до 6 главных персонажей. " +
              'Верни только JSON: {"characters":[{"id":"latin-slug","name":"короткое имя",' +
              '"fullName":"полное имя","role":"роль","gender":"male|female",' +
              '"traits":["до 3 коротких черт"],' +
              '"unlockProgress":0.0}]}. unlockProgress — примерная доля книги первого значимого появления от 0 до 0.95, не номер главы. Всё текстовое — по-русски.',
          },
          {
            role: "user",
            content: `Книга «${book.meta.title}», автор ${book.meta.author || "неизвестен"}.\n\n${excerpt}`,
          },
        ],
        temperature: 0.3,
        purpose: "structured_task",
        origin: "user",
        analytics_tier: "essential",
      }),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as {
        code?: string;
        error?: string;
        request_id?: string;
      } | null;
      const normalized = normalizeNarraError(
        error?.code || error?.error || `HTTP ${response.status}`,
      );
      throw new NarraServiceError(normalized.code, normalized.message, error?.request_id);
    }
    const rawAnalysis = await responseText(response);
    const characters = normalizeCharacterAnalysisResponse(rawAnalysis);
    if (characters.length === 0) {
      throw new Error(
        `Narra found no characters in the response: ${rawAnalysis.slice(0, 800) || "<empty>"}`,
      );
    }
    store.setCharacters(book.id, characters);
    recordTelemetry("book_analysis_completed", {
      analysis_version: "v1",
      character_count_bucket: characterCountBucket(characters.length),
      duration_bucket: durationBucket(Date.now() - startedAt),
      pov: "unknown",
      confidence_bucket: "unknown",
      origin: "user",
    });
    return characters;
  } catch (error) {
    const normalized = reportNarraError("character_analysis", error);
    const safeErrorCode = {
      AUTH: "AUTH",
      CONFIG: "NO_PROXY",
      CONNECTION: "NETWORK",
      RATE: "RATE",
      REQUEST: "VALIDATION",
      SERVICE: "UNKNOWN",
      TIMEOUT: "TIMEOUT",
    }[normalized.code];
    recordTelemetry("book_analysis_failed", {
      analysis_version: "v1",
      stage: "character_markup",
      safe_error_code: safeErrorCode,
      origin: "user",
    });
    store.setAnalysisError(book.id, normalized.message);
    throw normalized;
  } finally {
    store.setAnalyzing(null);
  }
}
