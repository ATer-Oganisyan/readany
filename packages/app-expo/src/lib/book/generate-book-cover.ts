import {
  acknowledgeBookCoverJob,
  generateBookCoverImage,
  type RemoteCoverJob,
} from "@/lib/narra/media";
import { generateId } from "@readany/core/utils";
import {
  deleteLocalCoverJob,
  getLocalCoverJob,
  getOrCreateLocalCoverJob,
  updateLocalCoverJob,
} from "./cover-job-repository";
import coverGenerationConfig from "./cover-generation-config.json";
import { resolveCoverGenreProfile } from "./cover-genre";

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

async function remoteJobUpdate(bookId: string, job: RemoteCoverJob): Promise<void> {
  await updateLocalCoverJob(bookId, {
    jobId: job.jobId,
    status: job.status,
    nextPollAt: Date.now() + job.pollAfterMs,
    expiresAt: job.expiresAt,
    errorCode: job.code,
    errorMessage: job.error,
  });
}

function isMissingRemoteJob(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return candidate.status === 404 || candidate.code === "NOT_FOUND";
}

async function runBookCoverJob(
  input: {
    bookId: string;
    title: string;
    author?: string;
    description?: string;
    excerpt?: string;
    subjects?: string[];
  },
  allowExpiredJobRecovery: boolean,
): Promise<GeneratedBookCover> {
  const prompt = coverPrompt(input);
  const localJob = await getOrCreateLocalCoverJob({
    bookId: input.bookId,
    requestId: generateId(),
    prompt,
  });

  try {
    const generated = await generateBookCoverImage(localJob.prompt, {
      requestId: localJob.requestId,
      jobId: localJob.jobId,
      onJob: (job) => remoteJobUpdate(input.bookId, job),
    });
    return {
      bytes: decodeBase64(generated.base64),
      mimeType: generated.mimeType,
      jobId: generated.jobId,
    };
  } catch (error) {
    // A server TTL may expire while the app is not opened for a long time.
    // Drop only that stale pointer; the next POST gets a fresh idempotency key.
    if (allowExpiredJobRecovery && localJob.jobId && isMissingRemoteJob(error)) {
      await deleteLocalCoverJob(input.bookId);
      return runBookCoverJob(input, false);
    }
    throw error;
  }
}

/**
 * Durable cover generation. The local intent and the server job id survive JS
 * reloads; provider fallback and retries are owned by the gateway worker.
 */
export function generateBookCover(input: {
  bookId: string;
  title: string;
  author?: string;
  description?: string;
  excerpt?: string;
  subjects?: string[];
}): Promise<GeneratedBookCover> {
  return runBookCoverJob(input, true);
}

/** Remove the durable result only after the cover is safely stored on device. */
export async function acknowledgeGeneratedBookCover(
  bookId: string,
  knownJobId?: string,
): Promise<void> {
  const localJob = await getLocalCoverJob(bookId);
  const jobId = knownJobId || localJob?.jobId;
  if (!jobId) {
    if (localJob) await deleteLocalCoverJob(bookId);
    return;
  }
  try {
    await acknowledgeBookCoverJob(jobId);
  } catch (error) {
    if (!isMissingRemoteJob(error)) throw error;
  }
  await deleteLocalCoverJob(bookId);
}
