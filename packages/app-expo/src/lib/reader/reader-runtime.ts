import { getPlatformService } from "@readany/core/services";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";

import { getBundledReaderFontFaceCSS } from "./bundled-reader-font";
import { startFileServer } from "./local-file-server";

const READER_HTML_ASSET = Asset.fromModule(require("../../../assets/reader/reader.html"));
const READER_PDF_ASSET = Asset.fromModule(require("../../../assets/reader/reader-pdf.bin"));
const READER_ASSET_DIRECTORY = "readany-reader-assets";

let readerAssetPreparation: Promise<string> | null = null;
let readerHostPreparation: Promise<{ serverUrl: string; fontFaceCSS: string }> | null = null;
let readerPdfPreparation: Promise<string> | null = null;

export function prepareReaderAsset(): Promise<string> {
  if (!readerAssetPreparation) {
    readerAssetPreparation = READER_HTML_ASSET.downloadAsync()
      .then((asset) => asset.localUri || asset.uri)
      .catch((error) => {
        readerAssetPreparation = null;
        throw error;
      });
  }

  return readerAssetPreparation;
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
