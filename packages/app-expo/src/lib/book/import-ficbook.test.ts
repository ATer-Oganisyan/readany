import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FICBOOK_ORIGIN,
  FicbookImportError,
  buildFicbookEpub,
  contentHtmlToParagraphs,
  decodeHtmlEntities,
  importFicbookFromUrl,
  parseFicbookChapterPage,
  parseFicbookUrl,
  parseFicbookWorkPage,
} from "./import-ficbook";
import { extractEpubMetadata, extractFb2Metadata } from "./metadata-extractor";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const workMultiHtml = readFileSync(join(fixturesDir, "ficbook-work-multi.html"), "utf-8");
const workSingleHtml = readFileSync(join(fixturesDir, "ficbook-work-single.html"), "utf-8");
const chapterHtml = readFileSync(join(fixturesDir, "ficbook-chapter.html"), "utf-8");

describe("parseFicbookUrl", () => {
  it("распознаёт ссылку на фанфик с числовым id", () => {
    expect(parseFicbookUrl("https://ficbook.net/readfic/13141244")).toEqual({
      workId: "13141244",
    });
  });

  it("распознаёт ссылку на конкретную главу", () => {
    expect(parseFicbookUrl("https://ficbook.net/readfic/13141244/33732395")).toEqual({
      workId: "13141244",
      chapterId: "33732395",
    });
  });

  it("распознаёт uuid-id новых работ и www-хост", () => {
    expect(
      parseFicbookUrl("https://www.ficbook.net/readfic/019ed481-eb8d-70f3-b754-08f5afd6aeca"),
    ).toEqual({ workId: "019ed481-eb8d-70f3-b754-08f5afd6aeca" });
  });

  it("служебные подстраницы (comments, download) сводит к самой работе", () => {
    expect(parseFicbookUrl("https://ficbook.net/readfic/424179/comments")).toEqual({
      workId: "424179",
    });
    expect(parseFicbookUrl("https://ficbook.net/readfic/424179/download")).toEqual({
      workId: "424179",
    });
  });

  it("игнорирует query и якорь", () => {
    expect(
      parseFicbookUrl("https://ficbook.net/readfic/5341488?from_promo=1#part_content"),
    ).toEqual({ workId: "5341488" });
  });

  it("возвращает null для чужих и нефанфичных ссылок", () => {
    expect(parseFicbookUrl("https://example.com/readfic/123")).toBeNull();
    expect(parseFicbookUrl("https://ficbook.net/authors/136398")).toBeNull();
    expect(parseFicbookUrl("https://ficbook.net/readfic/not-an-id")).toBeNull();
    expect(parseFicbookUrl("ftp://ficbook.net/readfic/123")).toBeNull();
    expect(parseFicbookUrl("не ссылка")).toBeNull();
  });
});

describe("decodeHtmlEntities / contentHtmlToParagraphs", () => {
  it("декодирует именованные, десятичные и hex-сущности", () => {
    expect(decodeHtmlEntities("&laquo;Тест&raquo; &amp; &#1072;&#x430;")).toBe("«Тест» & аа");
  });

  it("режет текст главы на абзацы, убирая nbsp-отступы и теги", () => {
    const html =
      '&nbsp;&nbsp;&nbsp;Первый абзац.\n&nbsp;&nbsp;&nbsp;Второй<span class="footnote"></span> абзац.\n\n';
    expect(contentHtmlToParagraphs(html)).toEqual(["Первый абзац.", "Второй абзац."]);
  });
});

describe("parseFicbookWorkPage", () => {
  it("разбирает многочастный фанфик: шапка, аннотация, обложка, оглавление", () => {
    const work = parseFicbookWorkPage(workMultiHtml, "13141244");

    expect(work.title).toBe("Удивительные приключения «Фоксглав»");
    expect(work.author).toBe("Yuliya Yako");
    expect(work.description).toBe(
      "Том Риддл мечтал создать второй крестраж & завоевать волшебный мир.\nНо это было вчера.",
    );
    expect(work.coverUrl).toBe(
      "https://assets.teinon.net/fanfic-covers/m_ilQroxZ2hswlsMaJRyQDCQ5SuZYpestS.webp",
    );
    expect(work.inlineChapter).toBeNull();
    expect(work.chapters).toEqual([
      {
        url: `${FICBOOK_ORIGIN}/readfic/13141244/33732395`,
        title: "Глава 1. Волшебная фибула",
      },
      {
        url: `${FICBOOK_ORIGIN}/readfic/13141244/33732677`,
        title: "Глава 2. Вальпургиевы рыцари",
      },
    ]);
  });

  it("кнопка «Начать читать» не попадает в оглавление (дубль первой главы)", () => {
    const work = parseFicbookWorkPage(workMultiHtml, "13141244");
    const urls = work.chapters.map((chapter) => chapter.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("одночастный фанфик: главы нет в оглавлении, текст берётся со страницы", () => {
    const work = parseFicbookWorkPage(workSingleHtml, "424179");

    expect(work.title).toBe("Дураки");
    expect(work.author).toBe("Безумный рифмоплет");
    expect(work.chapters).toEqual([]);
    expect(work.inlineChapter).not.toBeNull();
    expect(work.inlineChapter?.title).toBe("Часть 1");
    expect(work.inlineChapter?.paragraphs).toHaveLength(4);
    expect(work.inlineChapter?.paragraphs[0]).toBe("- Эй, где мой Шут? - спросил Король вельможу.");
  });

  it("дефолтная og:image сайта не считается обложкой", () => {
    const work = parseFicbookWorkPage(workSingleHtml, "424179");
    expect(work.coverUrl).toBeNull();
  });

  it("страница без заголовка — ошибка парсинга", () => {
    expect(() => parseFicbookWorkPage("<html><body>challenge</body></html>", "1")).toThrowError(
      FicbookImportError,
    );
  });
});

describe("parseFicbookChapterPage", () => {
  it("разбирает страницу главы: название и абзацы, промо-вставка выброшена", () => {
    const chapter = parseFicbookChapterPage(chapterHtml);

    expect(chapter.title).toBe("Глава 1. Волшебная фибула");
    expect(chapter.paragraphs).toEqual([
      "Она не раз задумывалась, какой именно момент считать началом новой жизни.",
      "— И последний на сегодня студент.",
      "…В одиннадцать лет она начала учиться магии в школе Ильверморни. Тогда у неё впервые появилась палочка & сова.",
    ]);
    expect(chapter.paragraphs.join(" ")).not.toContain("Промо");
  });

  it("страница без блока текста — ошибка парсинга", () => {
    expect(() => parseFicbookChapterPage("<html><body>нет текста</body></html>")).toThrowError(
      FicbookImportError,
    );
  });
});

describe("buildFicbookEpub", () => {
  const input = {
    workId: "13141244",
    title: "Удивительные приключения «Фоксглав»",
    author: "Yuliya Yako",
    description: "Аннотация фанфика.\nВторая строка.",
    chapters: [
      { title: "Глава 1", paragraphs: ["Первый абзац.", "Второй абзац."] },
      { title: "Глава 2", paragraphs: ["Текст второй главы."] },
    ],
    cover: { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x01]), mimeType: "image/jpeg" },
  };

  it("метаданные EPUB читаются штатным экстрактором импорта", async () => {
    const epubBytes = buildFicbookEpub(input);
    const meta = await extractEpubMetadata(epubBytes);

    expect(meta.title).toBe("Удивительные приключения «Фоксглав»");
    expect(meta.author).toBe("Yuliya Yako");
    expect(meta.identityProvenance).toEqual({ title: "epub-opf", author: "epub-opf" });
    expect(meta.description).toContain("Аннотация фанфика.");
    expect(meta.textSample).toContain("Первый абзац.");
    expect(meta.language).toBe("ru");
    expect(meta.coverBytes).toEqual(input.cover.bytes);
  });

  it("главы лежат отдельными XHTML со своими названиями", () => {
    const text = new TextDecoder().decode(buildFicbookEpub(input));

    expect(text).toContain("OEBPS/chapter1.xhtml");
    expect(text).toContain("OEBPS/chapter2.xhtml");
    expect(text).toContain("<h2>Глава 2</h2>");
    expect(text).toContain("<p>Первый абзац.</p>");
    expect(text).toContain("<navLabel><text>Глава 1</text></navLabel>");
  });

  it("без обложки в манифесте нет cover-image", () => {
    const text = new TextDecoder().decode(buildFicbookEpub({ ...input, cover: null }));
    expect(text).not.toContain("cover-image");
  });
});

describe("extractFb2Metadata", () => {
  it("читает и дедуплицирует жанры из title-info", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <FictionBook><description><title-info>
        <genre>sf_fantasy</genre><genre>sf_fantasy</genre><genre>adventure</genre>
        <book-title>Книга</book-title>
      </title-info></description><body><section><p>Текст.</p></section></body></FictionBook>`;

    const meta = extractFb2Metadata(new TextEncoder().encode(xml));

    expect(meta.subjects).toEqual(["sf_fantasy", "adventure"]);
    expect(meta.identityProvenance).toEqual({ title: "fb2-title-info", author: "missing" });
  });

  it("marks the filename as fallback when FB2 title-info has no title", () => {
    const xml = "<FictionBook><description><title-info /></description><body /></FictionBook>";
    const meta = extractFb2Metadata(new TextEncoder().encode(xml), "fallback.fb2");

    expect(meta.title).toBe("fallback");
    expect(meta.identityProvenance).toEqual({ title: "filename", author: "missing" });
  });
});

describe("importFicbookFromUrl (сеть замокана)", () => {
  const coverBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);

  function createFetchMock(pages: Record<string, string>, calls: string[]) {
    return async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      calls.push(url);
      if (url.includes("fanfic-covers")) {
        return new Response(coverBytes, {
          status: 200,
          headers: { "content-type": "image/webp" },
        });
      }
      const html = pages[url];
      if (!html) {
        return new Response("not found", { status: 404 });
      }
      return new Response(html, { status: 200 });
    };
  }

  it("многочастный фанфик: главы качаются по очереди, EPUB собран", async () => {
    const calls: string[] = [];
    const fetchImpl = createFetchMock(
      {
        [`${FICBOOK_ORIGIN}/readfic/13141244`]: workMultiHtml,
        [`${FICBOOK_ORIGIN}/readfic/13141244/33732395`]: chapterHtml,
        [`${FICBOOK_ORIGIN}/readfic/13141244/33732677`]: chapterHtml,
      },
      calls,
    ) as typeof globalThis.fetch;

    const result = await importFicbookFromUrl("https://ficbook.net/readfic/13141244", {
      fetchImpl,
      chapterDelayMs: 0,
    });

    expect(result.title).toBe("Удивительные приключения «Фоксглав»");
    expect(result.chapterCount).toBe(2);
    expect(result.fileName).toBe("Удивительные приключения «Фоксглав».epub");
    expect(calls.slice(0, 3)).toEqual([
      `${FICBOOK_ORIGIN}/readfic/13141244`,
      `${FICBOOK_ORIGIN}/readfic/13141244/33732395`,
      `${FICBOOK_ORIGIN}/readfic/13141244/33732677`,
    ]);

    const meta = await extractEpubMetadata(result.epubBytes);
    expect(meta.description).toContain("Том Риддл");
    expect(meta.coverBytes).toEqual(coverBytes);
    expect(meta.coverMimeType).toBe("image/webp");
  });

  it("одночастный фанфик собирается без дополнительных запросов глав", async () => {
    const calls: string[] = [];
    const fetchImpl = createFetchMock(
      { [`${FICBOOK_ORIGIN}/readfic/424179`]: workSingleHtml },
      calls,
    ) as typeof globalThis.fetch;

    const result = await importFicbookFromUrl("https://ficbook.net/readfic/424179", {
      fetchImpl,
      chapterDelayMs: 0,
    });

    expect(result.chapterCount).toBe(1);
    expect(calls).toEqual([`${FICBOOK_ORIGIN}/readfic/424179`]);

    const meta = await extractEpubMetadata(result.epubBytes);
    expect(meta.title).toBe("Дураки");
    expect(meta.coverBytes).toBeNull();
  });

  it("ссылка на главу импортирует весь фанфик целиком", async () => {
    const calls: string[] = [];
    const fetchImpl = createFetchMock(
      { [`${FICBOOK_ORIGIN}/readfic/424179`]: workSingleHtml },
      calls,
    ) as typeof globalThis.fetch;

    const result = await importFicbookFromUrl("https://ficbook.net/readfic/424179/123", {
      fetchImpl,
      chapterDelayMs: 0,
    });
    expect(result.title).toBe("Дураки");
    expect(calls[0]).toBe(`${FICBOOK_ORIGIN}/readfic/424179`);
  });

  it.each([
    [403, "ficbook-blocked"],
    [429, "ficbook-blocked"],
    [404, "ficbook-not-found"],
    [500, "ficbook-network"],
  ])("статус %i превращается в ошибку %s", async (status, code) => {
    const fetchImpl = (async () =>
      new Response("blocked", { status })) as unknown as typeof globalThis.fetch;

    await expect(
      importFicbookFromUrl("https://ficbook.net/readfic/13141244", {
        fetchImpl,
        chapterDelayMs: 0,
      }),
    ).rejects.toMatchObject({ name: "FicbookImportError", message: code });
  });

  it("обрыв сети — ошибка ficbook-network", async () => {
    const fetchImpl = (async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof globalThis.fetch;

    await expect(
      importFicbookFromUrl("https://ficbook.net/readfic/13141244", {
        fetchImpl,
        chapterDelayMs: 0,
      }),
    ).rejects.toMatchObject({ message: "ficbook-network" });
  });

  it("недоступная обложка не ломает импорт", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("fanfic-covers")) {
        return new Response("gone", { status: 404 });
      }
      if (url === `${FICBOOK_ORIGIN}/readfic/13141244`) {
        return new Response(workMultiHtml, { status: 200 });
      }
      return new Response(chapterHtml, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const result = await importFicbookFromUrl("https://ficbook.net/readfic/13141244", {
      fetchImpl,
      chapterDelayMs: 0,
    });
    const meta = await extractEpubMetadata(result.epubBytes);
    expect(result.chapterCount).toBe(2);
    expect(meta.coverBytes).toBeNull();
  });
});
