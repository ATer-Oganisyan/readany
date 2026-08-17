import { generateBookCoverImage } from "@/lib/narra/media";
import { generateId } from "@readany/core/utils";
import type { BookCoverGenerationInput } from "./cover-generation-contract";
import { deleteLocalCoverJob, getOrCreateLocalCoverJob } from "./cover-job-repository";

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

async function runBookCoverJob(
  input: BookCoverGenerationInput & { bookId: string },
): Promise<GeneratedBookCover> {
  const request = {
    book: {
      title: input.title,
      author: input.author,
      description: input.description,
      excerpt: input.excerpt,
      subjects: input.subjects,
    },
  };
  const localJob = await getOrCreateLocalCoverJob({
    bookId: input.bookId,
    requestId: generateId(),
    request,
  });

  const generated = await generateBookCoverImage(localJob.request, {
    requestId: localJob.requestId,
  });
  return {
    bytes: decodeBase64(generated.base64),
    mimeType: generated.mimeType,
    jobId: generated.jobId,
  };
}

/** The local intent survives JS reloads; generation runs in the Gateway queue. */
export function generateBookCover(
  input: BookCoverGenerationInput & { bookId: string },
): Promise<GeneratedBookCover> {
  return runBookCoverJob(input);
}

/** Remove the local intent only after the cover is safely stored on device. */
export async function acknowledgeGeneratedBookCover(
  bookId: string,
  _knownJobId?: string,
): Promise<void> {
  await deleteLocalCoverJob(bookId);
}
