/**
 * Разметка текста читалки по голосам для озвучки Narra (P7).
 *
 * Сегменты озвучки (предложения из foliate) делятся на реплики и нарратив:
 * - реплика — «тире-диалог» («— Пойдём.») или прямая речь в «ёлочках»;
 * - атрибуция реплики персонажу — простая эвристика без LLM: глагол речи рядом
 *   с именем в авторской ремарке («— …, — сказал Базаров»), затем ремарка в
 *   соседнем сегменте, затем ближайшее упомянутое имя в предыдущем нарративе;
 * - имена ищутся матчером P5 (character-name-matcher) — падежи и защита от
 *   неоднозначных фамилий уже там.
 *
 * Голос реплики — голос персонажа из assignVoices (voice-rules P2), ручное
 * переопределение voiceOverride приоритетнее. Нарратив и безымянные
 * эпизодники — голосом нарратора (правило 7 канона).
 *
 * Модуль также держит «активный план» — карту «текст сегмента → голос»,
 * которую читает TrackPlayerEdgeTTSPlayer при синтезе каждого чанка.
 */

import {
  type CharacterNameMatcherSpec,
  buildCharacterNameMatcherSpec,
  findCharacterNameMatches,
} from "./character-name-matcher";
import { primeCharacterStressForms } from "./stress-markup";
import type { NarraCharacter } from "./types";
import { type NarraProsody, VOICES } from "./voice-rules";

export interface SegmentVoiceAssignment {
  voice: string;
  prosody?: NarraProsody;
  characterId: string | null;
  kind: "speech" | "narration";
}

/** Тире, открывающие реплику или авторскую ремарку в диалоге. */
const DIALOGUE_DASH = "[—–―]";
/** Реплика: тире в начале + слово с заглавной буквы или открывающая кавычка. */
const DASH_SPEECH_RE = new RegExp(`^\\s*${DIALOGUE_DASH}\\s*[«"]?\\p{Lu}`, "u");
/** Ремарка: тире в начале + строчная буква («— сказал он, вставая.»). */
const DASH_NARRATION_RE = new RegExp(`^\\s*${DIALOGUE_DASH}\\s*\\p{Ll}`, "u");
/** Прямая речь в «ёлочках»: сегмент начинается с открывающей кавычки. */
const QUOTE_SPEECH_RE = /^\s*«[^»]/u;

/**
 * Основы русских глаголов речи для атрибуции реплик. Матчатся как
 * «основа + любое окончание» по границе слова.
 */
const SPEECH_VERB_STEMS: readonly string[] = [
  "сказа",
  "говори",
  "заговори",
  "спроси",
  "спрашива",
  "ответи",
  "отвеча",
  "воскликну",
  "восклица",
  "прошепта",
  "шепну",
  "шепта",
  "крикну",
  "закрича",
  "крича",
  "заора",
  "пробормота",
  "бормота",
  "произнес",
  "произнёс",
  "промолви",
  "молви",
  "добави",
  "продолжа",
  "продолжи",
  "возрази",
  "переби",
  "откликну",
  "отозва",
  "проговори",
  "буркну",
  "заяви",
  "вздохну",
  "усмехну",
  "хмыкну",
  "поинтересова",
  "подтверди",
  "согласи",
  "протяну",
  "броси",
  "заключи",
  "замети",
  "повтори",
  "прибави",
  "обрати",
  "перебива",
];

const SPEECH_VERB_RE = new RegExp(`(?:^|[^\\p{L}])(?:${SPEECH_VERB_STEMS.join("|")})\\p{L}*`, "iu");

/** Максимальное расстояние (в символах) между глаголом речи и именем. */
const VERB_NAME_MAX_DISTANCE = 48;
/** Сколько предыдущих сегментов смотрим при поиске ближайшего имени. */
const LOOKBACK_SEGMENTS = 3;
/** Ремарка в соседнем сегменте учитывается только в его начале. */
const NEIGHBOR_TAIL_WINDOW = 72;

export function classifySegmentKind(text: string): "speech" | "narration" {
  if (DASH_NARRATION_RE.test(text)) return "narration";
  if (DASH_SPEECH_RE.test(text)) return "speech";
  if (QUOTE_SPEECH_RE.test(text)) return "speech";
  return "narration";
}

/**
 * Зоны авторских ремарок внутри сегмента: хвост после закрывающей «ёлочки»
 * и куски после «, — …» со строчной буквы. Имя героя внутри самой реплики —
 * это обращение к собеседнику, спикером оно не считается.
 */
function attributionZones(text: string): Array<{ text: string; offset: number }> {
  const zones: Array<{ text: string; offset: number }> = [];
  const closingQuote = text.lastIndexOf("»");
  if (closingQuote >= 0 && closingQuote < text.length - 1) {
    zones.push({ text: text.slice(closingQuote + 1), offset: closingQuote + 1 });
  }
  const dashTail = new RegExp(`${DIALOGUE_DASH}\\s*(?=\\p{Ll})`, "gu");
  // Первое тире открывает саму реплику — ремарки начинаются со строчной буквы.
  for (const match of text.matchAll(dashTail)) {
    if (match.index == null || match.index === 0) continue;
    zones.push({ text: text.slice(match.index), offset: match.index });
  }
  return zones;
}

function findSpeakerInZone(zone: string, spec: CharacterNameMatcherSpec): string | null {
  const verbMatch = SPEECH_VERB_RE.exec(zone);
  if (!verbMatch) return null;
  const verbIndex = verbMatch.index;
  const names = findCharacterNameMatches(zone, spec);
  let best: { id: string; distance: number } | null = null;
  for (const name of names) {
    const distance = Math.min(Math.abs(name.start - verbIndex), Math.abs(verbIndex - name.end));
    if (distance > VERB_NAME_MAX_DISTANCE) continue;
    if (!best || distance < best.distance) {
      best = { id: name.characterId, distance };
    }
  }
  return best?.id ?? null;
}

/** Ближайшее (последнее по тексту) однозначное имя в сегменте. */
function lastMentionedCharacter(text: string, spec: CharacterNameMatcherSpec): string | null {
  const names = findCharacterNameMatches(text, spec);
  return names.length > 0 ? names[names.length - 1].characterId : null;
}

function voiceForCharacter(
  character: NarraCharacter | undefined,
  narratorVoice: string,
): { voice: string; prosody?: NarraProsody } {
  if (!character) return { voice: narratorVoice };
  const override =
    character.voiceOverride && VOICES[character.voiceOverride]
      ? character.voiceOverride
      : undefined;
  if (override) return { voice: override };
  if (!character.voice) return { voice: narratorVoice };
  return { voice: character.voice, prosody: character.voiceProsody };
}

/**
 * Размечает последовательность сегментов озвучки по голосам.
 * Порядок сегментов — порядок чтения: он нужен для атрибуции по соседям.
 */
export function markupVoiceSegments(
  texts: readonly string[],
  characters: readonly NarraCharacter[],
  narratorVoice: string,
): SegmentVoiceAssignment[] {
  const spec =
    characters.length > 0
      ? buildCharacterNameMatcherSpec(
          characters.map((character) => ({
            id: character.id,
            name: character.name,
            fullName: character.fullName,
          })),
        )
      : null;
  const byId = new Map(characters.map((character) => [character.id, character]));

  return texts.map((text, index) => {
    const kind = classifySegmentKind(text);
    if (kind === "narration" || !spec) {
      return { voice: narratorVoice, characterId: null, kind } as SegmentVoiceAssignment;
    }

    let speakerId: string | null = null;

    // 1. Авторская ремарка внутри сегмента: «— …, — сказал Базаров».
    for (const zone of attributionZones(text)) {
      speakerId = findSpeakerInZone(zone.text, spec);
      if (speakerId) break;
    }

    // 2. Ремарка в начале следующего сегмента: «— Ты готов?» + «— спросил Аркадий.»
    if (!speakerId) {
      const next = texts[index + 1];
      if (next && classifySegmentKind(next) === "narration") {
        speakerId = findSpeakerInZone(next.slice(0, NEIGHBOR_TAIL_WINDOW), spec);
      }
    }

    // 3. Ближайшее упомянутое имя в предыдущем нарративе.
    if (!speakerId) {
      for (let back = index - 1; back >= Math.max(0, index - LOOKBACK_SEGMENTS); back -= 1) {
        const previous = texts[back];
        if (classifySegmentKind(previous) !== "narration") continue;
        speakerId = lastMentionedCharacter(previous, spec);
        if (speakerId) break;
      }
    }

    // Безымянная реплика — голосом нарратора (правило 7).
    const { voice, prosody } = voiceForCharacter(
      speakerId ? byId.get(speakerId) : undefined,
      narratorVoice,
    );
    return { voice, prosody, characterId: speakerId, kind };
  });
}

// ─── Активный план озвучки (читается edge-плеером при синтезе чанков) ────────

export interface ChunkVoiceAssignment {
  voice: string;
  prosody?: NarraProsody;
}

const PLAN_LIMIT = 4000;

let activeVoicePlan = new Map<string, ChunkVoiceAssignment>();
let activeVoiceSequence: ChunkVoiceAssignment[] = [];

function planKey(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Пересобирает (или дополняет при append) активный план голосов для очереди
 * озвучки. Тексты должны совпадать с сегментами, уходящими в TTS-плеер.
 */
export function primeReaderVoicePlan(
  texts: readonly string[],
  characters: readonly NarraCharacter[],
  narratorVoice: string,
  options?: { append?: boolean },
): void {
  // Заодно активируем словарь ударений имён этой книги (P9) — его читает
  // synthesizeNarraSpeech при синтезе каждого чанка.
  primeCharacterStressForms(characters);
  const assignments = markupVoiceSegments(texts, characters, narratorVoice);
  const next = options?.append ? activeVoicePlan : new Map<string, ChunkVoiceAssignment>();
  const nextSequence = options?.append ? activeVoiceSequence : [];
  assignments.forEach((assignment, index) => {
    const key = planKey(texts[index]);
    if (!key) return;
    const value = { voice: assignment.voice, prosody: assignment.prosody };
    next.set(key, value);
    nextSequence.push(value);
  });
  while (next.size > PLAN_LIMIT) {
    const oldest = next.keys().next().value;
    if (oldest == null) break;
    next.delete(oldest);
  }
  activeVoicePlan = next;
  activeVoiceSequence = nextSequence.slice(-PLAN_LIMIT);
}

export interface ReaderScriptVoiceSegment {
  text: string;
  ttsKind?: "speech" | "narration";
  ttsCharacterKey?: string | null;
}

function installReaderVoiceAssignments(
  texts: readonly string[],
  assignments: readonly ChunkVoiceAssignment[],
  append: boolean,
): void {
  const next = append ? activeVoicePlan : new Map<string, ChunkVoiceAssignment>();
  const nextSequence = append ? activeVoiceSequence : [];
  assignments.forEach((assignment, index) => {
    const key = planKey(texts[index]);
    if (!key) return;
    next.set(key, assignment);
    nextSequence.push(assignment);
  });
  while (next.size > PLAN_LIMIT) {
    const oldest = next.keys().next().value;
    if (oldest == null) break;
    next.delete(oldest);
  }
  activeVoicePlan = next;
  activeVoiceSequence = nextSequence.slice(-PLAN_LIMIT);
}

/** Installs the compatibility plan used while the server sidecar is unavailable. */
export function primeReaderNarratorPlan(
  texts: readonly string[],
  narratorVoice: string,
  options?: { append?: boolean },
): void {
  installReaderVoiceAssignments(
    texts,
    texts.map(() => ({ voice: narratorVoice })),
    options?.append === true,
  );
}

/** Installs voices from the canonical server TTS sidecar without local speaker guessing. */
export function primeReaderScriptVoicePlan(
  segments: readonly ReaderScriptVoiceSegment[],
  characters: readonly NarraCharacter[],
  narratorVoice: string,
  options?: { append?: boolean },
): void {
  primeCharacterStressForms(characters);
  const byKey = new Map(characters.map((character) => [character.id, character]));
  const assignments = segments.map((segment): ChunkVoiceAssignment => {
    if (segment.ttsKind !== "speech" || !segment.ttsCharacterKey) {
      return { voice: narratorVoice };
    }
    return voiceForCharacter(byKey.get(segment.ttsCharacterKey), narratorVoice);
  });
  installReaderVoiceAssignments(
    segments.map(({ text }) => text),
    assignments,
    options?.append === true,
  );
}

export function clearReaderVoicePlan(): void {
  activeVoicePlan = new Map();
  activeVoiceSequence = [];
}

/** Голос для чанка синтеза; null — чанк вне плана (фолбэк — нарратор). */
export function resolveReaderVoiceForChunk(
  text: string,
  queueIndex?: number,
): ChunkVoiceAssignment | null {
  if (
    Number.isSafeInteger(queueIndex) &&
    queueIndex != null &&
    queueIndex >= 0 &&
    queueIndex < activeVoiceSequence.length
  ) {
    return activeVoiceSequence[queueIndex] ?? null;
  }
  return activeVoicePlan.get(planKey(text)) ?? null;
}
