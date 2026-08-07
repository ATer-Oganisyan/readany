#!/usr/bin/env node
/**
 * Очистка встроенных EPUB-книг каталога от служебного мусора Викитеки (WSExport).
 *
 * Что делает для каждой книги в assets/catalog/*.epub:
 *  1. Титульная страница = название + автор (аккуратная типографика),
 *     без логотипа Wikisource и строки «Экспортировано из Викитеки».
 *  2. Удаляет из начала спайна страницы-мусор: текстовые оглавления со ссылками
 *     на главы, списки редакций, служебные страницы (они же удаляются из
 *     manifest, nav.xhtml и toc.ncx). nav.xhtml как логическое оглавление
 *     для нативной панели «Оглавление» сохраняется.
 *  3. Чистит внутри контентных файлов: шапки headertemplate, поисковые формы,
 *     интервики/категории (<link rel="mw:PageProp/...">), ссылочные оглавления
 *     (ul из wiki-ссылок, абзацы «Главы: I · II · …»), разворачивает внешние
 *     ссылки на wikisource.org (текст остаётся, ссылка убирается).
 *  4. eugene-onegin (calibre-экспорт): добавляет титульную страницу, убирает
 *     артефакты печатных номеров страниц и внешние сноски на feb-web.ru.
 *
 * Metadata (dc:title/dc:creator/описание) и обложки не трогаются.
 * Файлы глав не переименовываются. ВНИМАНИЕ: удаление страниц из начала
 * сдвигает индексы спайна — у существующих читателей позиция чтения (CFI)
 * может сброситься; для новых читателей это ок.
 *
 * Запуск: pnpm clean:catalog-books  (из packages/app-expo)
 * Зависимости: только node + системные бинари zip/unzip (macOS/linux).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = path.resolve(__dirname, "../assets/catalog");

/** Название/автор для титульных страниц — синхронизировано с
 *  src/lib/catalog/bundled-book-definitions.ts */
const BOOKS = {
  "fathers-and-sons": { title: "Отцы и дети", author: "Иван Тургенев" },
  "anna-karenina": { title: "Анна Каренина", author: "Лев Толстой" },
  "war-and-peace": { title: "Война и мир", author: "Лев Толстой" },
  "crime-and-punishment": { title: "Преступление и наказание", author: "Фёдор Достоевский" },
  "government-inspector": { title: "Ревизор", author: "Николай Гоголь" },
  "dead-souls": { title: "Мёртвые души", author: "Николай Гоголь" },
  "hero-of-our-time": { title: "Герой нашего времени", author: "Михаил Лермонтов" },
  "captains-daughter": { title: "Капитанская дочка", author: "Александр Пушкин" },
  "eugene-onegin": { title: "Евгений Онегин", author: "Александр Пушкин" },
  "gentleman-from-san-francisco": {
    title: "Господин из Сан-Франциско",
    author: "Иван Бунин",
  },
  "dark-avenues": { title: "Тёмные аллеи", author: "Иван Бунин" },
  "golden-key": {
    title: "Золотой ключик, или Приключения Буратино",
    author: "Алексей Толстой",
  },
  "twelve-chairs": { title: "Двенадцать стульев", author: "Илья Ильф и Евгений Петров" },
  "three-sisters": { title: "Три сестры", author: "Антон Чехов" },
  seagull: { title: "Чайка", author: "Антон Чехов" },
  "cherry-orchard": { title: "Вишнёвый сад", author: "Антон Чехов" },
  thunderstorm: { title: "Гроза", author: "Александр Островский" },
};

/** Страницы, которые надо удалить из начала независимо от эвристики:
 *  dead-souls c0 — иллюстрация издания 1842 г. + список критики «См. также»;
 *  captains-daughter c1 — заглушка редакции 1960 г. (оглавление + примечания),
 *  сам текст книги лежит в редакции 1978 г. (c2). */
const EXPLICIT_DROP = {
  // c0 — список редакций с библиографией, c1 — заглушка редакции 1960 г.
  // (оглавление + примечания); сам текст книги — редакция 1978 г. (c2).
  "captains-daughter": [/^c0_/, /^c1_.*1960/],
};

/** Страницы, которые нельзя удалять, а надо превратить в страницу посвящения:
 *  twelve-chairs c0 = поисковая форма + посвящение Катаеву + оглавление. */
const DEDICATION_REWRITE = {
  "twelve-chairs": /^c0_/,
};

// ---------------------------------------------------------------- утилиты

function extractEpub(epubPath, destDir) {
  execFileSync("unzip", ["-oq", epubPath, "-d", destDir]);
}

function packEpub(workDir, epubPath) {
  const tmpOut = `${epubPath}.tmp.zip`;
  fs.rmSync(tmpOut, { force: true });
  // mimetype обязан идти первым и без сжатия
  execFileSync("zip", ["-X", "-0", "-q", tmpOut, "mimetype"], { cwd: workDir });
  execFileSync("zip", ["-X", "-9", "-r", "-q", tmpOut, ".", "-x", "mimetype"], {
    cwd: workDir,
  });
  fs.renameSync(tmpOut, epubPath);
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function bodyOf(html) {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  return m ? m[1] : html;
}

/** Статистика страницы: длина текста без ссылок и количество ссылок. */
function pageStats(html) {
  let body = bodyOf(html);
  // Шапка/форма поиска/интервики не считаются содержимым
  body = removeChrome(body);
  const anchors = body.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
  const linkText = anchors.map((a) => stripTags(a)).join(" ");
  const totalText = stripTags(body);
  return {
    anchorCount: anchors.length,
    totalLen: totalText.length,
    nonLinkLen: Math.max(0, totalText.length - linkText.length),
  };
}

/** Служебные обвязки Викитеки, не являющиеся содержимым. */
function removeChrome(html) {
  return (
    html
      // шапка headertemplate (+ хвостовой пустой span)
      .replace(
        /<div id="headertemplate[^"]*"[^>]*>\s*<div id="sub_nav[^"]*"\s*\/>\s*<br[^>]*\/>\s*<\/div>(\s*<span class="mw-empty-elt"[^>]*\/>)?/g,
        "",
      )
      // блок «Поиск по произведению» с формой
      .replace(
        /<div style="text-align:center; ">(?:(?!<\/form>)[\s\S])*?<form[\s\S]*?<\/form>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/g,
        "",
      )
      .replace(/<form name="searchbox"[\s\S]*?<\/form>/g, "")
      // интервики и категории
      .replace(/<link rel="mw:PageProp\/[^"]*"[^>]*\/>\s*/g, "")
  );
}

/** ul/dl, состоящие только из wiki-ссылок (текстовое оглавление). */
function removeLinkOnlyLists(html) {
  return html.replace(/<(ul|dl)>[\s\S]*?<\/\1>/g, (list) => {
    if (!/rel="mw:WikiLink"/.test(list)) return list;
    const noAnchors = list.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, "");
    const residue = stripTags(noAnchors).replace(/[\s·—–\-,.:;()\[\]0-9IVXLC]+/g, "");
    return residue.length <= 5 ? "" : list;
  });
}

/** Абзацы вида «Главы: I · II · III …» (набор ссылок с разделителями). */
function removeChapterLinkParagraphs(html) {
  return html.replace(/<p>[\s\S]*?<\/p>/g, (p) => {
    const anchors = p.match(/<a\b[^>]*rel="mw:WikiLink"[^>]*>/g) ?? [];
    if (anchors.length < 3) return p;
    const residue = stripTags(p.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, "")).replace(
      /^(Главы|Части|Действия|Явления|Том[аы]?)\s*[:.]?/u,
      "",
    );
    return residue.replace(/[\s·—–\-,.:;0-9IVXLC]+/g, "").length <= 5 ? "" : p;
  });
}

/** Внешние ссылки на wikisource → оставить только текст. */
function unwrapWikisourceLinks(html) {
  return html.replace(
    /<a\b[^>]*href="https?:\/\/[a-z.]*wikisource\.org[^"]*"[^>]*>([\s\S]*?)<\/a>/g,
    "$1",
  );
}

/** Заголовок «Оглавление», оставшийся без списка после чистки. */
function removeTocHeadings(html) {
  return html.replace(/<h([1-4])[^>]*>(?:(?!<\/h\1>)[\s\S])*?<\/h\1>/g, (h) =>
    /^(Оглавление|Содержание)$/.test(stripTags(h)) ? "" : h,
  );
}

function cleanContentDoc(html) {
  let out = removeChrome(html);
  out = removeLinkOnlyLists(out);
  out = removeChapterLinkParagraphs(out);
  out = unwrapWikisourceLinks(out);
  out = removeTocHeadings(out);
  return out;
}

/** Текст страницы для оценки «служебная или контентная»: дополнительно к
 *  обычной чистке игнорируем разделы «См. также» и примечания о публикации —
 *  они не делают страницу-оглавление содержательной. */
function junkMeasureText(html) {
  let x = cleanContentDoc(html);
  x = x.replace(
    /<section[^>]*>\s*<h(\d)[^>]*>(?:(?!<\/h\1>)[\s\S])*?См\.\s*также[\s\S]*?<\/section>/g,
    "",
  );
  x = x.replace(/<ol class="mw-references[\s\S]*?<\/ol>/g, "");
  x = x.replace(/<h([1-4])[^>]*>(?:(?!<\/h\1>)[\s\S])*?<\/h\1>/g, (h) =>
    /^Примечания\b/.test(stripTags(h)) ? "" : h,
  );
  return stripTags(bodyOf(x));
}

function titlePageHtml(title, author, cssHref) {
  const css = cssHref ? `\n    <link type="text/css" rel="stylesheet" href="${cssHref}" />` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ru" dir="ltr">
  <head>
    <title>${title}</title>${css}
  </head>
  <body style="margin: 0; padding: 0; text-align: center; text-indent: 0;">
    <div style="padding: 38% 8% 0 8%;">
      <h1 style="font-size: 1.9em; font-weight: 600; line-height: 1.25; margin: 0 0 0.75em 0; letter-spacing: 0.01em;">${title}</h1>
      <p style="font-size: 1.05em; margin: 0; opacity: 0.75;">${author}</p>
    </div>
  </body>
</html>
`;
}

// ------------------------------------------------------ обработка книги

function processWikisourceBook(bookId, workDir, report) {
  const meta = BOOKS[bookId];
  const opsDir = path.join(workDir, "OPS");
  const opfPath = path.join(opsDir, "content.opf");
  let opf = fs.readFileSync(opfPath, "utf8");

  const manifestItems = new Map();
  for (const m of opf.matchAll(/<item\b[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*\/>/g)) {
    manifestItems.set(m[1], m[2]);
  }
  const spineMatch = opf.match(/<spine[^>]*>([\s\S]*?)<\/spine>/);
  const spineIds = [...spineMatch[1].matchAll(/idref="([^"]+)"/g)].map((m) => m[1]);
  const uniqueSpine = [...new Set(spineIds)];
  report.spineBefore = uniqueSpine.slice();

  // 1. Титульная страница
  const titleHref = manifestItems.get("title");
  fs.writeFileSync(
    path.join(opsDir, titleHref),
    titlePageHtml(meta.title, meta.author),
    "utf8",
  );

  // 2. Мусорные страницы в начале спайна (после титула, до первого контента).
  //    Эвристика считает текст страницы ПОСЛЕ чистки от оглавлений/шапок:
  //    если содержимого почти не остаётся, страница была служебной.
  const explicitDrop = EXPLICIT_DROP[bookId] ?? [];
  const dedicationRe = DEDICATION_REWRITE[bookId];
  const removed = [];
  for (const id of uniqueSpine) {
    if (id === "title") continue;
    if (id === "about") break;
    const href = manifestItems.get(id);
    const file = path.join(opsDir, href);
    const src = fs.readFileSync(file, "utf8");
    if (dedicationRe?.test(id)) {
      // страница с посвящением: оставить только посвящение
      const block = src.match(/<div class="align-right"[^>]*>[\s\S]*?Посвящается[\s\S]*?<\/div>/);
      if (block) {
        const rewritten = src.replace(
          /(<body[^>]*>)[\s\S]*(<\/body>)/,
          `$1\n<div style="padding-top: 35%; text-align: center; text-indent: 0;">${block[0]
            .replace(/<div class="align-right"[^>]*>/, '<div style="font-style: italic;">')}</div>\n$2`,
        );
        fs.writeFileSync(file, rewritten, "utf8");
        report.dedicationPage = id;
        // подпись в оглавлении: «Посвящение» вместо названия книги
        const navPath = path.join(opsDir, "nav.xhtml");
        if (fs.existsSync(navPath)) {
          fs.writeFileSync(
            navPath,
            fs
              .readFileSync(navPath, "utf8")
              .replace(new RegExp(`(<a href="${escapeRe(href)}"[^>]*>)[^<]*`), "$1Посвящение"),
            "utf8",
          );
        }
        const ncxPath = path.join(opsDir, "toc.ncx");
        if (fs.existsSync(ncxPath)) {
          fs.writeFileSync(
            ncxPath,
            fs
              .readFileSync(ncxPath, "utf8")
              .replace(
                new RegExp(
                  `(<navPoint id="${escapeRe(id)}"[^>]*>\\s*<navLabel>\\s*<text>)[^<]*`,
                ),
                "$1Посвящение",
              ),
            "utf8",
          );
        }
      }
      break;
    }
    const origAnchors = (bodyOf(src).match(/<a\b[^>]*>/g) ?? []).length;
    const measured = junkMeasureText(src);
    const isJunk =
      explicitDrop.some((re) => re.test(id)) ||
      (origAnchors >= 3 && measured.length < 300) ||
      measured.length < 50;
    if (!isJunk) break;
    removed.push({ id, href, measuredLen: measured.length });
  }

  for (const { id, href } of removed) {
    fs.rmSync(path.join(opsDir, href), { force: true });
    // manifest + spine (учитываем возможные дубли itemref)
    opf = opf.replace(
      new RegExp(`<item\\b[^>]*id="${escapeRe(id)}"[^>]*/>\\s*`, "g"),
      "",
    );
    opf = opf.replace(
      new RegExp(`<itemref idref="${escapeRe(id)}"[^>]*/>\\s*`, "g"),
      "",
    );
    manifestItems.delete(id);
  }

  // 3. Чистка внутри оставшихся контентных файлов (кроме title/about/nav)
  for (const [id, href] of manifestItems) {
    if (!href.endsWith(".xhtml")) continue;
    if (id === "title" || id === "about" || id === "nav") continue;
    const file = path.join(opsDir, href);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    let cleaned = cleanContentDoc(src);
    // Страница-разделитель (например «Том I»), у которой после чистки не
    // осталось контента: показываем её заголовок из <title>.
    if (stripTags(bodyOf(cleaned)).length < 5) {
      const pageTitle = stripTags(cleaned.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
      if (pageTitle) {
        cleaned = cleaned.replace(
          /(<body[^>]*>)[\s\S]*?(<\/body>)/,
          `$1\n<div style="padding-top: 40%; text-align: center; text-indent: 0;"><h2 style="font-weight: 600;">${pageTitle}</h2></div>\n$2`,
        );
      }
    }
    if (cleaned !== src) fs.writeFileSync(file, cleaned, "utf8");
  }

  // 4. nav.xhtml + toc.ncx: убрать записи удалённых страниц
  const removedHrefs = removed.map((r) => r.href);
  const spineAfterIds = uniqueSpine.filter((id) => !removed.some((r) => r.id === id));
  const firstContentHref = manifestItems.get(spineAfterIds[1]);
  const navPath = path.join(opsDir, "nav.xhtml");
  if (fs.existsSync(navPath)) {
    let nav = fs.readFileSync(navPath, "utf8");
    for (const href of removedHrefs) {
      nav = nav.replace(
        new RegExp(`<li\\b[^>]*>\\s*<a [^>]*href="${escapeRe(href)}"[^>]*>[\\s\\S]*?</a>\\s*</li>`, "g"),
        "",
      );
      // остаточные ссылки (например landmark bodymatter) → первая контентная страница
      if (firstContentHref) {
        nav = nav.replaceAll(`href="${href}"`, `href="${firstContentHref}"`);
      }
    }
    fs.writeFileSync(navPath, nav, "utf8");
  }
  const ncxPath = path.join(opsDir, "toc.ncx");
  if (fs.existsSync(ncxPath)) {
    let ncx = fs.readFileSync(ncxPath, "utf8");
    for (const href of removedHrefs) {
      ncx = ncx.replace(
        new RegExp(`<navPoint\\b[^>]*>(?:(?!</navPoint>)[\\s\\S])*?src="${escapeRe(href)}"[\\s\\S]*?</navPoint>`, "g"),
        "",
      );
    }
    let order = 0;
    ncx = ncx.replace(/playOrder="\d+"/g, () => `playOrder="${++order}"`);
    fs.writeFileSync(ncxPath, ncx, "utf8");
  }

  // 5. Логотип Wikisource больше не используется — убрать файл и manifest-item
  const logoRel = "images/Wikisource-logo.svg.png";
  const logoAbs = path.join(opsDir, logoRel);
  if (fs.existsSync(logoAbs)) {
    let referenced = false;
    for (const [, href] of manifestItems) {
      if (!/\.(xhtml|css)$/.test(href)) continue;
      const file = path.join(opsDir, href);
      if (fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("Wikisource-logo")) {
        referenced = true;
        break;
      }
    }
    if (!referenced) {
      fs.rmSync(logoAbs, { force: true });
      opf = opf.replace(/<item\b[^>]*href="images\/Wikisource-logo\.svg\.png"[^>]*\/>\s*/g, "");
      const imagesDir = path.join(opsDir, "images");
      if (fs.existsSync(imagesDir) && fs.readdirSync(imagesDir).length === 0) {
        fs.rmdirSync(imagesDir);
      }
    }
  }

  fs.writeFileSync(opfPath, opf, "utf8");
  report.removed = removed;
  report.spineAfter = uniqueSpine.filter((id) => !removed.some((r) => r.id === id));
}

function processCalibreBook(bookId, workDir, report) {
  // eugene-onegin: calibre-экспорт без титула и без мусора Викитеки
  const meta = BOOKS[bookId];
  const opfPath = path.join(workDir, "content.opf");
  let opf = fs.readFileSync(opfPath, "utf8");
  const spineIds = [...opf.matchAll(/<itemref idref="([^"]+)"\s*\/>/g)].map((m) => m[1]);
  report.spineBefore = spineIds.slice();

  // титульная страница (повторный запуск не добавляет дубликат)
  fs.writeFileSync(
    path.join(workDir, "titlepage.xhtml"),
    titlePageHtml(meta.title, meta.author),
    "utf8",
  );
  if (!opf.includes('id="titlepage"')) {
    opf = opf.replace(
      /<manifest>/,
      `<manifest>\n    <item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>`,
    );
    opf = opf.replace(/(<spine[^>]*>)/, `$1\n    <itemref idref="titlepage"/>`);
    fs.writeFileSync(opfPath, opf, "utf8");
  }

  const cleanedNotes = [];
  for (const file of ["index_split_000.html", "index_split_001.html"]) {
    const p = path.join(workDir, file);
    let s = fs.readFileSync(p, "utf8");
    const before = s;
    // артефакты печатных номеров страниц: <p class="block_">42</p>
    s = s.replace(/\s*<p class="block_">\d+<\/p>/g, "");
    // дубль титула в начале текста (титульная страница теперь отдельная)
    s = s.replace(/\s*<p class="block_1">ЕВГЕНИЙ ОНЕГИН<\/p>/, "");
    s = s.replace(/\s*<p class="block_1">РОМАН В СТИХАХ<\/p>/, "");
    // внешние сноски на feb-web.ru: номера и «<См. перевод>» убрать, прочее развернуть
    s = s.replace(/<a\b[^>]*href="https?:\/\/feb-web\.ru[^"]*"[^>]*>([\s\S]*?)<\/a>/g, (full, inner) => {
      const text = stripTags(inner);
      if (/^\d+$/.test(text) || /См[\s.]*перевод/.test(text.replace(/&[lg]t;/g, ""))) return "";
      return inner;
    });
    if (s !== before) {
      fs.writeFileSync(p, s, "utf8");
      cleanedNotes.push(file);
    }
  }
  report.removed = [];
  report.spineAfter = spineIds.includes("titlepage") ? spineIds : ["titlepage", ...spineIds];
  report.notes = `добавлен titlepage.xhtml; вычищены печатные номера страниц и сноски feb-web в ${cleanedNotes.join(", ")}`;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ----------------------------------------------------------- валидация

function validateBook(bookId, workDir, report) {
  const isCalibre = !fs.existsSync(path.join(workDir, "OPS"));
  const baseDir = isCalibre ? workDir : path.join(workDir, "OPS");
  const opf = fs.readFileSync(path.join(baseDir, "content.opf"), "utf8");
  const items = new Map(
    [...opf.matchAll(/<item\b[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*\/>/g)].map((m) => [m[1], m[2]]),
  );
  const spine = [
    ...new Set([...opf.match(/<spine[^>]*>[\s\S]*?<\/spine>/)[0].matchAll(/idref="([^"]+)"/g)].map((m) => m[1])),
  ];
  const firstHref = items.get(spine[0]);
  const firstText = stripTags(bodyOf(fs.readFileSync(path.join(baseDir, firstHref), "utf8")));
  const { title, author } = BOOKS[bookId];
  const errors = [];
  if (!firstText.includes(title) || !firstText.includes(author)) {
    errors.push(`титул не содержит название/автора: "${firstText.slice(0, 120)}"`);
  }
  // после титула допускается страница посвящения, затем сразу контент
  const secondText = stripTags(
    bodyOf(fs.readFileSync(path.join(baseDir, items.get(spine[1])), "utf8")),
  );
  report.secondPagePreview = secondText.slice(0, 200);
  const isDedication = /Посвящается/.test(secondText) && secondText.length < 400;
  if (isDedication) {
    const thirdText = stripTags(
      bodyOf(fs.readFileSync(path.join(baseDir, items.get(spine[2])), "utf8")),
    );
    report.thirdPagePreview = thirdText.slice(0, 200);
    if (thirdText.length < 200) {
      errors.push(`после посвящения нет контента (${thirdText.length} симв.)`);
    }
  } else if (secondText.length < 200) {
    errors.push(`вторая страница подозрительно короткая (${secondText.length} симв.): "${secondText.slice(0, 120)}"`);
  }
  report.errors = errors;
  return errors.length === 0;
}

// ---------------------------------------------------------------- main

function main() {
  const epubs = fs
    .readdirSync(CATALOG_DIR)
    .filter((f) => f.endsWith(".epub"))
    .sort();
  let failed = 0;
  for (const file of epubs) {
    const bookId = path.basename(file, ".epub");
    if (!BOOKS[bookId]) {
      console.warn(`! ${bookId}: нет в списке каталога, пропущен`);
      continue;
    }
    const epubPath = path.join(CATALOG_DIR, file);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `clean-epub-${bookId}-`));
    const report = {};
    try {
      extractEpub(epubPath, workDir);
      if (fs.existsSync(path.join(workDir, "OPS"))) {
        processWikisourceBook(bookId, workDir, report);
      } else {
        processCalibreBook(bookId, workDir, report);
      }
      const ok = validateBook(bookId, workDir, report);
      if (ok) {
        packEpub(workDir, epubPath);
      } else {
        failed += 1;
      }
      const removedList = report.removed?.length
        ? report.removed.map((r) => r.id).join(", ")
        : "ничего";
      console.log(`${ok ? "✓" : "✗"} ${bookId}`);
      console.log(`    спайн: ${report.spineBefore.length} → ${report.spineAfter.length} страниц; удалено: ${removedList}`);
      if (report.notes) console.log(`    ${report.notes}`);
      console.log(`    стр. 2: ${report.secondPagePreview?.slice(0, 140) ?? "?"}`);
      for (const e of report.errors ?? []) console.log(`    ОШИБКА: ${e}`);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
  if (failed > 0) {
    console.error(`\nНе прошли валидацию: ${failed} книг(и) — EPUB не перезаписаны.`);
    process.exit(1);
  }
  console.log("\nГотово: все книги очищены и перезаписаны.");
}

main();
