import { consumeNarraGatewayResponse } from "@/lib/ai/narra-gateway-fetch";
import { readGatewayResponseBytes } from "@/lib/ai/narra-gateway-consumer";
import { useNarraStore } from "@/stores/narra-store";
import { NarraServiceError } from "./errors";
import { primeCharacterStressForms } from "./stress-markup";
import type { NarraCharacter, NarraSceneAudioSegment } from "./types";
import { narratorVoiceFor } from "./voice-rules";

const MAX_SCENE_TEXT_CHARS = 12_000;
const MAX_SCENE_SEGMENTS = 24;

function scenarioError(code = "SCENE_AUDIO_TEXT_MISMATCH"): NarraServiceError {
  return new NarraServiceError(
    "SERVICE",
    "Не удалось распределить голоса без изменения текста.",
    undefined,
    undefined,
    code,
  );
}

function validateSource(excerpt: string): void {
  if (typeof excerpt !== "string" || !excerpt.trim()) throw scenarioError();
  if (excerpt.length > MAX_SCENE_TEXT_CHARS)
    throw new NarraServiceError(
      "REQUEST",
      "Выберите более короткий фрагмент для озвучки.",
      undefined,
      undefined,
      "SCENE_AUDIO_TOO_LONG",
    );
}

/** Validate both fresh and cached scenarios. Only whitespace may be normalized by
 * the model; returned text always consists of contiguous original source ranges. */
export function validateNarraSceneAudioSegments(
  segments: NarraSceneAudioSegment[],
  excerpt: string,
): NarraSceneAudioSegment[] {
  validateSource(excerpt);
  if (!Array.isArray(segments) || !segments.length) throw scenarioError();
  if (segments.length > MAX_SCENE_SEGMENTS) throw scenarioError("SCENE_AUDIO_TOO_MANY_SEGMENTS");
  const result: NarraSceneAudioSegment[] = [];
  let cursor = 0;
  for (const segment of segments) {
    if (
      !segment ||
      typeof segment !== "object" ||
      !["narration", "speech"].includes(segment.type) ||
      typeof segment.text !== "string" ||
      !segment.text.trim() ||
      typeof segment.voice !== "string" ||
      !segment.voice.trim() ||
      typeof segment.speaker !== "string" ||
      !segment.speaker.trim() ||
      !(segment.characterId === null || typeof segment.characterId === "string") ||
      (segment.audioUri !== undefined &&
        (typeof segment.audioUri !== "string" || !segment.audioUri.trim()))
    )
      throw scenarioError();
    const start = cursor;
    while (cursor < excerpt.length && /\s/u.test(excerpt[cursor])) cursor++;
    const text = segment.text.trim();
    for (let index = 0; index < text.length; index++) {
      if (/\s/u.test(text[index])) {
        if (cursor >= excerpt.length || !/\s/u.test(excerpt[cursor])) throw scenarioError();
        while (index + 1 < text.length && /\s/u.test(text[index + 1])) index++;
        while (cursor < excerpt.length && /\s/u.test(excerpt[cursor])) cursor++;
      } else {
        if (excerpt[cursor] !== text[index]) throw scenarioError();
        cursor++;
      }
    }
    const normalized = { ...segment, text: excerpt.slice(start, cursor) };
    if (segment.type === "narration") {
      normalized.characterId = null;
      normalized.speaker = "Рассказчик";
      normalized.voice = getNarratorVoice();
    }
    result.push(normalized);
  }
  if (excerpt.slice(cursor).trim()) throw scenarioError();
  if (cursor < excerpt.length) {
    result[result.length - 1].text += excerpt.slice(cursor);
  }
  result.forEach((segment, index) => {
    if (segment.text !== segments[index].text || segment.voice !== segments[index].voice)
      delete segment.audioUri;
  });
  return result;
}

/** Голос нарратора — из настройки пользователя (м — Сбер, ж — Афина, дефолт женский). */
export function getNarratorVoice(): string {
  return narratorVoiceFor(useNarraStore.getState().narratorVoicePreference);
}

function normalizeCharacterKey(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, "");
}

function resolveCharacter(value: unknown, characters: NarraCharacter[]): NarraCharacter | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const key = normalizeCharacterKey(value);
  return (
    characters.find((character) =>
      [character.id, character.name, character.fullName].some(
        (candidate) => normalizeCharacterKey(candidate) === key,
      ),
    ) ?? null
  );
}

export function parseNarraAudioScenario(
  value: string,
  characters: NarraCharacter[],
): NarraSceneAudioSegment[] {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || value;
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start < 0 || end <= start) throw scenarioError();

  let raw: unknown;
  try {
    raw = JSON.parse(fenced.slice(start, end + 1));
  } catch {
    throw scenarioError();
  }
  if (!Array.isArray(raw) || !raw.length) throw scenarioError();
  if (raw.length > MAX_SCENE_SEGMENTS) throw scenarioError("SCENE_AUDIO_TOO_MANY_SEGMENTS");
  const narratorVoice = getNarratorVoice();
  return raw.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      !["speech", "narration"].includes(item.type) ||
      !(
        item.character === undefined ||
        item.character === null ||
        typeof item.character === "string"
      )
    )
      throw scenarioError();
    const character = item.type === "speech" ? resolveCharacter(item.character, characters) : null;
    return {
      type: item.type === "speech" ? "speech" : "narration",
      characterId: character?.id ?? null,
      speaker: character?.name ?? "Рассказчик",
      // Безымянные эпизодники и повествование — голос нарратора;
      // ручной выбор голоса в карточке героя приоритетнее автоназначения.
      voice: character?.voiceOverride || character?.voice || narratorVoice,
      text: String(item.text).trim(),
    };
  });
}

export async function generateNarraAudioScenario(
  excerpt: string,
  characters: NarraCharacter[],
  options: { signal?: AbortSignal } = {},
): Promise<NarraSceneAudioSegment[]> {
  validateSource(excerpt);
  // Словарь ударений имён книги (P9) — синтез сегментов сцены пойдёт через
  // synthesizeNarraSpeech, который читает активный словарь.
  primeCharacterStressForms(characters);
  const roster = characters.map((character) => `${character.id}: ${character.fullName}`).join("; ");
  return consumeNarraGatewayResponse(
    "/v2/ai/chat/complete",
    {
      method: "POST",
      signal: options.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: `Разбей фрагмент на сценарий аудиокниги, не более 24 сегментов. Верни только JSON-массив [{"type":"narration|speech","character":"id|null","text":"дословный текст"}]. Покрой весь исходный текст строго по порядку, включая знаки препинания и авторские ремарки. Ничего не пропускай, не переставляй, не дублируй и не добавляй. Для narration character всегда null. Используй только эти id персонажей: ${roster || "персонажи не определены"}.`,
          },
          { role: "user", content: excerpt },
        ],
        temperature: 0.15,
        purpose: "structured_task",
        origin: "user",
        analytics_tier: "essential",
      }),
    },
    async (response, scope) => {
      if (!response.ok) {
        // Provider errors can echo private excerpts; only expose a safe status.
        void response.body?.cancel().catch(() => {});
        throw new NarraServiceError(
          response.status === 401 || response.status === 403
            ? "AUTH"
            : response.status === 429
              ? "RATE"
              : "SERVICE",
          "Не удалось подготовить озвучку сцены.",
          undefined,
          `Scenario HTTP ${response.status}`,
        );
      }
      const body = new TextDecoder().decode(
        await readGatewayResponseBytes(response, scope, 256 * 1024),
      );
      let payload: unknown;
      let parsed = false;
      try {
        payload = JSON.parse(body);
        parsed = true;
      } catch {
        // Some gateway adapters return plain text for chat completions.
      }
      // A bare JSON scenario array is already the parser's input, not a chat
      // envelope. Fenced JSON similarly passes through unchanged.
      let candidate = body;
      if (parsed && !Array.isArray(payload)) {
        if (!payload || typeof payload !== "object") throw scenarioError();
        const envelope = payload as Record<string, unknown>;
        if (
          (envelope.text !== undefined && typeof envelope.text !== "string") ||
          (envelope.content !== undefined && typeof envelope.content !== "string")
        )
          throw scenarioError();
        candidate = (envelope.text || envelope.content || "") as string;
      }
      const scenarioText = candidate.trim();
      const segments = parseNarraAudioScenario(scenarioText, characters);
      return validateNarraSceneAudioSegments(segments, excerpt);
    },
  );
}
