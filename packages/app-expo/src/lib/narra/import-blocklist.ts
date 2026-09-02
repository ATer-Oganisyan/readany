/**
 * L0-модерация импорта: материалы, запрещённые к распространению в РФ
 * (Федеральный список экстремистских материалов), не подгружаются вовсе —
 * ни чтение, ни AI-функции. Проверка по названию/автору/имени файла.
 *
 * Список точечный: только однозначно узнаваемые запрещённые произведения.
 * Художественная классика с тяжёлыми темами сюда не попадает по определению.
 */

export const BANNED_IMPORT_MESSAGE =
  "Эту книгу нельзя добавить: материал запрещён к распространению в РФ.";

interface BannedBookRule {
  /** Подстроки названия (нормализованные), любая из которых достаточна. */
  titles: string[];
  /** Если заданы — блок только при совпадении и названия, и автора. */
  authors?: string[];
  reason: string;
}

const BANNED_BOOKS: readonly BannedBookRule[] = [
  {
    titles: ["майн кампф", "mein kampf", "моя борьба"],
    authors: ["гитлер", "hitler"],
    reason: "Федеральный список экстремистских материалов",
  },
  // «Майн кампф» узнаваем и без автора в метаданных.
  {
    titles: ["майн кампф", "mein kampf"],
    reason: "Федеральный список экстремистских материалов",
  },
  {
    titles: ["протоколы сионских мудрецов", "protocols of the elders of zion"],
    reason: "Федеральный список экстремистских материалов",
  },
  {
    titles: ["turner diaries", "дневники тёрнера", "дневники тернера"],
    reason: "Федеральный список экстремистских материалов",
  },
  {
    titles: ["поваренная книга анархиста", "anarchist cookbook"],
    reason: "Федеральный список экстремистских материалов",
  },
];

function normalize(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface BannedImportMatch {
  reason: string;
}

/**
 * Проверяет книгу перед добавлением в библиотеку. Возвращает причину блокировки
 * или undefined, если книга разрешена.
 */
export function findBannedImport(
  title: string | undefined,
  author?: string,
  fileName?: string,
): BannedImportMatch | undefined {
  const haystackTitle = `${normalize(title)} ${normalize(fileName)}`.trim();
  const haystackAuthor = normalize(author);
  for (const rule of BANNED_BOOKS) {
    const titleHit = rule.titles.some((needle) => haystackTitle.includes(needle));
    if (!titleHit) continue;
    if (rule.authors && !rule.authors.some((needle) => haystackAuthor.includes(needle))) {
      // Для правил с авторами название без автора не блокирует (кроме
      // отдельного правила без authors, если оно есть в списке).
      continue;
    }
    return { reason: rule.reason };
  }
  return undefined;
}
