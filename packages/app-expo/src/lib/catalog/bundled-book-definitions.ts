export interface BundledCatalogBookDefinition {
  id: string;
  title: string;
  author: string;
  fileName: string;
}

export const BUNDLED_CATALOG_BOOK_DEFINITIONS: readonly BundledCatalogBookDefinition[] = [
  {
    id: "fathers-and-sons",
    title: "Отцы и дети",
    author: "Иван Тургенев",
    fileName: "fathers-and-sons.epub",
  },
  {
    id: "anna-karenina",
    title: "Анна Каренина",
    author: "Лев Толстой",
    fileName: "anna-karenina.epub",
  },
  {
    id: "war-and-peace",
    title: "Война и мир",
    author: "Лев Толстой",
    fileName: "war-and-peace.epub",
  },
  {
    id: "crime-and-punishment",
    title: "Преступление и наказание",
    author: "Фёдор Достоевский",
    fileName: "crime-and-punishment.epub",
  },
  {
    id: "government-inspector",
    title: "Ревизор",
    author: "Николай Гоголь",
    fileName: "government-inspector.epub",
  },
  {
    id: "dead-souls",
    title: "Мёртвые души",
    author: "Николай Гоголь",
    fileName: "dead-souls.epub",
  },
  {
    id: "hero-of-our-time",
    title: "Герой нашего времени",
    author: "Михаил Лермонтов",
    fileName: "hero-of-our-time.epub",
  },
  {
    id: "captains-daughter",
    title: "Капитанская дочка",
    author: "Александр Пушкин",
    fileName: "captains-daughter.epub",
  },
  {
    id: "eugene-onegin",
    title: "Евгений Онегин",
    author: "Александр Пушкин",
    fileName: "eugene-onegin.epub",
  },
  {
    id: "gentleman-from-san-francisco",
    title: "Господин из Сан-Франциско",
    author: "Иван Бунин",
    fileName: "gentleman-from-san-francisco.epub",
  },
  {
    id: "dark-avenues",
    title: "Тёмные аллеи",
    author: "Иван Бунин",
    fileName: "dark-avenues.epub",
  },
  {
    id: "golden-key",
    title: "Золотой ключик, или Приключения Буратино",
    author: "Алексей Толстой",
    fileName: "golden-key.epub",
  },
  {
    id: "twelve-chairs",
    title: "Двенадцать стульев",
    author: "Илья Ильф и Евгений Петров",
    fileName: "twelve-chairs.epub",
  },
  {
    id: "three-sisters",
    title: "Три сестры",
    author: "Антон Чехов",
    fileName: "three-sisters.epub",
  },
  { id: "seagull", title: "Чайка", author: "Антон Чехов", fileName: "seagull.epub" },
  {
    id: "cherry-orchard",
    title: "Вишнёвый сад",
    author: "Антон Чехов",
    fileName: "cherry-orchard.epub",
  },
  {
    id: "thunderstorm",
    title: "Гроза",
    author: "Александр Островский",
    fileName: "thunderstorm.epub",
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
