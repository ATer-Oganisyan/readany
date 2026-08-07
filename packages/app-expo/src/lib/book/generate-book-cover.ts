import { generateBookCoverImage } from "@/lib/narra/media";
import coverGenerationConfig from "./cover-generation-config.json";
import { resolveCoverGenreProfile } from "./cover-genre";

const MAX_THEME_CHARS = 800;
const COVER_PROMPT_TEMPLATE = coverGenerationConfig.promptParagraphs.join("\n\n");

export interface GeneratedBookCover {
  bytes: Uint8Array;
  mimeType: string;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function coverPrompt(input: {
  title: string;
  author?: string;
  description?: string;
  excerpt?: string;
  subjects?: string[];
  metaphor?: string;
  imageType?: string;
  accentColor1?: string;
  accentColor2?: string;
}) {
  const title = input.title.trim() || "Untitled book";
  const author = input.author?.trim() || "Unknown author";
  const themeSource = input.description?.trim() || input.excerpt?.trim();
  const theme = themeSource
    ? themeSource.replace(/\s+/gu, " ").slice(0, MAX_THEME_CHARS)
    : "Infer the central idea, mood, symbols and historical context from the title and author without reproducing their names as text.";
  const genre = resolveCoverGenreProfile(input);

  const colorSeed = Array.from(`${title}:${author}`).reduce(
    (hash, character) => (hash * 31 + (character.codePointAt(0) || 0)) >>> 0,
    0,
  );
  const backgroundColor =
    input.accentColor1?.trim() ||
    coverGenerationConfig.backgroundColors[
      colorSeed % coverGenerationConfig.backgroundColors.length
    ];

  const replacements: Record<string, string> = {
    "{{BOOK_TITLE}}": title,
    "{{AUTHOR}}": author,
    "{{BOOK_DESCRIPTION}}": theme,
    "{{BOOK_GENRE}}": genre.label,
    "{{GENRE_ART_DIRECTION}}": genre.artDirection,
    "{{BACKGROUND_COLOR}}": backgroundColor,
  };

  return Object.entries(replacements).reduce(
    (prompt, [placeholder, value]) => prompt.replaceAll(placeholder, value),
    COVER_PROMPT_TEMPLATE,
  );
}

/**
 * Генерация обложки через Narra gateway (/v2/media/cover, installation auth).
 * Клиент отправляет только промпт: ключи, модель и фолбэк живут на сервере.
 */
export async function generateBookCover(input: {
  title: string;
  author?: string;
  description?: string;
  excerpt?: string;
  subjects?: string[];
}): Promise<GeneratedBookCover> {
  const generated = await generateBookCoverImage(coverPrompt(input));
  return {
    bytes: decodeBase64(generated.base64),
    mimeType: generated.mimeType,
  };
}
