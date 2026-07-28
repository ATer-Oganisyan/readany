import { narraGatewayRequest } from "@/lib/ai/narra-gateway-fetch";
import { useNarraStore } from "@/stores/narra-store";
import { getChunks } from "@readany/core/db/database";
import type { Book } from "@readany/core/types";
import type { NarraCharacter, NarraGender, NarraPassport } from "./types";

const MALE_VOICES = ["She", "Ast", "Gal", "Bez", "Ego", "Izv"];
const FEMALE_VOICES = ["Che", "Erm", "Ste", "Tso", "Chr"];

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI не вернул описание персонажей");
  return JSON.parse(source.slice(start, end + 1)) as Record<string, unknown>;
}

function slug(value: string, index: number) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
  return normalized || `character-${index + 1}`;
}

function normalizePassport(raw: unknown, gender: NarraGender): NarraPassport | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  return {
    age: Math.max(1, Number(p.age) || 30),
    gender,
    build: String(p.build || "обычное телосложение"),
    hair: String(p.hair || "тёмные волосы"),
    eyes: String(p.eyes || "карие глаза"),
    face: String(p.face || "выразительные черты"),
    outfit: String(p.outfit || "одежда по эпохе книги"),
  };
}

function normalizeCharacters(payload: Record<string, unknown>): NarraCharacter[] {
  const input = Array.isArray(payload.characters) ? payload.characters : [];
  let male = 0;
  let female = 0;
  return input.slice(0, 8).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Record<string, unknown>;
    const fullName = String(raw.fullName || raw.name || "").trim();
    if (!fullName) return [];
    const name = String(raw.name || fullName.split(/\s+/)[0]).trim();
    const gender: NarraGender =
      raw.gender === "female" || /[ая]$/i.test(name) ? "female" : "male";
    const passport = normalizePassport(raw.passport, gender);
    const voice =
      gender === "female"
        ? FEMALE_VOICES[female++ % FEMALE_VOICES.length]
        : MALE_VOICES[male++ % MALE_VOICES.length];
    return [
      {
        id: slug(String(raw.id || name), index),
        name,
        fullName,
        role: String(raw.role || "Персонаж истории"),
        gender,
        voice,
        traits: Array.isArray(raw.traits) ? raw.traits.slice(0, 5).map(String) : [],
        speechStyle: String(raw.speechStyle || ""),
        speechExamples: Array.isArray(raw.speechExamples)
          ? raw.speechExamples.slice(0, 3).map(String)
          : [],
        appearancePrompt: String(raw.appearancePrompt || ""),
        passport,
        expression: raw.expression ? String(raw.expression) : undefined,
        unlockProgress: Math.min(0.95, Math.max(0, Number(raw.unlockProgress) || index * 0.08)),
        greeting: raw.greeting ? String(raw.greeting) : `Привет. Я ${name}.`,
        isNarrator: Boolean(raw.isNarrator),
      },
    ];
  });
}

export async function analyzeBookCharacters(book: Book): Promise<NarraCharacter[]> {
  const store = useNarraStore.getState();
  store.setAnalyzing(book.id);
  store.setAnalysisError(book.id);
  try {
    const chunks = await getChunks(book.id);
    if (chunks.length === 0) {
      throw new Error("Сначала проиндексируйте книгу, чтобы Narra могла найти персонажей");
    }
    const excerpt = chunks
      .slice(0, 28)
      .map((chunk) => `${chunk.chapterTitle}\n${chunk.content}`)
      .join("\n\n")
      .slice(0, 100_000);
    const messages = [
      {
        role: "system",
        content:
          "Ты анализируешь художественную книгу для Narra. Выдели до 8 главных персонажей. " +
          "Верни только JSON: {\"characters\":[{\"id\":\"latin-slug\",\"name\":\"короткое имя\"," +
          "\"fullName\":\"полное имя\",\"role\":\"роль\",\"gender\":\"male|female\"," +
          "\"traits\":[\"черта\"],\"speechStyle\":\"манера речи\",\"speechExamples\":[\"пример\"]," +
          "\"appearancePrompt\":\"внешность\",\"passport\":{\"age\":30,\"build\":\"\"," +
          "\"hair\":\"\",\"eyes\":\"\",\"face\":\"\",\"outfit\":\"\"},\"expression\":\"\"," +
          "\"unlockProgress\":0.0,\"greeting\":\"реплика от первого лица\",\"isNarrator\":false}]}. " +
          "unlockProgress — доля книги первого значимого появления от 0 до 0.95. Всё текстовое — по-русски.",
      },
      {
        role: "user",
        content: `Книга «${book.meta.title}», автор ${book.meta.author || "неизвестен"}.\n\n${excerpt}`,
      },
    ];
    const response = await narraGatewayRequest("/v2/ai/chat/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages,
        temperature: 0.3,
        purpose: "structured_task",
        origin: "user",
        analytics_tier: "essential",
      }),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(error?.error || `Ошибка AI (${response.status})`);
    }
    const result = (await response.json()) as { text?: string };
    const characters = normalizeCharacters(parseJsonObject(result.text || ""));
    if (characters.length === 0) throw new Error("Narra не нашла персонажей в книге");
    store.setCharacters(book.id, characters);
    return characters;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setAnalysisError(book.id, message);
    throw error;
  } finally {
    store.setAnalyzing(null);
  }
}
