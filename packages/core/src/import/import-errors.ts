/** Stable, locale-independent categories; callers must not display raw parser/I/O messages. */
export type BookImportFailureCode =
  | "UNSUPPORTED_FORMAT"
  | "EMPTY_SOURCE"
  | "CORRUPT_SOURCE"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_UNAVAILABLE"
  | "STORAGE_FAILED"
  | "CONTENT_BLOCKED"
  | "UNKNOWN";

// Interface merging keeps this type-only on ES2020 and in Expo's Babel pipeline.
// A class `declare` field is not accepted by the current Metro Flow-strip pass.
export interface BookImportError {
  cause?: unknown;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: optional cause is intentionally absent unless defined non-enumerably by the constructor.
export class BookImportError extends Error {
  constructor(
    readonly code: BookImportFailureCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "BookImportError";
    if (options && "cause" in options) {
      // Preserve native Error cause semantics without requiring an ES2022 lib
      // or a two-argument Error constructor on every supported runtime.
      Object.defineProperty(this, "cause", {
        value: options.cause,
        writable: true,
        configurable: true,
      });
    }
  }
}

export function getBookImportFailureCode(error: unknown): BookImportFailureCode | undefined {
  return error instanceof BookImportError ? error.code : undefined;
}
