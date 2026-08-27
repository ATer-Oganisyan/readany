import { getPlatformService } from "@readany/core/services";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import readerBuild from "../../../assets/reader/reader-build.json";

import { diagnosticErrorReason, recordDiagnostic } from "../diagnostics/diagnostics";
import { getBundledReaderFontFaceCSS } from "./bundled-reader-font";
import { startFileServer } from "./local-file-server";
import { createReaderAssetLoader } from "./reader-asset";
import { createReaderHostManager, withTimeout } from "./reader-host-manager";

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
const HEALTH_FILE = ".narra-reader-health";
const healthToken = `narra-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let healthProbeSequence = 0;
let readerPdfPreparation: Promise<void> | null = null;
const readerHost = createReaderHostManager({
  async start(restart, fallback) {
    recordDiagnostic("server_start", { restart, fallback });
    const appData = await getPlatformService().getAppDataDir();
    await FileSystem.writeAsStringAsync(
      `${appData.replace(/\/$/, "")}/${HEALTH_FILE}`,
      healthToken,
    );
    return startFileServer(appData, { restart, fallback });
  },
  async probe(url) {
    const controller = new AbortController();
    try {
      const ok = await withTimeout(
        (async () => {
          const response = await fetch(`${url}/${HEALTH_FILE}?probe=${++healthProbeSequence}`, {
            signal: controller.signal,
            cache: "no-store",
          });
          return response.ok && (await response.text()) === healthToken;
        })(),
        1500,
      );
      recordDiagnostic("server_probe", { ok });
      return ok;
    } catch (error) {
      recordDiagnostic("server_probe", { ok: false, reason: diagnosticErrorReason(error) });
      return false;
    } finally {
      controller.abort();
    }
  },
  fonts: getBundledReaderFontFaceCSS,
  recovered: () => recordDiagnostic("server_recovered"),
});

export function prepareReaderAsset(): Promise<string> {
  const asset = Asset.fromModule(require("../../../assets/reader/reader.html"));
  return loadReaderAsset(asset.uri || asset.localUri || "", READER_BUILD_ID);
}

export function prepareReaderHost(restart = false) {
  return readerHost.prepare(restart).catch((error) => {
    recordDiagnostic("server_failed", { reason: diagnosticErrorReason(error) });
    throw error;
  });
}

/** PDF is the large optional reader engine. EPUB opens never download it. */
export async function prepareReaderPdfEngineUri(serverUrl?: string): Promise<string> {
  if (!readerPdfPreparation) {
    readerPdfPreparation = (async () => {
      const [asset, platform] = await Promise.all([
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
    })().catch((error) => {
      readerPdfPreparation = null;
      throw error;
    });
  }

  await readerPdfPreparation;
  const url = serverUrl ?? (await prepareReaderHost()).serverUrl;
  return `${url}/${READER_ASSET_DIRECTORY}/reader-pdf.bin`;
}

/**
 * Prepare the expensive, book-independent reader pieces in the background.
 * This must never be awaited by app bootstrap: a reader failure must not hold
 * the rest of the application on the splash screen.
 */
export async function prewarmReader(): Promise<void> {
  await Promise.all([prepareReaderAsset(), prepareReaderHost()]);
}
