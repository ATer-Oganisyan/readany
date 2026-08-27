import { getPlatformService } from "@readany/core/services";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import readerBuild from "../../../assets/reader/reader-build.json";

import { getBundledReaderFontFaceCSS } from "./bundled-reader-font";
import { startFileServer } from "./local-file-server";
import { createReaderAssetLoader } from "./reader-asset";

export const READER_BUILD_ID = readerBuild.htmlMd5;
const READER_PDF_ASSET = Asset.fromModule(require("../../../assets/reader/reader-pdf.bin"));
const READER_ASSET_DIRECTORY = "readany-reader-assets";

const loadReaderAsset = createReaderAssetLoader({
  download: async (uri, hash) => {
    // Avoid the in-memory Asset.downloaded shortcut. Native Expo still reuses
    // matching files on disk, and redownloads missing or mismatched files.
    const asset = await new Asset({ name: "reader", type: "html", uri, hash }).downloadAsync();
    if (!asset.localUri) throw new Error("Reader asset was not downloaded");
    return asset.localUri;
  },
  inspect: (uri) => FileSystem.getInfoAsync(uri, { md5: true }),
});
let readerHostPreparation: Promise<{ serverUrl: string; fontFaceCSS: string }> | null = null;
let readerPdfPreparation: Promise<string> | null = null;

export function prepareReaderAsset(): Promise<string> {
  const asset = Asset.fromModule(require("../../../assets/reader/reader.html"));
  return loadReaderAsset(asset.uri || asset.localUri || "", READER_BUILD_ID);
}

export function prepareReaderHost(): Promise<{ serverUrl: string; fontFaceCSS: string }> {
  if (!readerHostPreparation) {
    readerHostPreparation = (async () => {
      const platform = getPlatformService();
      const appData = await platform.getAppDataDir();
      const serverUrl = await startFileServer(appData);
      const fontFaceCSS = await getBundledReaderFontFaceCSS(serverUrl);
      return { serverUrl, fontFaceCSS };
    })().catch((error) => {
      readerHostPreparation = null;
      throw error;
    });
  }

  return readerHostPreparation;
}

/** PDF is the large optional reader engine. EPUB opens never download it. */
export function prepareReaderPdfEngineUri(): Promise<string> {
  if (!readerPdfPreparation) {
    readerPdfPreparation = (async () => {
      const [{ serverUrl }, asset, platform] = await Promise.all([
        prepareReaderHost(),
        READER_PDF_ASSET.downloadAsync(),
        Promise.resolve(getPlatformService()),
      ]);
      const appData = (await platform.getAppDataDir()).replace(/\/$/, "");
      const directory = `${appData}/${READER_ASSET_DIRECTORY}`;
      const destination = `${directory}/reader-pdf.bin`;
      const source = asset.localUri || asset.uri;
      const [sourceInfo, destinationInfo] = await Promise.all([
        FileSystem.getInfoAsync(source),
        FileSystem.getInfoAsync(destination),
      ]);
      if (!sourceInfo.exists) throw new Error("Bundled PDF reader engine is missing");
      if (!destinationInfo.exists || destinationInfo.size !== sourceInfo.size) {
        await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
        await FileSystem.deleteAsync(destination, { idempotent: true });
        await FileSystem.copyAsync({ from: source, to: destination });
      }
      return `${serverUrl}/${READER_ASSET_DIRECTORY}/reader-pdf.bin`;
    })().catch((error) => {
      readerPdfPreparation = null;
      throw error;
    });
  }

  return readerPdfPreparation;
}

/**
 * Prepare the expensive, book-independent reader pieces in the background.
 * This must never be awaited by app bootstrap: a reader failure must not hold
 * the rest of the application on the splash screen.
 */
export async function prewarmReader(): Promise<void> {
  await Promise.all([prepareReaderAsset(), prepareReaderHost()]);
}
