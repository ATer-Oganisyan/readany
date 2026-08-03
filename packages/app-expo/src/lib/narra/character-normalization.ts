import { MAX_NARRA_CHARACTERS } from "./domain";
import type { NarraCharacter, NarraGender, NarraPassport } from "./types";

const MALE_VOICES = ["She", "Ast", "Gal", "Bez", "Ego", "Izv"];
const FEMALE_VOICES = ["Che", "Erm", "Ste", "Tso", "Chr"];

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI response contains no character JSON");
  return JSON.parse(source.slice(start, end + 1)) as Record<string, unknown>;
}

export function parseNarraStreamText(body: string): string {
  let output = "";
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data) as {
        text?: string;
        choices?: Array<{ delta?: { content?: string }; text?: string }>;
      };
      output += event.choices?.[0]?.delta?.content || event.choices?.[0]?.text || event.text || "";
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

function normalizePassport(raw: unknown, gender: NarraGender): NarraPassport | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const passport = raw as Record<string, unknown>;
  return {
    age: Math.max(1, Number(passport.age) || 30),
    gender,
    build: String(passport.build || "обычное телосложение"),
    hair: String(passport.hair || "тёмные волосы"),
    eyes: String(passport.eyes || "карие глаза"),
    face: String(passport.face || "выразительные черты"),
    outfit: String(passport.outfit || "одежда по эпохе книги"),
  };
}

export function normalizeCharacterAnalysisResponse(
  input: string | Record<string, unknown>,
): NarraCharacter[] {
  const payload = typeof input === "string" ? parseJsonObject(input) : input;
  const candidates = Array.isArray(payload.characters) ? payload.characters : [];
  let male = 0;
  let female = 0;
  return candidates.slice(0, MAX_NARRA_CHARACTERS).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Record<string, unknown>;
    const fullName = String(raw.fullName || raw.name || "").trim();
    if (!fullName) return [];
    const name = String(raw.name || fullName.split(/\s+/)[0]).trim();
    const gender = normalizeGender(raw.gender, name);
    const rawUnlock = Number(raw.unlockProgress);
    const unlockProgress = Math.min(
      0.95,
      Math.max(0, Number.isFinite(rawUnlock) ? rawUnlock : index * 0.08),
    );
    return [
      {
        id: slug(String(raw.id || name), index),
        name,
        fullName,
        role: String(raw.role || "Персонаж истории"),
        gender,
        voice:
          gender === "female"
            ? FEMALE_VOICES[female++ % FEMALE_VOICES.length]
            : MALE_VOICES[male++ % MALE_VOICES.length],
        traits: Array.isArray(raw.traits) ? raw.traits.slice(0, 5).map(String) : [],
        speechStyle: String(raw.speechStyle || ""),
        speechExamples: Array.isArray(raw.speechExamples)
          ? raw.speechExamples.slice(0, 3).map(String)
          : [],
        appearancePrompt: String(raw.appearancePrompt || ""),
        passport: normalizePassport(raw.passport, gender),
        expression: raw.expression ? String(raw.expression) : undefined,
        unlockProgress,
        greeting: raw.greeting ? String(raw.greeting) : `Привет. Я ${name}.`,
        isNarrator: Boolean(raw.isNarrator),
      },
    ];
  });
}
