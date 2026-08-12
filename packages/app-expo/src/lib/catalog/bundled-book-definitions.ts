export interface BundledCatalogBookDefinition {
  id: string;
  title: string;
  author: string;
  fileName: string;
  coverTextTone: "dark" | "light";
}

export const BUNDLED_CATALOG_COVER_VERSION = 7;

export function getBundledCatalogCoverPath(bookId: string): string {
  return `covers/${bookId}-catalog-v${BUNDLED_CATALOG_COVER_VERSION}.jpg`;
}

export function isBundledCatalogCoverPath(bookId: string, coverUrl?: string): boolean {
  if (!coverUrl) return false;
  const escapedBookId = bookId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^covers/${escapedBookId}-catalog(?:-v\\d+)?\\.jpg$`).test(coverUrl);
}

export function shouldRefreshBundledCatalogCover(bookId: string, coverUrl?: string): boolean {
  return (
    !coverUrl ||
    (coverUrl !== getBundledCatalogCoverPath(bookId) && isBundledCatalogCoverPath(bookId, coverUrl))
  );
}

export const BUNDLED_CATALOG_BOOK_DEFINITIONS: readonly BundledCatalogBookDefinition[] = [
  {
    id: "fathers-and-sons",
    title: "Отцы и дети",
    author: "Иван Тургенев",
    fileName: "fathers-and-sons.epub",
    coverTextTone: "dark",
  },
  {
    id: "anna-karenina",
    title: "Анна Каренина",
    author: "Лев Толстой",
    fileName: "anna-karenina.epub",
    coverTextTone: "dark",
  },
  {
    id: "war-and-peace",
    title: "Война и мир",
    author: "Лев Толстой",
    fileName: "war-and-peace.epub",
    coverTextTone: "dark",
  },
  {
    id: "crime-and-punishment",
    title: "Преступление и наказание",
    author: "Фёдор Достоевский",
    fileName: "crime-and-punishment.epub",
    coverTextTone: "dark",
  },
  {
    id: "government-inspector",
    title: "Ревизор",
    author: "Николай Гоголь",
    fileName: "government-inspector.epub",
    coverTextTone: "dark",
  },
  {
    id: "dead-souls",
    title: "Мёртвые души",
    author: "Николай Гоголь",
    fileName: "dead-souls.epub",
    coverTextTone: "light",
  },
  {
    id: "hero-of-our-time",
    title: "Герой нашего времени",
    author: "Михаил Лермонтов",
    fileName: "hero-of-our-time.epub",
    coverTextTone: "light",
  },
  {
    id: "captains-daughter",
    title: "Капитанская дочка",
    author: "Александр Пушкин",
    fileName: "captains-daughter.epub",
    coverTextTone: "dark",
  },
  {
    id: "eugene-onegin",
    title: "Евгений Онегин",
    author: "Александр Пушкин",
    fileName: "eugene-onegin.epub",
    coverTextTone: "dark",
  },
  {
    id: "gentleman-from-san-francisco",
    title: "Господин из Сан-Франциско",
    author: "Иван Бунин",
    fileName: "gentleman-from-san-francisco.epub",
    coverTextTone: "dark",
  },
  {
    id: "dark-avenues",
    title: "Тёмные аллеи",
    author: "Иван Бунин",
    fileName: "dark-avenues.epub",
    coverTextTone: "light",
  },
  {
    id: "golden-key",
    title: "Золотой ключик, или Приключения Буратино",
    author: "Алексей Толстой",
    fileName: "golden-key.epub",
    coverTextTone: "dark",
  },
  {
    id: "twelve-chairs",
    title: "Двенадцать стульев",
    author: "Илья Ильф и Евгений Петров",
    fileName: "twelve-chairs.epub",
    coverTextTone: "dark",
  },
  {
    id: "three-sisters",
    title: "Три сестры",
    author: "Антон Чехов",
    fileName: "three-sisters.epub",
    coverTextTone: "dark",
  },
  {
    id: "seagull",
    title: "Чайка",
    author: "Антон Чехов",
    fileName: "seagull.epub",
    coverTextTone: "dark",
  },
  {
    id: "cherry-orchard",
    title: "Вишнёвый сад",
    author: "Антон Чехов",
    fileName: "cherry-orchard.epub",
    coverTextTone: "dark",
  },
  {
    id: "thunderstorm",
    title: "Гроза",
    author: "Александр Островский",
    fileName: "thunderstorm.epub",
    coverTextTone: "light",
  },
] as const;

export function normalizeCatalogIdentity(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ");
}

export function findBundledCatalogBookDefinitionByTitle(
  title: string,
): BundledCatalogBookDefinition | undefined {
  const normalizedTitle = normalizeCatalogIdentity(title);
  return BUNDLED_CATALOG_BOOK_DEFINITIONS.find(
    (book) => normalizeCatalogIdentity(book.title) === normalizedTitle,
  );
}
