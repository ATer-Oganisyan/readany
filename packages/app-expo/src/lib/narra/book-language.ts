/** Only explicit metadata: never infer a book's language from its title/key or UI locale. */
export function normalizeBookLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.trim().toLowerCase();
  return /^[a-z]{2,3}(?:[-_][a-z0-9]{1,8})*$/.test(tag) ? tag.split(/[-_]/)[0] : null;
}

export type CatalogLanguage = "ru" | "en";

export function isCatalogLanguage(value: unknown): value is CatalogLanguage {
  return value === "ru" || value === "en";
}

export const BOOK_CATALOG_LANGUAGE_CONTRACT = "book-catalog-language-v1";
