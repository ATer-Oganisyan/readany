import { getPlatformService } from "@readany/core/services";
import { Asset } from "expo-asset";

export interface BundledCatalogBook {
  id: string;
  title: string;
  author: string;
  fileName: string;
  assetModule: number;
  coverAssetModule: number;
}

export const BUNDLED_CATALOG_BOOKS: readonly BundledCatalogBook[] = [
  {
    id: "fathers-and-sons",
    title: "Отцы и дети",
    author: "Иван Тургенев",
    fileName: "fathers-and-sons.epub",
    assetModule: require("../../../assets/catalog/fathers-and-sons.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/fathers-and-sons.jpg"),
  },
  {
    id: "anna-karenina",
    title: "Анна Каренина",
    author: "Лев Толстой",
    fileName: "anna-karenina.epub",
    assetModule: require("../../../assets/catalog/anna-karenina.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/anna-karenina.jpg"),
  },
  {
    id: "war-and-peace",
    title: "Война и мир",
    author: "Лев Толстой",
    fileName: "war-and-peace.epub",
    assetModule: require("../../../assets/catalog/war-and-peace.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/war-and-peace.jpg"),
  },
  {
    id: "crime-and-punishment",
    title: "Преступление и наказание",
    author: "Фёдор Достоевский",
    fileName: "crime-and-punishment.epub",
    assetModule: require("../../../assets/catalog/crime-and-punishment.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/crime-and-punishment.jpg"),
  },
  {
    id: "government-inspector",
    title: "Ревизор",
    author: "Николай Гоголь",
    fileName: "government-inspector.epub",
    assetModule: require("../../../assets/catalog/government-inspector.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/government-inspector.jpg"),
  },
  {
    id: "dead-souls",
    title: "Мёртвые души",
    author: "Николай Гоголь",
    fileName: "dead-souls.epub",
    assetModule: require("../../../assets/catalog/dead-souls.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/dead-souls.jpg"),
  },
  {
    id: "hero-of-our-time",
    title: "Герой нашего времени",
    author: "Михаил Лермонтов",
    fileName: "hero-of-our-time.epub",
    assetModule: require("../../../assets/catalog/hero-of-our-time.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/hero-of-our-time.jpg"),
  },
  {
    id: "captains-daughter",
    title: "Капитанская дочка",
    author: "Александр Пушкин",
    fileName: "captains-daughter.epub",
    assetModule: require("../../../assets/catalog/captains-daughter.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/captains-daughter.jpg"),
  },
  {
    id: "eugene-onegin",
    title: "Евгений Онегин",
    author: "Александр Пушкин",
    fileName: "eugene-onegin.epub",
    assetModule: require("../../../assets/catalog/eugene-onegin.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/eugene-onegin.jpg"),
  },
  {
    id: "gentleman-from-san-francisco",
    title: "Господин из Сан-Франциско",
    author: "Иван Бунин",
    fileName: "gentleman-from-san-francisco.epub",
    assetModule: require("../../../assets/catalog/gentleman-from-san-francisco.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/gentleman-from-san-francisco.jpg"),
  },
  {
    id: "dark-avenues",
    title: "Тёмные аллеи",
    author: "Иван Бунин",
    fileName: "dark-avenues.epub",
    assetModule: require("../../../assets/catalog/dark-avenues.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/dark-avenues.jpg"),
  },
  {
    id: "golden-key",
    title: "Золотой ключик, или Приключения Буратино",
    author: "Алексей Толстой",
    fileName: "golden-key.epub",
    assetModule: require("../../../assets/catalog/golden-key.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/golden-key.jpg"),
  },
  {
    id: "twelve-chairs",
    title: "Двенадцать стульев",
    author: "Илья Ильф и Евгений Петров",
    fileName: "twelve-chairs.epub",
    assetModule: require("../../../assets/catalog/twelve-chairs.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/twelve-chairs.jpg"),
  },
  {
    id: "three-sisters",
    title: "Три сестры",
    author: "Антон Чехов",
    fileName: "three-sisters.epub",
    assetModule: require("../../../assets/catalog/three-sisters.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/three-sisters.jpg"),
  },
  {
    id: "seagull",
    title: "Чайка",
    author: "Антон Чехов",
    fileName: "seagull.epub",
    assetModule: require("../../../assets/catalog/seagull.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/seagull.jpg"),
  },
  {
    id: "cherry-orchard",
    title: "Вишнёвый сад",
    author: "Антон Чехов",
    fileName: "cherry-orchard.epub",
    assetModule: require("../../../assets/catalog/cherry-orchard.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/cherry-orchard.jpg"),
  },
  {
    id: "thunderstorm",
    title: "Гроза",
    author: "Александр Островский",
    fileName: "thunderstorm.epub",
    assetModule: require("../../../assets/catalog/thunderstorm.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/thunderstorm.jpg"),
  },
] as const;

export async function resolveBundledCatalogBookUri(book: BundledCatalogBook): Promise<string> {
  const asset = Asset.fromModule(book.assetModule);
  await asset.downloadAsync();
  const uri = asset.localUri || asset.uri;
  if (!uri) throw new Error(`Bundled book asset is unavailable: ${book.id}`);
  return uri;
}

export async function resolveBundledCatalogCoverUri(book: BundledCatalogBook): Promise<string> {
  const asset = Asset.fromModule(book.coverAssetModule);
  await asset.downloadAsync();
  const uri = asset.localUri || asset.uri;
  if (!uri) throw new Error(`Bundled cover asset is unavailable: ${book.id}`);
  return uri;
}

export async function installBundledCatalogCover(
  bookId: string,
  catalogBook: BundledCatalogBook,
): Promise<string> {
  const platform = getPlatformService();
  const coverUri = await resolveBundledCatalogCoverUri(catalogBook);
  const bytes = await platform.readFile(coverUri);
  const appData = await platform.getAppDataDir();
  const coversDir = await platform.joinPath(appData, "covers");
  await platform.mkdir(coversDir);
  const relativePath = `covers/${bookId}-catalog.jpg`;
  await platform.writeFile(await platform.joinPath(appData, relativePath), bytes);
  return relativePath;
}

export function findBundledCatalogBookByTitle(title: string): BundledCatalogBook | undefined {
  const normalizedTitle = normalizeCatalogIdentity(title);
  return BUNDLED_CATALOG_BOOKS.find(
    (catalogBook) => normalizeCatalogIdentity(catalogBook.title) === normalizedTitle,
  );
}

export function normalizeCatalogIdentity(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ");
}
