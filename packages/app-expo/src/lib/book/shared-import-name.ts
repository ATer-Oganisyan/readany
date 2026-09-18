import { getBookImportFormat, getBookImportName } from "@readany/core/utils/book-import-format";

/** base64-префиксы сигнатур: `%PDF-` и `PK\x03\x04`. */
const MAGIC_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["JVBERi0", "pdf"],
  ["UEsDBB", "epub"],
];

/**
 * Имя для книги, пришедшей из шеринга: iOS отдаёт `file://` с настоящим именем,
 * Android — `content://<id>` без расширения, тогда формат берём из сигнатуры.
 * ponytail: любой ZIP считаем epub — fb2.zip и cbz из шеринга придут как epub
 * и не распарсятся; если понадобится, читать `mimetype` внутри архива.
 */
export function resolveSharedBookName(uri: string, headBase64: string): string {
  const name = getBookImportName(uri);
  try {
    getBookImportFormat(name);
    return name;
  } catch {
    const ext =
      MAGIC_PREFIXES.find(([signature]) => headBase64.startsWith(signature))?.[1] ?? "txt";
    return `book.${ext}`;
  }
}
