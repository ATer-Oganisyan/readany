import { getPlatformService } from "@readany/core/services";
import { Asset } from "expo-asset";
import {
  BUNDLED_CATALOG_BOOK_DEFINITIONS,
  type BundledCatalogBookDefinition,
  getBundledCatalogCoverPath,
  normalizeCatalogIdentity,
} from "./bundled-book-definitions";

export interface BundledCatalogBook extends BundledCatalogBookDefinition {
  assetModule: number;
  coverAssetModule: number;
}

const BUNDLED_CATALOG_ASSETS: Record<
  string,
  Pick<BundledCatalogBook, "assetModule" | "coverAssetModule">
> = {
  "fathers-and-sons": {
    assetModule: require("../../../assets/catalog/fathers-and-sons.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/fathers-and-sons.jpg"),
  },
  "anna-karenina": {
    assetModule: require("../../../assets/catalog/anna-karenina.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/anna-karenina.jpg"),
  },
  "war-and-peace": {
    assetModule: require("../../../assets/catalog/war-and-peace.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/war-and-peace.jpg"),
  },
  "crime-and-punishment": {
    assetModule: require("../../../assets/catalog/crime-and-punishment.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/crime-and-punishment.jpg"),
  },
  "government-inspector": {
    assetModule: require("../../../assets/catalog/government-inspector.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/government-inspector.jpg"),
  },
  "dead-souls": {
    assetModule: require("../../../assets/catalog/dead-souls.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/dead-souls.jpg"),
  },
  "hero-of-our-time": {
    assetModule: require("../../../assets/catalog/hero-of-our-time.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/hero-of-our-time.jpg"),
  },
  "captains-daughter": {
    assetModule: require("../../../assets/catalog/captains-daughter.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/captains-daughter.jpg"),
  },
  "eugene-onegin": {
    assetModule: require("../../../assets/catalog/eugene-onegin.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/eugene-onegin.jpg"),
  },
  "gentleman-from-san-francisco": {
    assetModule: require("../../../assets/catalog/gentleman-from-san-francisco.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/gentleman-from-san-francisco.jpg"),
  },
  "dark-avenues": {
    assetModule: require("../../../assets/catalog/dark-avenues.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/dark-avenues.jpg"),
  },
  "golden-key": {
    assetModule: require("../../../assets/catalog/golden-key.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/golden-key.jpg"),
  },
  "twelve-chairs": {
    assetModule: require("../../../assets/catalog/twelve-chairs.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/twelve-chairs.jpg"),
  },
  "three-sisters": {
    assetModule: require("../../../assets/catalog/three-sisters.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/three-sisters.jpg"),
  },
  seagull: {
    assetModule: require("../../../assets/catalog/seagull.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/seagull.jpg"),
  },
  "cherry-orchard": {
    assetModule: require("../../../assets/catalog/cherry-orchard.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/cherry-orchard.jpg"),
  },
  thunderstorm: {
    assetModule: require("../../../assets/catalog/thunderstorm.epub"),
    coverAssetModule: require("../../../assets/catalog/covers/thunderstorm.jpg"),
  },
};

export const BUNDLED_CATALOG_BOOKS: readonly BundledCatalogBook[] =
  BUNDLED_CATALOG_BOOK_DEFINITIONS.map((book) => ({
    ...book,
    ...BUNDLED_CATALOG_ASSETS[book.id],
  }));

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
  const relativePath = getBundledCatalogCoverPath(bookId);
  await platform.writeFile(await platform.joinPath(appData, relativePath), bytes);
  return relativePath;
}

export function findBundledCatalogBookByTitle(title: string): BundledCatalogBook | undefined {
  const normalizedTitle = normalizeCatalogIdentity(title);
  return BUNDLED_CATALOG_BOOKS.find(
    (catalogBook) => normalizeCatalogIdentity(catalogBook.title) === normalizedTitle,
  );
}

export { normalizeCatalogIdentity } from "./bundled-book-definitions";
