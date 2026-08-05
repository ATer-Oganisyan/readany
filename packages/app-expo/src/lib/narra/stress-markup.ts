/**
 * Слой разметки ударений перед синтезом речи (P9).
 *
 * Конвенция SaluteSpeech (проверена по документации): ударение обозначается
 * апострофом СРАЗУ ПОСЛЕ ударной гласной, только для русского языка.
 * Дока: https://developers.sber.ru/docs/ru/salutespeech/guides/synthesis/ssml/accents —
 * «после ударной буквы добавьте апостроф — '»; примеры из доки:
 * «за'мок» — ударение на «а», «замо'к» — ударение на «о».
 * Для полной замены произношения SaluteSpeech поддерживает и <sub alias="…">,
 * но апостроф не требует SSML: он работает и в plain-text ({text}), и внутри
 * текстовых узлов SSML ({ssml}) — при XML-экранировании превращается в
 * &apos; и корректно декодируется на стороне синтеза.
 *
 * Точка применения — synthesizeNarraSpeech (media.ts): через неё проходят все
 * чанки книги (edge-плеер), сегменты сцен и реплики чата. Активный словарь =
 * базовый (stress-dictionary.ts: имена bundled-каталога + частотные слова) +
 * словоформы имён персонажей текущей книги (stressedName из анализа глав),
 * см. primeCharacterStressForms.
 */

import { MIN_NAME_STEM_LENGTH, NAME_ENDINGS, stemNameToken } from "./character-name-matcher";
import { BASE_STRESS_ENTRIES, type StressDictionaryEntry } from "./stress-dictionary";
import type { NarraCharacter } from "./types";

/** «форма в нижнем регистре без апострофа» → «форма с апострофом-ударением». */
export type CompiledStressDictionary = ReadonlyMap<string, string>;

const RU_VOWELS = "аеёиоуыэюя";

/** Апострофы-варианты (типографский, комбинируемое ударение U+0301) приводим к «'». */
function normalizeApostrophes(value: string): string {
  return value.replace(/\u0301/g, "'").replace(/[’ʼ´`]/g, "'");
}

/**
 * Валидирует форму с ударением: ровно один апостроф, стоит сразу после
 * гласной, остальное — русские буквы. Возвращает null для мусора
 * (защита от галлюцинаций LLM в stressedName).
 */
export function parseStressedForm(value: string): { plain: string; stressed: string } | null {
  const stressed = normalizeApostrophes(value).toLowerCase();
  const apostrophe = stressed.indexOf("'");
  if (apostrophe <= 0 || stressed.indexOf("'", apostrophe + 1) !== -1) return null;
  if (!RU_VOWELS.includes(stressed[apostrophe - 1])) return null;
  const plain = stressed.slice(0, apostrophe) + stressed.slice(apostrophe + 1);
  if (!/^[а-яё]+$/.test(plain)) return null;
  return { plain, stressed };
}

/**
 * Падежные словоформы имени от базовой формы с известным ударением —
 * по образцу character-name-matcher: основа (срез финального гласного) +
 * допустимые русские окончания, ударение остаётся на той же гласной основы.
 * Если ударение попадает в срезаемое окончание («Пьеро'») или основа короче
 * MIN_NAME_STEM_LENGTH («Ки'ти»), генерации нет — только точная форма.
 */
export function stressedNameForms(stressedName: string): Map<string, string> {
  const parsed = parseStressedForm(stressedName);
  if (!parsed) return new Map();
  const forms = new Map([[parsed.plain, parsed.stressed]]);
  const apostrophe = parsed.stressed.indexOf("'");
  const stem = stemNameToken(parsed.plain);
  if (stem.length < MIN_NAME_STEM_LENGTH || apostrophe > stem.length) return forms;
  const stressedStem = `${stem.slice(0, apostrophe)}'${stem.slice(apostrophe)}`;
  for (const ending of NAME_ENDINGS) {
    forms.set(stem + ending, stressedStem + ending);
  }
  return forms;
}

export function compileStressDictionary(
  entries: readonly StressDictionaryEntry[],
): Map<string, string> {
  const dictionary = new Map<string, string>();
  for (const entry of entries) {
    if (entry.inflect) {
      for (const [form, stressed] of stressedNameForms(entry.stressed)) {
        dictionary.set(form, stressed);
      }
      continue;
    }
    const parsed = parseStressedForm(entry.stressed);
    if (parsed) dictionary.set(parsed.plain, parsed.stressed);
  }
  return dictionary;
}

/** Слово: буквы и апострофы (слова с уже стоящим апострофом не трогаем). */
const WORD_RE = /[\p{L}][\p{L}'’]*/gu;
/** Целиком XML-тег — внутри тегов и атрибутов разметки нет. */
const XML_TAG_RE = /^<[^>]*>$/;

function markPlainText(text: string, dictionary: CompiledStressDictionary): string {
  return text.replace(WORD_RE, (word) => {
    if (word.includes("'") || word.includes("’")) return word;
    const stressed = dictionary.get(word.toLowerCase());
    if (!stressed) return word;
    const apostrophe = stressed.indexOf("'");
    // Вставка по индексу сохраняет регистр исходного слова («ГЕРМИОНА» → «ГЕРМИО'НА»).
    return `${word.slice(0, apostrophe)}'${word.slice(apostrophe)}`;
  });
}

/**
 * Расставляет апострофы-ударения по словарю: регистронезависимо с сохранением
 * регистра, строго по границам слов. Для SSML размечаются только текстовые
 * узлы — содержимое тегов и атрибутов не трогается.
 */
export function applyStressMarkup(text: string, dictionary: CompiledStressDictionary): string {
  if (!text || dictionary.size === 0) return text;
  if (!text.includes("<")) return markPlainText(text, dictionary);
  return text
    .split(/(<[^>]*>)/g)
    .map((part) => (XML_TAG_RE.test(part) ? part : markPlainText(part, dictionary)))
    .join("");
}

// ─── Активный словарь (читается synthesizeNarraSpeech при каждом синтезе) ────

let baseDictionaryCache: Map<string, string> | null = null;

function getBaseDictionary(): Map<string, string> {
  if (!baseDictionaryCache) baseDictionaryCache = compileStressDictionary(BASE_STRESS_ENTRIES);
  return baseDictionaryCache;
}

/** null — активен только базовый словарь. */
let activeDictionary: Map<string, string> | null = null;

export type StressCharacterSource = Pick<NarraCharacter, "name" | "fullName" | "stressedName">;

/**
 * Подмешивает к базовому словарю словоформы имён персонажей текущей книги.
 * stressedName принимается только если форма без апострофа совпадает со
 * словом из name/fullName персонажа (защита от галлюцинаций анализа).
 * Пустой список (или персонажи без stressedName) возвращает базовый словарь.
 */
export function primeCharacterStressForms(characters: readonly StressCharacterSource[]): void {
  let merged: Map<string, string> | null = null;
  for (const character of characters) {
    if (!character.stressedName) continue;
    const nameTokens = new Set(
      `${character.name} ${character.fullName ?? ""}`.toLowerCase().match(/[а-яё]+/g) ?? [],
    );
    const stressedTokens =
      normalizeApostrophes(character.stressedName)
        .toLowerCase()
        .match(/[а-яё']+/g) ?? [];
    for (const token of stressedTokens) {
      if (!token.includes("'")) continue;
      const parsed = parseStressedForm(token);
      if (!parsed || !nameTokens.has(parsed.plain)) continue;
      merged ??= new Map(getBaseDictionary());
      for (const [form, stressed] of stressedNameForms(parsed.stressed)) {
        merged.set(form, stressed);
      }
    }
  }
  activeDictionary = merged;
}

/** Разметка активным словарём — единственный вход для пайплайна синтеза. */
export function applyActiveStressMarkup(text: string): string {
  return applyStressMarkup(text, activeDictionary ?? getBaseDictionary());
}
