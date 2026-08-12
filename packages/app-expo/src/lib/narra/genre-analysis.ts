export const NARRA_GENRE_IDS = [
  "classic",
  "manga",
  "fanfiction",
  "children",
  "poetry",
  "drama",
  "mystery-thriller",
  "science-fiction",
  "adventure",
  "fantasy",
  "horror",
  "romance",
  "historical-fiction",
  "biography-memoir",
  "philosophy",
  "psychology-self-help",
  "business-economics",
  "science-technology",
  "history-politics",
  "literary-fiction",
] as const;

export type NarraGenreId = (typeof NARRA_GENRE_IDS)[number];

export interface NarraGenreAnalysis {
  primary: NarraGenreId;
  secondary: NarraGenreId[];
  confidence: number;
  evidence: string;
}

export const MIN_NARRA_GENRE_CONFIDENCE = 0.6;

const genreIds = new Set<string>(NARRA_GENRE_IDS);

const genreLabels: Record<NarraGenreId, string> = {
  classic: "классическая литература",
  manga: "манга или аниме-графическая проза",
  fanfiction: "фанфик или трансформативная проза",
  children: "детская литература",
  poetry: "поэзия",
  drama: "драма или пьеса",
  "mystery-thriller": "детектив, криминальная проза или триллер",
  "science-fiction": "научная фантастика",
  adventure: "приключения",
  fantasy: "фэнтези",
  horror: "хоррор",
  romance: "романтическая проза",
  "historical-fiction": "историческая проза",
  "biography-memoir": "биография или мемуары",
  philosophy: "философия",
  "psychology-self-help": "психология или саморазвитие",
  "business-economics": "бизнес или экономика",
  "science-technology": "наука или технологии",
  "history-politics": "история, общество или политика",
  "literary-fiction": "литературная проза",
};

export function isNarraGenreId(value: unknown): value is NarraGenreId {
  return typeof value === "string" && genreIds.has(value);
}

export function narraGenreLabel(id: NarraGenreId): string {
  return genreLabels[id];
}

export function normalizeNarraGenreAnalysis(value: unknown): NarraGenreAnalysis | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!isNarraGenreId(raw.primary)) return undefined;

  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < MIN_NARRA_GENRE_CONFIDENCE) return undefined;

  const secondary = Array.isArray(raw.secondary)
    ? [...new Set(raw.secondary.filter(isNarraGenreId))]
        .filter((id) => id !== raw.primary)
        .slice(0, 3)
    : [];

  return {
    primary: raw.primary,
    secondary,
    confidence: Math.min(1, confidence),
    evidence: typeof raw.evidence === "string" ? raw.evidence.trim().slice(0, 300) : "",
  };
}
