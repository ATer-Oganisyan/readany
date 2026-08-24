/**
 * Ключ книги по названию и автору.
 *
 * У бэкенда нет наших локальных id, поэтому книга каталога и та же книга в
 * библиотеке связываются только так. Этим же ключом выбирается цвет заглушки:
 * иначе книга меняла бы цвет при добавлении в библиотеку, где id уже локальный.
 */
function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ");
}

export function bookIdentity(title: string, author: string): string {
  return `${normalize(title)}|${normalize(author)}`;
}
