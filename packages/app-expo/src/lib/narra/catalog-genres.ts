export const CATALOG_GENRE_IDS = [
  "literary-fiction",
  "historical-fiction",
  "adventure",
  "mystery-thriller",
  "science-fiction",
  "fantasy",
  "horror",
  "romance",
  "children",
  "poetry",
  "drama",
  "humor-satire",
  "biography-memoir",
  "history",
  "society-politics",
  "philosophy",
  "religion-mythology",
  "science-nature",
  "psychology-self-help",
  "travel-essays",
] as const;

export type CatalogGenreId = (typeof CATALOG_GENRE_IDS)[number];

const CATALOG_GENRE_ID_SET = new Set<string>(CATALOG_GENRE_IDS);

export function isCatalogGenreId(value: unknown): value is CatalogGenreId {
  return typeof value === "string" && CATALOG_GENRE_ID_SET.has(value);
}

export function parseCatalogGenres(value: unknown): CatalogGenreId[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const genres = [...new Set(value.filter(isCatalogGenreId))];
  return genres.length > 0 ? genres : undefined;
}
