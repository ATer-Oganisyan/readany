import type { BookMetadataIdentitySource } from "./metadata-extractor";

const MAX_TITLE_CHARS = 180;
const MAX_AUTHOR_CHARS = 180;

export type BookIdentitySource =
  | BookMetadataIdentitySource
  | "operator"
  | "metadata-unknown"
  | "llm";

export interface BookIdentityCandidate {
  field: "title" | "author";
  value: string;
  source: BookIdentitySource;
  confidence: number;
}

export interface BookIdentityResolution {
  title: string;
  author: string;
  provenance: {
    title: BookIdentitySource;
    author: BookIdentitySource;
  };
  candidates: BookIdentityCandidate[];
  llmStatus: "not-needed" | "used" | "unavailable" | "failed";
}

export interface BookIdentityInput {
  fileName: string;
  detectedTitle?: string;
  detectedAuthor?: string;
  provenance?: Partial<Record<"title" | "author", BookIdentitySource>>;
  excerpt?: string;
  forceLlm?: boolean;
}

export interface LlmBookIdentityCandidate {
  title: string;
  author?: string;
}

const SOURCE_CONFIDENCE: Record<BookIdentitySource, number> = {
  operator: 1,
  "epub-opf": 0.98,
  "fb2-title-info": 0.98,
  "mobi-header": 0.94,
  "metadata-unknown": 0.72,
  llm: 0.82,
  filename: 0.35,
  missing: 0,
};

function normalizedFileStem(fileName: string): string {
  return (
    normalizeBookIdentityValue(fileName.replace(/\.[^.]+$/u, ""), MAX_TITLE_CHARS) || "Untitled"
  );
}

export function normalizeBookIdentityValue(value: unknown, maxChars = MAX_TITLE_CHARS): string {
  if (typeof value !== "string") return "";
  return Array.from(
    value
      .normalize("NFC")
      .replace(/[\p{Cc}\u200B\u202A-\u202E\u2066-\u2069\uFEFF]+/gu, " ")
      .replace(/[\p{Z}\s]+/gu, " ")
      .trim(),
  )
    .slice(0, maxChars)
    .join("");
}

export function isTechnicalBookTitle(title: string): boolean {
  const value = normalizeBookIdentityValue(title);
  if (!value) return true;
  if (/^\d{5,}$/u.test(value)) return true;
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) return true;
  if (/^[0-9a-f]{16,}$/iu.test(value)) return true;
  if (/^(?:https?|file|content):/iu.test(value)) return true;
  return /^(?:book|книга|untitled|без названия)(?:[-_\s]*\d+)?$/iu.test(value);
}

export function isSuspiciousBookTitle(
  title: string,
  fileName: string,
  source?: BookIdentitySource,
): boolean {
  if (isTechnicalBookTitle(title)) return true;
  if (source) return source === "filename" || source === "missing";
  return (
    normalizeBookIdentityValue(title).toLocaleLowerCase() ===
    normalizedFileStem(fileName).toLocaleLowerCase()
  );
}

function inferredSource(
  value: string,
  fileName: string,
  declared: BookIdentitySource | undefined,
): BookIdentitySource {
  if (declared && declared !== "missing") return declared;
  if (
    normalizeBookIdentityValue(value).toLocaleLowerCase() ===
    normalizedFileStem(fileName).toLocaleLowerCase()
  ) {
    return "filename";
  }
  return declared ?? "metadata-unknown";
}

function addCandidate(
  candidates: BookIdentityCandidate[],
  field: BookIdentityCandidate["field"],
  rawValue: unknown,
  source: BookIdentitySource,
): void {
  const value = normalizeBookIdentityValue(
    rawValue,
    field === "title" ? MAX_TITLE_CHARS : MAX_AUTHOR_CHARS,
  );
  if (!value || source === "missing") return;
  const technicalPenalty = field === "title" && isTechnicalBookTitle(value) ? 0.05 : 1;
  const confidence = SOURCE_CONFIDENCE[source] * technicalPenalty;
  const duplicate = candidates.find(
    (candidate) =>
      candidate.field === field &&
      candidate.value.toLocaleLowerCase() === value.toLocaleLowerCase(),
  );
  if (duplicate) {
    if (confidence > duplicate.confidence) {
      duplicate.source = source;
      duplicate.confidence = confidence;
    }
    return;
  }
  candidates.push({ field, value, source, confidence });
}

function bestCandidate(
  candidates: BookIdentityCandidate[],
  field: BookIdentityCandidate["field"],
): BookIdentityCandidate | undefined {
  return candidates
    .filter((candidate) => candidate.field === field)
    .sort((left, right) => right.confidence - left.confidence)[0];
}

function resolveCandidates(
  input: BookIdentityInput,
  llmCandidate?: LlmBookIdentityCandidate,
): BookIdentityResolution {
  const candidates: BookIdentityCandidate[] = [];
  const fileTitle = normalizedFileStem(input.fileName);
  const detectedTitle = normalizeBookIdentityValue(input.detectedTitle);
  const detectedAuthor = normalizeBookIdentityValue(input.detectedAuthor, MAX_AUTHOR_CHARS);

  if (detectedTitle) {
    addCandidate(
      candidates,
      "title",
      detectedTitle,
      inferredSource(detectedTitle, input.fileName, input.provenance?.title),
    );
  }
  addCandidate(candidates, "title", fileTitle, "filename");

  if (detectedAuthor) {
    addCandidate(
      candidates,
      "author",
      detectedAuthor,
      input.provenance?.author && input.provenance.author !== "missing"
        ? input.provenance.author
        : "metadata-unknown",
    );
  }

  if (llmCandidate) {
    addCandidate(candidates, "title", llmCandidate.title, "llm");
    addCandidate(candidates, "author", llmCandidate.author, "llm");
  }

  const title = bestCandidate(candidates, "title") ?? {
    field: "title" as const,
    value: "Untitled",
    source: "missing" as const,
    confidence: 0,
  };
  const author = bestCandidate(candidates, "author");
  return {
    title: title.value,
    author: author?.value ?? "",
    provenance: {
      title: title.source,
      author: author?.source ?? "missing",
    },
    candidates,
    llmStatus: llmCandidate ? "used" : "not-needed",
  };
}

export function resolveBookIdentityDeterministically(
  input: BookIdentityInput,
): BookIdentityResolution {
  return resolveCandidates(input);
}

export function bookIdentityNeedsLlmRepair(resolution: BookIdentityResolution): boolean {
  return (
    isTechnicalBookTitle(resolution.title) ||
    resolution.provenance.title === "filename" ||
    resolution.provenance.title === "missing" ||
    !resolution.author
  );
}

export async function resolveBookIdentityWithLlmFallback(
  input: BookIdentityInput,
  generateWithLlm: (input: {
    fileName: string;
    detectedTitle?: string;
    detectedAuthor?: string;
    excerpt?: string;
  }) => Promise<LlmBookIdentityCandidate | null>,
): Promise<BookIdentityResolution> {
  const deterministic = resolveCandidates(input);
  if (!input.forceLlm && !bookIdentityNeedsLlmRepair(deterministic)) return deterministic;

  try {
    const generated = await generateWithLlm({
      fileName: input.fileName,
      detectedTitle: deterministic.title,
      detectedAuthor: deterministic.author,
      excerpt: normalizeBookIdentityValue(input.excerpt, 6_000),
    });
    if (!generated) return { ...deterministic, llmStatus: "unavailable" };
    return resolveCandidates(input, generated);
  } catch {
    return { ...deterministic, llmStatus: "failed" };
  }
}
