/**
 * Ключ книги по названию и автору.
 *
 * Резервное сопоставление старых локальных книг без серверного edition ID.
 * Этим же ключом выбирается цвет заглушки, чтобы он сохранялся при импорте.
 */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

export function bookIdentity(title: string, author: string): string {
  return `${normalize(title)}|${normalize(author)}`;
}
