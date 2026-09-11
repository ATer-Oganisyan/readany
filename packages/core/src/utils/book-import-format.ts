import type { Book } from "../types/book";

const formats = new Set<Book["format"]>([
  "epub",
  "pdf",
  "mobi",
  "azw",
  "azw3",
  "cbz",
  "fb2",
  "fbz",
  "txt",
  "umd",
]);

/** Picker names and filesystem paths are literal; only URI path segments are encoded. */
export function getBookImportName(path: string, name?: string): string {
  if (name) return name;
  const filename = path.replace(/\\/g, "/").split("/").pop() || "book";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return filename;
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

export function getBookImportFormat(name: string): Book["format"] {
  const normalized = name.trim().toLowerCase();
  if (normalized.endsWith(".fb2.zip")) return "fbz";
  const extension = normalized.split(".").pop() as Book["format"];
  if (!normalized.includes(".") || !formats.has(extension)) {
    throw new Error(`Unsupported book format: ${name}`);
  }
  return extension;
}
