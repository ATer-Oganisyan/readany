import {
  interfaceFontAssets,
  interfaceFontFamily,
  serifTextFontAssets,
  serifTextFontFamily,
} from "@deslop/primitives/native";
import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";

const READER_FONT_DIRECTORY = "readany-fonts";

export const DEFAULT_READER_FONT_FAMILY = serifTextFontFamily.regular;
export const SB_SANS_READER_FONT_ID = "__bundled_sb_sans__";
export const SB_SANS_READER_FONT_FAMILY = interfaceFontFamily.regular;

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
  {
    asset: interfaceFontAssets[interfaceFontFamily.regular],
    fileName: "SBSansUI-Regular.otf",
    family: SB_SANS_READER_FONT_FAMILY,
    weight: 400,
    style: "normal",
  },
  {
    asset: interfaceFontAssets[interfaceFontFamily.semibold],
    fileName: "SBSansUI-Semibold.otf",
    family: SB_SANS_READER_FONT_FAMILY,
    weight: 600,
    style: "normal",
  },
  {
    asset: interfaceFontAssets[interfaceFontFamily.bold],
    fileName: "SBSansUI-Bold.otf",
    family: SB_SANS_READER_FONT_FAMILY,
    weight: 700,
    style: "normal",
  },
] as const;

export function getBundledReaderFontFamily(selectedFontId: string | null): string | null {
  if (!selectedFontId) return DEFAULT_READER_FONT_FAMILY;
  if (selectedFontId === SB_SANS_READER_FONT_ID) return SB_SANS_READER_FONT_FAMILY;
  return null;
}

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
  font-display: block;
}`,
  ).join("\n");
}
