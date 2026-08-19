/**
 * Промпт сцены для OpenRouter-генерации (P16) — чистая сборка без сторов.
 *
 * Схема из 5 блоков: жанр/стиль → эпоха и мир книги → ДЕЙСТВИЕ момента →
 * паспорта упомянутых персонажей → контекст предыдущих сцен серии.
 * Жанр определяет resolveCoverGenreProfile (единые правила с обложками),
 * но арт-направление своё, сценное: не концепт обложки, а иллюстрация момента.
 *
 * Лимита Кандинского (950 знаков) здесь нет — целимся в ~2500 знаков,
 * при переполнении ужимаются отрывок сцены и контекст, но не паспорта.
 */

// Относительный импорт вместо алиаса: vitest резолвит без алиасов, а
// cover-genre чист от зависимостей — правила жанров едины с обложками.
import { resolveCoverGenreProfile } from "../book/cover-genre";
import { type NarraGenreAnalysis, narraGenreLabel } from "./genre-analysis";
import { RF_IMAGE_COMPLIANCE } from "./rf-compliance";
import type { NarraCharacter } from "./types";

/** Разумный потолок промпта сцены для GPT Image (не лимит провайдера). */
export const SCENE_PROMPT_CHAR_LIMIT = 2_500;

/** Максимум предыдущих сцен книги в блоке контекста серии. */
export const SCENE_CONTEXT_MAX_PREVIOUS = 2;

const MAX_EXCERPT_CHARS = 1_200;
const MAX_PREVIOUS_EXCERPT_CHARS = 180;

/**
 * Сценные арт-направления по id жанров из cover-genre.ts. В отличие от
 * artDirection обложек (концептуальный постер), здесь — язык иллюстрации
 * конкретного момента истории.
 */
export const SCENE_ART_DIRECTIONS: Record<string, string> = {
  classic:
    "Атмосферная живописная книжная иллюстрация: масляно-акварельная манера, глубокий естественный свет, воздух и фактура среды, живой уверенный мазок.",
  manga:
    "Аниме-кадр: кинематографичный кадр рисованного аниме-фильма 1990-х, решительные контуры, выразительная мимика, плоские тени, линии и смаз движения в кадре; без подражания конкретной студии.",
  fanfiction:
    "Живая полуреалистичная аниме-иллюстрация момента (semi-realistic anime): чистые линии, мягкая светотень, выразительные эмоции и жесты героев, кинематографичный ракурс; без копирования франшизного канона.",
  children:
    "Добрая детская книжная иллюстрация: яркие чистые цвета, простые тёплые формы, мягкий свет, юмор и движение, понятные силуэты.",
  poetry:
    "Лирическая импрессионистская иллюстрация: настроение и ритм важнее деталей, свободный мазок, недосказанность, тонкая палитра.",
  drama:
    "Театральный экспрессивный кадр: резкий боковой свет, крупные жесты, столкновение фигур в мизансцене, глубокие тени сцены.",
  "mystery-thriller":
    "Нуар-кадр: жёсткий контровой свет, глубокие тени, дождь или дым, напряжённая асимметричная композиция, ощущение слежки и тревоги.",
  "science-fiction":
    "Кинематографичный научно-фантастический кадр: ретрофутуристическая техника, объёмный свет, масштаб машин и пространств, точная детализация.",
  adventure:
    "Динамичная приключенческая иллюстрация: экстремальная диагональная композиция, ветер, пыль и брызги, физика движения, яркий природный свет.",
  fantasy:
    "Эпичная фэнтези-иллюстрация момента: живописный магический свет, осязаемая фактура мира, мифическая атмосфера без франшизных клише.",
  horror:
    "Тревожный готический кадр: сумрак, зыбкий источник света, длинные тени, гнетущая атмосфера и предчувствие — без крови и шок-образов.",
  romance:
    "Чувственная живописная иллюстрация: тёплый мягкий свет, движение ткани и воздуха, близость и напряжение между героями без глянца.",
  "historical-fiction":
    "Историческая жанровая живопись: достоверная фактура эпохи, естественный свет, живая многофигурная мизансцена в движении.",
  "biography-memoir":
    "Документальная реалистичная иллюстрация: сдержанная палитра, достоверная среда и одежда, подсмотренный живой момент.",
  philosophy:
    "Метафоричная гравюрная иллюстрация: строгая композиция, символическое действие фигур, точная линия и штриховка.",
  "psychology-self-help":
    "Современная редакционная иллюстрация: ясная визуальная метафора действия, тёплая ограниченная палитра, чистые формы.",
  "business-economics":
    "Современная редакционная иллюстрация: динамичная сцена в рабочей среде, чистая графика, точный жест и взаимодействие людей.",
  "science-technology":
    "Научно-популярная иллюстрация: точная детализация приборов и процессов, наглядное действие, холодный ясный свет.",
  "history-politics":
    "Историческая репортажная иллюстрация: документальная достоверность, движение толпы, сильный жест, фактура газетной эпохи.",
  "literary-fiction":
    "Атмосферная живописная иллюстрация с психологическим напряжением: выразительные позы и взгляды между героями, плотный свет, фактура среды.",
};

/** Сценное арт-направление по id жанра; дефолт — живописная иллюстрация. */
export function sceneArtDirectionForGenre(genreId: string): string {
  return SCENE_ART_DIRECTIONS[genreId] ?? SCENE_ART_DIRECTIONS.classic;
}

/** Паспорт внешности дословно: appearancePrompt + поля паспорта (P16 = P6). */
export function passportDescription(character: NarraCharacter): string {
  const passport = character.passport;
  if (!passport) return character.appearancePrompt;
  return [
    character.appearancePrompt,
    `${passport.age} лет`,
    passport.build,
    passport.hair,
    passport.eyes,
    passport.face,
    passport.outfit,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Персонажи, упомянутые в отрывке по имени или полному имени. */
export function mentionedCharacters(
  excerpt: string,
  characters: NarraCharacter[],
): NarraCharacter[] {
  const normalizedExcerpt = excerpt.toLocaleLowerCase("ru");
  return characters.filter((character) =>
    [character.name, character.fullName]
      .filter((name) => name.trim().length > 1)
      .some((name) => normalizedExcerpt.includes(name.toLocaleLowerCase("ru"))),
  );
}

export interface ScenePromptInput {
  bookTitle: string;
  bookAuthor?: string;
  bookDescription?: string;
  bookSubjects?: string[];
  analyzedGenre?: NarraGenreAnalysis;
  chapter: string;
  excerpt: string;
  characters: NarraCharacter[];
  /** excerpt 1–2 предыдущих сцен этой книги (свежие первыми) для связной серии. */
  previousExcerpts?: string[];
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function capText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const slice = value.slice(0, maxLength - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace >= maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s,.;:!?…—-]+$/u, "")}…`;
}

function assemble(blocks: string[]): string {
  return blocks.filter(Boolean).join("\n\n");
}

/**
 * Собирает промпт сцены по схеме из 5 блоков. Без цензорных подмен текста:
 * отрывок передаётся как есть (искажающая нейтрализация — костыль Кандинского,
 * в OpenRouter-пути не применяется).
 */
export function buildScenePrompt(input: ScenePromptInput): string {
  const genre = input.analyzedGenre
    ? {
        id: input.analyzedGenre.primary,
        label: narraGenreLabel(input.analyzedGenre.primary),
      }
    : resolveCoverGenreProfile({
        subjects: input.bookSubjects,
        title: input.bookTitle,
        description: input.bookDescription,
        excerpt: input.excerpt,
      });

  const author = input.bookAuthor?.trim();
  const bookRef = `«${input.bookTitle.trim() || "Без названия"}»${author ? ` (${author})` : ""}`;
  const chapter = oneLine(input.chapter);

  const canon = mentionedCharacters(input.excerpt, input.characters)
    .map(
      (character) => `${character.fullName || character.name}: ${passportDescription(character)}`,
    )
    .map(oneLine)
    .join("; ");

  const previous = (input.previousExcerpts ?? [])
    .map(oneLine)
    .filter(Boolean)
    .slice(0, SCENE_CONTEXT_MAX_PREVIOUS)
    .map((excerpt) => capText(excerpt, MAX_PREVIOUS_EXCERPT_CHARS));

  const buildBlocks = (excerptLimit: number): string[] => [
    // 1. Жанр и стиль
    `ЖАНР И СТИЛЬ (${genre.label}): ${sceneArtDirectionForGenre(genre.id)}`,
    // 2. Эпоха и мир
    `ЭПОХА И МИР: сцена из книги ${bookRef}${chapter ? `, глава «${chapter}»` : ""}. Одежда, причёски, предметы, архитектура и антураж строго соответствуют эпохе и миру книги; без современных вещей, если мир книги не современный.`,
    // 3. Действие — главное требование
    `ДЕЙСТВИЕ — ГЛАВНОЕ: выдели из отрывка центральное событие (кто что делает) и изобрази ДЕЙСТВИЕ момента в движении, в разгаре жеста. Никаких статичных поз, никаких взглядов в камеру, никакого группового позирования: герои заняты происходящим, композиция динамичная. Отрывок сцены: ${capText(oneLine(input.excerpt), excerptLimit)}`,
    // 4. Персонажи
    canon
      ? `ПЕРСОНАЖИ: в кадре только герои, упомянутые в отрывке; внешность соблюдать дословно — ${canon}. Одежда из сцены важнее паспортной. Не добавляй отсутствующих героев и лишних людей.`
      : "ПЕРСОНАЖИ: только те, кто действует в отрывке. Не добавляй лишних людей.",
    // 5. Контекст серии
    previous.length
      ? `КОНТЕКСТ СЕРИИ — ранее в книге: ${previous.map((item) => `«${item}»`).join(" ")} Новая иллюстрация продолжает ту же серию: тот же художник, та же палитра и манера.`
      : "",
    // 6. Правовые рамки РФ: разрешает драму сюжета и любые пары книги, режет привнесённую политику.
    RF_IMAGE_COMPLIANCE,
    "Единое пространство и один момент времени, НЕ коллаж. Строго без текста, букв, цифр, надписей, логотипов и водяных знаков.",
  ];

  let prompt = assemble(buildBlocks(MAX_EXCERPT_CHARS));
  if (prompt.length > SCENE_PROMPT_CHAR_LIMIT) {
    const overflow = prompt.length - SCENE_PROMPT_CHAR_LIMIT;
    const excerptLimit = Math.max(300, MAX_EXCERPT_CHARS - overflow);
    prompt = assemble(buildBlocks(excerptLimit));
  }
  return prompt;
}
