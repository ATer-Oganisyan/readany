import { serifTextFontAssets, serifTextFontFamily } from "@deslop/primitives/native";
import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";

const READER_FONT_DIRECTORY = "readany-fonts";

export const DEFAULT_READER_FONT_FAMILY = serifTextFontFamily.regular;

const READER_FONT_FILES = [
  {
    asset: serifTextFontAssets.regular,
    fileName: "SBSerifText-Regular.otf",
    family: DEFAULT_READER_FONT_FAMILY,
    weight: 400,
    style: "normal",
  },
  {
    asset: serifTextFontAssets.italic,
    fileName: "SBSerifText-Italic.otf",
    family: DEFAULT_READER_FONT_FAMILY,
    weight: 400,
    style: "italic",
  },
  {
    asset: serifTextFontAssets.bold,
    fileName: "SBSerifText-Bold.otf",
    family: DEFAULT_READER_FONT_FAMILY,
    weight: 700,
    style: "normal",
  },
  {
    asset: serifTextFontAssets.boldItalic,
    fileName: "SBSerifText-BoldItalic.otf",
    family: DEFAULT_READER_FONT_FAMILY,
    weight: 700,
    style: "italic",
  },
] as const;

let bundledFontsReady: Promise<void> | null = null;

async function ensureBundledReaderFonts(): Promise<void> {
  if (bundledFontsReady) return bundledFontsReady;

  bundledFontsReady = (async () => {
    const fontsDirectoryUri = `${Paths.document.uri.replace(/\/$/, "")}/${READER_FONT_DIRECTORY}`;
    const fontsDirectory = new Directory(fontsDirectoryUri);
    if (!fontsDirectory.exists) {
      fontsDirectory.create({ intermediates: true });
    }

    await Promise.all(
      READER_FONT_FILES.map(async ({ asset: moduleId, fileName }) => {
        const asset = Asset.fromModule(moduleId);
        await asset.downloadAsync();
        const sourceUri = asset.localUri ?? asset.uri;
        const sourceFile = new File(sourceUri);
        const destinationFile = new File(`${fontsDirectoryUri}/${fileName}`);

        if (destinationFile.exists && destinationFile.size === sourceFile.size) return;
        if (destinationFile.exists) destinationFile.delete();
        sourceFile.copy(destinationFile);
      }),
    );
  })().catch((error) => {
    bundledFontsReady = null;
    throw error;
  });

  return bundledFontsReady;
}

export async function getBundledReaderFontFaceCSS(localServerUrl: string): Promise<string> {
  await ensureBundledReaderFonts();
  const baseUrl = localServerUrl.replace(/\/$/, "");

  return READER_FONT_FILES.map(
    ({ fileName, family, weight, style }) => `@font-face {
  font-family: ${JSON.stringify(family)};
  src: url('${baseUrl}/${READER_FONT_DIRECTORY}/${encodeURIComponent(fileName)}') format('opentype');
  font-weight: ${weight};
  font-style: ${style};
  font-display: swap;
}`,
  ).join("\n");
}
