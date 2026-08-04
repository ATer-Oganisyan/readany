import { Asset } from "expo-asset";

export interface BundledCatalogBook {
  id: string;
  title: string;
  author: string;
  fileName: string;
  assetModule: number;
}

export const BUNDLED_CATALOG_BOOKS: readonly BundledCatalogBook[] = [
  {
    id: "fathers-and-sons",
    title: "Отцы и дети",
    author: "Иван Тургенев",
    fileName: "fathers-and-sons.epub",
    assetModule: require("../../../assets/catalog/fathers-and-sons.epub"),
  },
  {
    id: "anna-karenina",
    title: "Анна Каренина",
    author: "Лев Толстой",
    fileName: "anna-karenina.epub",
    assetModule: require("../../../assets/catalog/anna-karenina.epub"),
  },
  {
    id: "war-and-peace",
    title: "Война и мир",
    author: "Лев Толстой",
    fileName: "war-and-peace.epub",
    assetModule: require("../../../assets/catalog/war-and-peace.epub"),
  },
  {
    id: "crime-and-punishment",
    title: "Преступление и наказание",
    author: "Фёдор Достоевский",
    fileName: "crime-and-punishment.epub",
    assetModule: require("../../../assets/catalog/crime-and-punishment.epub"),
  },
  {
    id: "government-inspector",
    title: "Ревизор",
    author: "Николай Гоголь",
    fileName: "government-inspector.epub",
    assetModule: require("../../../assets/catalog/government-inspector.epub"),
  },
  {
    id: "dead-souls",
    title: "Мёртвые души",
    author: "Николай Гоголь",
    fileName: "dead-souls.epub",
    assetModule: require("../../../assets/catalog/dead-souls.epub"),
  },
  {
    id: "hero-of-our-time",
    title: "Герой нашего времени",
    author: "Михаил Лермонтов",
    fileName: "hero-of-our-time.epub",
    assetModule: require("../../../assets/catalog/hero-of-our-time.epub"),
  },
  {
    id: "captains-daughter",
    title: "Капитанская дочка",
    author: "Александр Пушкин",
    fileName: "captains-daughter.epub",
    assetModule: require("../../../assets/catalog/captains-daughter.epub"),
  },
  {
    id: "eugene-onegin",
    title: "Евгений Онегин",
    author: "Александр Пушкин",
    fileName: "eugene-onegin.epub",
    assetModule: require("../../../assets/catalog/eugene-onegin.epub"),
  },
  {
    id: "gentleman-from-san-francisco",
    title: "Господин из Сан-Франциско",
    author: "Иван Бунин",
    fileName: "gentleman-from-san-francisco.epub",
    assetModule: require("../../../assets/catalog/gentleman-from-san-francisco.epub"),
  },
  {
    id: "dark-avenues",
    title: "Тёмные аллеи",
    author: "Иван Бунин",
    fileName: "dark-avenues.epub",
    assetModule: require("../../../assets/catalog/dark-avenues.epub"),
  },
  {
    id: "golden-key",
    title: "Золотой ключик, или Приключения Буратино",
    author: "Алексей Толстой",
    fileName: "golden-key.epub",
    assetModule: require("../../../assets/catalog/golden-key.epub"),
  },
  {
    id: "twelve-chairs",
    title: "Двенадцать стульев",
    author: "Илья Ильф и Евгений Петров",
    fileName: "twelve-chairs.epub",
    assetModule: require("../../../assets/catalog/twelve-chairs.epub"),
  },
  {
    id: "three-sisters",
    title: "Три сестры",
    author: "Антон Чехов",
    fileName: "three-sisters.epub",
    assetModule: require("../../../assets/catalog/three-sisters.epub"),
  },
  {
    id: "seagull",
    title: "Чайка",
    author: "Антон Чехов",
    fileName: "seagull.epub",
    assetModule: require("../../../assets/catalog/seagull.epub"),
  },
  {
    id: "cherry-orchard",
    title: "Вишнёвый сад",
    author: "Антон Чехов",
    fileName: "cherry-orchard.epub",
    assetModule: require("../../../assets/catalog/cherry-orchard.epub"),
  },
  {
    id: "thunderstorm",
    title: "Гроза",
    author: "Александр Островский",
    fileName: "thunderstorm.epub",
    assetModule: require("../../../assets/catalog/thunderstorm.epub"),
  },
] as const;

export async function resolveBundledCatalogBookUri(book: BundledCatalogBook): Promise<string> {
  const asset = Asset.fromModule(book.assetModule);
  await asset.downloadAsync();
  const uri = asset.localUri || asset.uri;
  if (!uri) throw new Error(`Bundled book asset is unavailable: ${book.id}`);
  return uri;
}

export function normalizeCatalogIdentity(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ");
}
