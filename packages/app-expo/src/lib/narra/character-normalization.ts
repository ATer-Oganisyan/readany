import { MAX_NARRA_CHARACTERS } from "./domain";
import type { NarraCharacter, NarraGender, NarraPassport } from "./types";
import { type AssignVoicesOptions, assignVoices } from "./voice-rules";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonFragments(text: string): unknown[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const sources = fenced ? [fenced, text] : [text];
  const parsed: unknown[] = [];

  for (const source of sources) {
    const trimmed = source.trim();
    if (!trimmed) continue;
    try {
      parsed.push(JSON.parse(trimmed));
      continue;
    } catch {
      // The model may wrap otherwise valid JSON in a short explanation.
    }

    for (let start = 0; start < source.length; start += 1) {
      const opening = source[start];
      if (opening !== "{" && opening !== "[") continue;
      const stack: string[] = [opening];
      let inString = false;
      let escaped = false;

      for (let end = start + 1; end < source.length; end += 1) {
        const character = source[end];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') {
          inString = true;
          continue;
        }
        if (character === "{" || character === "[") stack.push(character);
        else if (character === "}" || character === "]") {
          const expected = character === "}" ? "{" : "[";
          if (stack.at(-1) !== expected) break;
          stack.pop();
          if (stack.length > 0) continue;
          try {
            parsed.push(JSON.parse(source.slice(start, end + 1)));
          } catch {
            // Keep scanning for another complete JSON value.
          }
          start = end;
          break;
        }
      }
    }
  }

  return parsed;
}

function extractCharacterCandidates(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.characters)) return value.characters;
  if (isRecord(value.data) && Array.isArray(value.data.characters)) {
    return value.data.characters;
  }

  const firstChoice = Array.isArray(value.choices) ? value.choices[0] : undefined;
  if (isRecord(firstChoice)) {
    const message = isRecord(firstChoice.message) ? firstChoice.message : undefined;
    const content = typeof message?.content === "string" ? message.content : firstChoice.text;
    if (typeof content === "string") {
      for (const parsed of parseJsonFragments(content)) {
        const candidates = extractCharacterCandidates(parsed);
        if (candidates !== undefined) return candidates;
      }
    }
  }

  for (const content of [value.content, value.text]) {
    if (typeof content !== "string") continue;
    for (const parsed of parseJsonFragments(content)) {
      const candidates = extractCharacterCandidates(parsed);
      if (candidates !== undefined) return candidates;
    }
  }

  return undefined;
}

function parseCharacterCandidates(input: unknown): unknown[] {
  if (typeof input !== "string") return extractCharacterCandidates(input) ?? [];
  const parsed = parseJsonFragments(input);
  if (parsed.length === 0) throw new Error("AI response contains no character JSON");
  for (const value of parsed) {
    const candidates = extractCharacterCandidates(value);
    if (candidates !== undefined) return candidates;
  }

  // Providers can stop at their output-token limit after emitting complete
  // character objects but before closing the outer JSON array.
  return parsed.filter(
    (value) =>
      isRecord(value) && (typeof value.name === "string" || typeof value.fullName === "string"),
  );
}

function isMetadataEvent(event: Record<string, unknown>, eventName?: string): boolean {
  const type = typeof event.type === "string" ? event.type : "";
  return [eventName || "", type].some((value) =>
    /(^|[._-])(metadata|usage|ping)([._-]|$)/i.test(value),
  );
}

function getCompletionChunk(event: Record<string, unknown>, eventName?: string): string {
  if (isMetadataEvent(event, eventName)) return "";
  const firstChoice = Array.isArray(event.choices) ? event.choices[0] : undefined;
  if (isRecord(firstChoice)) {
    const choiceDelta = firstChoice.delta;
    if (typeof choiceDelta === "string") return choiceDelta;
    if (isRecord(choiceDelta) && typeof choiceDelta.content === "string") {
      return choiceDelta.content;
    }
    if (typeof firstChoice.text === "string") return firstChoice.text;
  }
  if (typeof event.text === "string") return event.text;
  if (typeof event.content === "string") return event.content;
  if (typeof event.delta === "string") return event.delta;
  if (isRecord(event.delta) && typeof event.delta.text === "string") return event.delta.text;
  return "";
}

export function parseNarraStreamText(body: string): string {
  let output = "";
  let eventName: string | undefined;
  for (const line of body.split(/\r?\n/)) {
    if (!line) {
      eventName = undefined;
      continue;
    }
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data) as unknown;
      if (isRecord(event)) output += getCompletionChunk(event, eventName);
    } catch {
      // Provider comments and metadata are not completion chunks.
    }
  }
  return output;
}

function slug(value: string, index: number): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
  return normalized || `character-${index + 1}`;
}

function normalizeGender(value: unknown, name: string): NarraGender {
  if (value === "female" || value === "male") return value;
  return /[ая]$/i.test(name) ? "female" : "male";
}

/**
 * Модель отвечает «не указано» для признаков, которых нет в отрывке. В промпт
 * портрета такое значение попадать не должно — подставляем нейтральный дефолт.
 */
const UNKNOWN_PASSPORT_VALUE = /^(не\s*указан[оаы]?|неизвестн[оаы]|нет\s*данных|н\/д|—|-|\?)$/i;

function passportField(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return !text || UNKNOWN_PASSPORT_VALUE.test(text) ? fallback : text;
}

function normalizePassport(raw: unknown, gender: NarraGender): NarraPassport | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const passport = raw as Record<string, unknown>;
  return {
    age: Math.max(1, Number(passport.age) || 30),
    gender,
    build: passportField(passport.build, "обычное телосложение"),
    hair: passportField(passport.hair, "тёмные волосы"),
    eyes: passportField(passport.eyes, "карие глаза"),
    face: passportField(passport.face, "выразительные черты"),
    outfit: passportField(passport.outfit, "одежда по эпохе книги"),
  };
}

/**
 * Порог открытия героя: доля книги (unlockFraction / legacy unlockProgress),
 * а без неё — глава первого появления. Лояльный парсинг («глава 3», "3"),
 * дефолт 0 — сомнительные данные не должны запирать героя.
 */
function parseUnlockThreshold(
  raw: Record<string, unknown>,
  totalChapters?: number,
): { unlockProgress: number; appearanceChapter?: number } {
  const chapterNumber = Number(String(raw.appearanceChapter ?? "").replace(/[^\d.]/g, ""));
  const appearanceChapter =
    Number.isFinite(chapterNumber) && chapterNumber >= 1 ? Math.round(chapterNumber) : undefined;
  for (const value of [raw.unlockFraction, raw.unlockProgress]) {
    const fraction = Number(value);
    if (Number.isFinite(fraction) && fraction > 0) {
      return { unlockProgress: Math.min(0.95, fraction), appearanceChapter };
    }
    if (fraction === 0) return { unlockProgress: 0, appearanceChapter };
  }
  if (appearanceChapter === undefined || appearanceChapter <= 1) {
    return { unlockProgress: 0, appearanceChapter };
  }
  // Глава → доля книги: делим на известное число глав; когда оно неизвестно,
  // берём консервативные 12 глав, чтобы поздние герои всё же запирались.
  const denominator = Math.max(totalChapters ?? 12, appearanceChapter);
  return {
    unlockProgress: Math.min(0.95, (appearanceChapter - 1) / denominator),
    appearanceChapter,
  };
}

export interface NormalizeCharacterOptions extends AssignVoicesOptions {
  /** Число глав книги — для перевода appearanceChapter в долю unlockProgress. */
  totalChapters?: number;
}

export function normalizeCharacterAnalysisResponse(
  input: unknown,
  options: NormalizeCharacterOptions = {},
): NarraCharacter[] {
  const { totalChapters, ...voiceOptions } = options;
  const candidates = parseCharacterCandidates(input);
  const characters = candidates.slice(0, MAX_NARRA_CHARACTERS).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Record<string, unknown>;
    const fullName = String(raw.fullName || raw.name || "").trim();
    if (!fullName) return [];
    const name = String(raw.name || fullName.split(/\s+/)[0]).trim();
    // Ударение имени для озвучки (P9): поле опциональное, валидация формы —
    // в stress-markup при построении словаря.
    const stressedName = typeof raw.stressedName === "string" ? raw.stressedName.trim() : "";
    const gender = normalizeGender(raw.gender, name);
    const { unlockProgress, appearanceChapter } = parseUnlockThreshold(raw, totalChapters);
    return [
      {
        id: slug(String(raw.id || name), index),
        name,
        fullName,
        stressedName: stressedName && stressedName !== "null" ? stressedName : undefined,
        role: String(raw.role || "Персонаж истории"),
        gender,
        voice: "",
        traits: Array.isArray(raw.traits) ? raw.traits.slice(0, 5).map(String) : [],
        speechStyle: String(raw.speechStyle || ""),
        speechExamples: Array.isArray(raw.speechExamples)
          ? raw.speechExamples.slice(0, 3).map(String)
          : [],
        appearancePrompt: String(raw.appearancePrompt || ""),
        passport: normalizePassport(raw.passport, gender),
        expression: raw.expression ? String(raw.expression) : undefined,
        unlockProgress,
        appearanceChapter,
        // Без шаблонного фолбэка: нет своего приветствия — первое сообщение
        // сгенерирует чат в характере героя (NarraCharacterChatScreen).
        greeting:
          typeof raw.greeting === "string" && raw.greeting.trim() ? raw.greeting.trim() : undefined,
        isNarrator: Boolean(raw.isNarrator),
      },
    ];
  });
  if (characters.length > 0 && !characters.some((character) => character.unlockProgress === 0)) {
    const earliestIndex = characters.reduce(
      (earliest, character, index) =>
        character.unlockProgress < characters[earliest].unlockProgress ? index : earliest,
      0,
    );
    characters[earliestIndex] = { ...characters[earliestIndex], unlockProgress: 0 };
  }
  // Порядок ответа анализа — уже посчитанный rank по убыванию значимости.
  const plan = assignVoices(
    characters.map((character, index) => ({
      id: character.id,
      gender: character.gender,
      rank: characters.length - index,
      isNarrator: character.isNarrator,
    })),
    voiceOptions,
  );
  return characters.map((character) => {
    const assignment = plan.assignments[character.id];
    return {
      ...character,
      voice: assignment?.voice ?? plan.narratorVoice,
      voiceProsody: assignment?.prosody,
    };
  });
}
