import type { ChapterData } from "@readany/core/rag";
import type { Book } from "@readany/core/types";

export type AutoVectorizeCallback = (
  bookId: string,
  progress: { status: string; progress: number },
) => void;

interface ExtractorRef {
  extractChapters: (base64BookData: string, mimeType?: string) => Promise<ChapterData[]>;
}

interface QueueItem {
  book: Book;
  base64Data: string;
  mimeType: string;
}

let extractorRef: ExtractorRef | null = null;
let callback: AutoVectorizeCallback | null = null;
const queue: QueueItem[] = [];
let processing = false;
const queuedBookIds = new Set<string>();
const EXTRACTOR_WAIT_TIMEOUT_MS = 30_000;

export function setExtractorRef(ref: ExtractorRef | null) {
  extractorRef = ref;
}

export function setCallback(cb: AutoVectorizeCallback | null) {
  callback = cb;
}

export function isProcessing() {
  return processing;
}

export function getQueueLength() {
  return queue.length;
}

export async function queueBook(book: Book, base64Data: string, mimeType: string) {
  if (queuedBookIds.has(book.id)) return;

  queuedBookIds.add(book.id);
  queue.push({ book, base64Data, mimeType });
  if (!processing) {
    void processQueue();
  }
}

async function waitForExtractor(): Promise<ExtractorRef> {
  const deadline = Date.now() + EXTRACTOR_WAIT_TIMEOUT_MS;
  while (!extractorRef && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }

  if (!extractorRef) throw new Error("Timed out waiting for the extractor WebView");
  return extractorRef;
}

async function processQueue() {
  if (processing) return;
  processing = true;

  try {
    const { triggerVectorizeBook } = await import("./vectorize-trigger");

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const { book, base64Data, mimeType } = item;

      try {
        callback?.(book.id, { status: "extracting", progress: 0 });

        const extractor = await waitForExtractor();
        const chapters = await extractor.extractChapters(base64Data, mimeType);
        if (!chapters || chapters.length === 0) {
          throw new Error("No chapters were extracted from the book");
        }

        callback?.(book.id, { status: "vectorizing", progress: 0 });

        await triggerVectorizeBook(book.id, book.filePath, chapters, (progress) => {
          const pct =
            progress.totalChunks > 0 ? progress.processedChunks / progress.totalChunks : 0;
          callback?.(book.id, { status: "vectorizing", progress: pct });
        });

        callback?.(book.id, { status: "completed", progress: 1 });
      } catch (err) {
        console.error(`[AutoVectorize] Failed for ${book.meta.title}:`, err);
        callback?.(book.id, { status: "error", progress: 0 });
      } finally {
        queuedBookIds.delete(book.id);
      }
    }
  } finally {
    processing = false;
    if (queue.length > 0) void processQueue();
  }
}
