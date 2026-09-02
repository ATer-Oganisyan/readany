import { getBundledCatalogCharactersByTitle } from "./bundled-catalog-characters";
import type { NarraCharacter } from "./types";

function normalizeName(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastToken(value: string): string {
  const tokens = value.split(" ").filter(Boolean);
  return tokens.at(-1) ?? "";
}

/** Книги, где бэковые портреты заменяются кураторскими (по требованию продукта). */
const CURATED_PORTRAIT_BOOK_TITLES = new Set(["преступление и наказание"]);

/**
 * Подставляет кураторские бандл-портреты (assets/catalog/characters) бэковым
 * персонажам книг из белого списка. Бэковый пайплайн генерирует свои портреты,
 * но для этих книг у нас есть выверенные вручную изображения — они должны
 * побеждать сгенерированные. Матчинг по имени: точное совпадение name/fullName
 * либо совпадение фамилии (последний токен полного имени, от 4 символов).
 */
export function applyCuratedPortraitAssets(
  characters: NarraCharacter[],
  bookTitle: string | undefined,
): NarraCharacter[] {
  if (!bookTitle || !CURATED_PORTRAIT_BOOK_TITLES.has(normalizeName(bookTitle))) {
    return characters;
  }
  const curated = getBundledCatalogCharactersByTitle(bookTitle);
  if (!curated?.length) return characters;

  const byExact = new Map<string, string>();
  const bySurname = new Map<string, string | null>();
  for (const source of curated) {
    if (!source.portraitAssetId) continue;
    for (const key of [normalizeName(source.name), normalizeName(source.fullName)]) {
      if (key && !byExact.has(key)) byExact.set(key, source.portraitAssetId);
    }
    const surname = lastToken(normalizeName(source.fullName));
    if (surname.length >= 4) {
      // Одинаковая фамилия у двух кураторских героев (Раскольников и Дуня и т.п.)
      // делает фамильный матч неоднозначным — такой ключ выключаем.
      bySurname.set(surname, bySurname.has(surname) ? null : source.portraitAssetId);
    }
  }

  const used = new Set<string>();
  return characters.map((character) => {
    if (character.portraitAssetId) return character;
    const name = normalizeName(character.name);
    const fullName = normalizeName(character.fullName);
    const assetId =
      byExact.get(fullName) ||
      byExact.get(name) ||
      bySurname.get(lastToken(fullName)) ||
      bySurname.get(lastToken(name)) ||
      undefined;
    if (!assetId || used.has(assetId)) return character;
    used.add(assetId);
    return { ...character, portraitAssetId: assetId };
  });
}
