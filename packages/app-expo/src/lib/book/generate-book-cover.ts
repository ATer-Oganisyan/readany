import { generateBookCoverImage } from "@/lib/narra/media";
import { generateId } from "@readany/core/utils";
import coverGenerationConfig from "./cover-generation-config.json";
import { resolveCoverGenreProfile } from "./cover-genre";
import { deleteLocalCoverJob, getOrCreateLocalCoverJob } from "./cover-job-repository";
import { generatedCoverBackgroundColor } from "./cover-text-contrast";

const MAX_THEME_CHARS = 800;
const COVER_PROMPT_TEMPLATE = coverGenerationConfig.promptParagraphs.join("\n\n");

export interface GeneratedBookCover {
  bytes: Uint8Array;
  mimeType: string;
  jobId: string;
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

  const backgroundColor =
    input.accentColor1?.trim() || generatedCoverBackgroundColor({ title, author });

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

async function runBookCoverJob(input: {
  bookId: string;
  title: string;
  author?: string;
  description?: string;
  excerpt?: string;
  subjects?: string[];
}): Promise<GeneratedBookCover> {
  const prompt = coverPrompt(input);
  const localJob = await getOrCreateLocalCoverJob({
    bookId: input.bookId,
    requestId: generateId(),
    prompt,
  });

  const generated = await generateBookCoverImage(localJob.prompt, {
    requestId: localJob.requestId,
  });
  return {
    bytes: decodeBase64(generated.base64),
    mimeType: generated.mimeType,
    jobId: generated.jobId,
  };
}

/**
 * Direct OpenRouter cover generation. The local intent survives JS reloads;
 * the generated image is persisted on the device by the library store.
 */
export function generateBookCover(input: {
  bookId: string;
  title: string;
  author?: string;
  description?: string;
  excerpt?: string;
  subjects?: string[];
}): Promise<GeneratedBookCover> {
  return runBookCoverJob(input);
}

/** Remove the local intent only after the cover is safely stored on device. */
export async function acknowledgeGeneratedBookCover(
  bookId: string,
  _knownJobId?: string,
): Promise<void> {
  await deleteLocalCoverJob(bookId);
}
