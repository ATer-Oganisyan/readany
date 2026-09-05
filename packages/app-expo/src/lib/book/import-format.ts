import { BookImportError } from "@readany/core/import/import-errors";
import type { Book } from "@readany/core/types";

/** Shared by first import and missing-file repair; providers use several ZIP/CBZ aliases. */
export const BOOK_IMPORT_MIME_TYPES = [
  "application/epub+zip",
  "application/pdf",
  "application/x-mobipocket-ebook",
  "application/vnd.amazon.ebook",
  "application/vnd.comicbook+zip",
  "application/x-cbz",
  "application/x-fictionbook+xml",
  "application/x-fictionbook+zip",
  "application/zip",
  "text/plain",
  "application/octet-stream",
];

/** iOS Files may display dynamic book UTIs but refuse single-file selection
 * with MIME filters (CBZ reproduced on iOS 26.5). Keep source admission in the
 * extension/content validator; do not trust a provider's incomplete UTI map.
 */
export function bookImportPickerTypes(platform: string): string[] {
  return platform === "ios" ? ["*/*"] : BOOK_IMPORT_MIME_TYPES;
}

export const BOOK_IMPORT_FORMATS: Readonly<Record<string, Book["format"]>> = {
  epub: "epub",
  pdf: "pdf",
  mobi: "mobi",
  azw: "azw",
  azw3: "azw3",
  cbz: "cbz",
  fb2: "fb2",
  fbz: "fbz",
  "fb2.zip": "fbz",
  txt: "txt",
  umd: "umd",
};

export function importFileName(file: { uri: string; name?: string }): string {
  // Document providers return a display name, not an encoded URL component.
  if (file.name) return file.name;
  const leaf = file.uri.split("/").pop() || "book";
  try {
    return decodeURIComponent(leaf);
  } catch {
    return leaf;
  }
}

export function bookImportFormat(name: string): Book["format"] {
  const extension = name.toLowerCase().endsWith(".fb2.zip")
    ? "fb2.zip"
    : name.split(".").pop()?.toLowerCase() || "";
  const format = Object.hasOwn(BOOK_IMPORT_FORMATS, extension)
    ? BOOK_IMPORT_FORMATS[extension]
    : undefined;
  if (!format)
    throw new BookImportError(
      "UNSUPPORTED_FORMAT",
      "Этот формат книги не поддерживается. Выберите EPUB, PDF, FB2, TXT или другой поддерживаемый формат книги.",
    );
  return format;
}
