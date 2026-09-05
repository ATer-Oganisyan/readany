#!/usr/bin/env node
// Original, redistributable books for native import acceptance. No network access.
// Run from the repo: node packages/app-expo/scripts/generate-import-audit-fixtures.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { strToU8, unzipSync, zipSync } from "fflate";
import iconv from "iconv-lite";

const output = resolve(process.argv[2] || "/private/tmp/narra-audit-import-fixtures");
mkdirSync(output, { recursive: true });
const manifest = [];
const author = "Narra Audit";
const chapters = ["Письмо у реки", "Свет в мастерской", "Последняя переправа"];
const scenes = [
  "Анна положила на стол старую карту. Её брат Михаил вернулся с пристани и рассказал о письме, которое нашёл под фонарём. Лев, их сосед и хранитель библиотеки, внимательно выслушал обоих. Никто не хотел торопиться с выводами: на конверте не было адреса, только рисунок моста.",
  "В мастерской было тихо. Михаил чинил деревянную лодку, а Анна сверяла отметки на карте с береговыми камнями. Лев принёс дневник прежнего смотрителя. Из него стало ясно, что письмо предназначалось не одному человеку, а всем жителям маленького острова.",
  "На рассвете Анна, Михаил и Лев отправились через реку. Вода отражала первые лучи солнца. Они нашли на другом берегу сад и небольшую библиотеку, о которой давно забыли. Друзья решили восстановить переправу, чтобы дети с острова снова могли приходить туда за книгами.",
];
const paragraphs = (chapter, count = 28) =>
  Array.from(
    { length: count },
    (_, n) =>
      `Эпизод ${chapter + 1}.${n + 1}. ${scenes[chapter]} ${n % 2 ? "Анна записала наблюдение в тетрадь и отметила место остановки." : "Михаил спросил Льва о следующем шаге, и они спокойно продолжили работу."}`,
  );
const story = (count = 28) =>
  chapters
    .map((name, i) => `${i + 1}. ${name}\n\n${paragraphs(i, count).join("\n\n")}`)
    .join("\n\n");
const escapeXml = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const zip = (entries) => zipSync(entries, { level: 6, mtime: new Date("2026-09-05T00:00:00Z") });
function emit(name, bytes, title, expectation, details = {}) {
  const data = Buffer.from(bytes);
  writeFileSync(join(output, name), data);
  manifest.push({
    name,
    title,
    expectation,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    ...details,
  });
  return data;
}
function epub(title, suffix, count = 28) {
  const entries = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/content.opf": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:narra-audit:${suffix}</dc:identifier><dc:title>${escapeXml(title)}</dc:title><dc:creator>${author}</dc:creator><dc:language>ru</dc:language><meta property="dcterms:modified">2026-09-05T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map((_, i) => `<item id="c${i}" href="chapter${i}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`,
    ),
    "OEBPS/nav.xhtml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ru"><head><title>Оглавление</title></head><body><nav epub:type="toc"><h1>${escapeXml(title)}</h1><ol>${chapters.map((c, i) => `<li><a href="chapter${i}.xhtml">${c}</a></li>`).join("")}</ol></nav></body></html>`,
    ),
  };
  chapters.forEach((c, i) => {
    entries[`OEBPS/chapter${i}.xhtml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ru"><head><title>${c}</title></head><body><h1>${c}</h1>${paragraphs(
        i,
        count,
      )
        .map((p) => `<p>${escapeXml(p)}</p>`)
        .join("")}</body></html>`,
    );
  });
  const data = zip(entries);
  assert.equal(Buffer.from(data.subarray(0, 2)).toString(), "PK");
  assert.equal(Object.keys(unzipSync(data)).length, 7);
  return data;
}
function fb2(title, encoding = "UTF-8") {
  return `<?xml version="1.0" encoding="${encoding}"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><genre>prose_contemporary</genre><author><first-name>Narra</first-name><last-name>Audit</last-name></author><book-title>${title}</book-title><annotation><p>Самостоятельный рассказ для проверки импорта, чтения и персонажей.</p></annotation><lang>ru</lang></title-info><document-info><author><nickname>Narra Audit</nickname></author><date value="2026-09-05">2026-09-05</date><id>narra-audit-${title}</id><version>1.0</version></document-info></description><body>${chapters
    .map(
      (c, i) =>
        `<section id="chapter-${i + 1}"><title><p>${c}</p></title>${paragraphs(i)
          .map((p) => `<p>${escapeXml(p)}</p>`)
          .join("")}</section>`,
    )
    .join("")}</body></FictionBook>`;
}
const primaryEpub = emit(
  "01-river.epub",
  epub("Аудит 01 - Письмо у реки", "river"),
  "Аудит 01 - Письмо у реки",
  "import-read",
  { chapters: 3 },
);
emit(
  "02-мастерская 100%.EPUB",
  epub("Аудит 02 - Мастерская 100%", "workshop"),
  "Аудит 02 - Мастерская 100%",
  "import-read",
  { checks: ["uppercase-extension", "cyrillic-space-percent-filename"] },
);
emit(
  "03-island.fb2",
  strToU8(fb2("Аудит 03 - Остров FB2")),
  "Аудит 03 - Остров FB2",
  "import-read",
);
emit(
  "04-letter-cp1251.fb2",
  iconv.encode(fb2("Аудит 04 - Письмо Windows", "windows-1251"), "windows-1251"),
  "Аудит 04 - Письмо Windows",
  "import-read",
  { encoding: "windows-1251" },
);
emit(
  "05-lantern-utf8.txt",
  strToU8(`Аудит 05 - Фонарь\nАвтор: Narra Audit\n\n${story()}`),
  "Аудит 05 - Фонарь",
  "import-read",
  { encoding: "utf-8" },
);
emit(
  "06-library-utf16.txt",
  Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(`Аудит 06 - Библиотека\nАвтор: Narra Audit\n\n${story()}`, "utf16le"),
  ]),
  "Аудит 06 - Библиотека",
  "import-read",
  { encoding: "utf-16le-bom" },
);
emit(
  "07-garden-cp1251.txt",
  iconv.encode(`Аудит 07 - Сад\nАвтор: Narra Audit\n\n${story()}`, "windows-1251"),
  "Аудит 07 - Сад",
  "import-read",
  { encoding: "windows-1251" },
);
const fbz = zip({ "08-archive.fb2": strToU8(fb2("Аудит 08 - Архив FBZ")) });
emit("08-archive.fbz", fbz, "Аудит 08 - Архив FBZ", "import-read");
emit(
  "09-nested.fb2.zip",
  zip({ "book/09-nested.fb2": strToU8(fb2("Аудит 09 - Вложенный FB2 ZIP")) }),
  "Аудит 09 - Вложенный FB2 ZIP",
  "import-read",
  { checks: ["compound-extension", "nested-archive-entry"] },
);

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const func = (id, payload) => {
  assert(payload.length < 251);
  return Buffer.concat([Buffer.from([0x23, id, 0, 0, 5 + payload.length]), payload]);
};
const data = (id, payload) =>
  Buffer.concat([Buffer.from([0x24]), u32(id), u32(9 + payload.length), payload]);
const umdChapters = chapters.map((c, i) =>
  Buffer.from(`${c}\n${paragraphs(i).join("\n\n")}\n`, "utf16le"),
);
const umdText = Buffer.concat(umdChapters);
let offset = 0;
const offsets = umdChapters.map((c) => {
  const old = offset;
  offset += c.length;
  return u32(old);
});
emit(
  "10-crossing.umd",
  Buffer.concat([
    Buffer.from([0x89, 0x9b, 0x9a, 0xde]),
    func(1, Buffer.from([1])),
    func(2, Buffer.from("Аудит 10 - Переправа UMD", "utf16le")),
    func(3, Buffer.from(author, "utf16le")),
    func(0x83, u32(100)),
    func(0x84, u32(101)),
    func(0x81, u32(102)),
    func(0x0b, u32(umdText.length)),
    data(100, Buffer.concat(offsets)),
    data(
      101,
      Buffer.concat(
        chapters.flatMap((c) => {
          const b = Buffer.from(c, "utf16le");
          return [Buffer.from([b.length]), b];
        }),
      ),
    ),
    data(102, u32(10)),
    data(10, deflateSync(umdText)),
    func(0x0c, u32(0)),
  ]),
  "Аудит 10 - Переправа UMD",
  "import-read",
  { chapters: 3, checks: ["umd-to-epub", "backend-epub-source"] },
);

// Tiny self-contained PDF writer keeps the fixture reproducible without a new dependency.
// Standard Helvetica, US-ASCII text, 12 pages; render independently with Poppler below.
function pdf() {
  const objects = [
    null,
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const pages = [];
  const sentences = [
    "Anna found a letter beside the river. Her brother Michael repaired the boat.",
    "Leo, their neighbour and the librarian, brought a map of the old crossing.",
    "Together they read the diary and planned a safe route to the island garden.",
    "At sunrise the friends crossed the river and opened the forgotten library.",
    "They marked this place in the notebook so they could return the next day.",
  ];
  for (let i = 0; i < 12; i++) {
    const pageId = objects.length;
    const streamId = pageId + 1;
    pages.push(`${pageId} 0 R`);
    const lines = [
      `Audit 11 - The River Library - Chapter ${i + 1}`,
      "",
      ...Array.from({ length: 35 }, (_, n) => sentences[(n + i) % sentences.length]),
      "",
      `Page ${i + 1} / 12 - Original Narra audit story`,
    ];
    const commands = `BT /F1 11 Tf 15 TL 45 795 Td ${lines.map((line, n) => `${n ? "T* " : ""}(${line}) Tj`).join("\n")} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pages.join(" ")}] >>`;
  const offsets = [0];
  let text = "%PDF-1.4\n";
  objects.slice(1).forEach((object, i) => {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}
emit("11-river-library.pdf", pdf(), "Audit 11 - The River Library", "import-read", { pages: 12 });
const rendering = join(output, "rendered");
mkdirSync(rendering, { recursive: true });
execFileSync("pdftoppm", [
  "-f",
  "1",
  "-l",
  "4",
  "-r",
  "72",
  "-png",
  join(output, "11-river-library.pdf"),
  join(rendering, "river"),
]);
const comicPages = Object.fromEntries(
  readdirSync(rendering)
    .filter((n) => /^river-\d+\.png$/.test(n))
    .sort()
    .map((n) => [n, new Uint8Array(readFileSync(join(rendering, n)))]),
);
assert.equal(Object.keys(comicPages).length, 4);
emit("12-river-comic.cbz", zip(comicPages), "12-river-comic", "import-read-ai-unavailable", {
  pages: 4,
});
emit("13-renamed-duplicate.epub", primaryEpub, "Аудит 01 - Письмо у реки", "skip-duplicate", {
  sameBytesAs: "01-river.epub",
});
mkdirSync(join(output, "changed-edition"), { recursive: true });
emit(
  "changed-edition/01-river.epub",
  epub("Аудит 14 - Новая редакция реки", "river-revision", 31),
  "Аудит 14 - Новая редакция реки",
  "import-read",
  { checks: ["same-filename-different-content", "old-book-still-readable"] },
);
emit(
  "15-large-original.txt",
  strToU8(`Аудит 15 - Длинный дневник\nАвтор: Narra Audit\n\n${story(900)}`),
  "Аудит 15 - Длинный дневник",
  "import-read",
  { checks: ["large-text", "responsive-import"] },
);
emit("16-empty.epub", Buffer.alloc(0), null, "reject-no-library-entry");
emit("17-truncated.epub", primaryEpub.subarray(0, 96), null, "reject-no-library-entry");
emit(
  "18-not-a-book.epub",
  strToU8("<!doctype html><html><body>Download unavailable. Please sign in.</body></html>"),
  null,
  "reject-no-library-entry",
);
emit(
  "19-unsupported.docx",
  strToU8("This is not a supported book format."),
  null,
  "reject-no-library-entry",
);
emit("20-empty.txt", Buffer.alloc(0), null, "reject-no-library-entry");
emit(
  "21-broken.fb2",
  strToU8('<?xml version="1.0"?><FictionBook><body><section><p>broken'),
  null,
  "reject-no-library-entry",
);
emit("22-invalid.umd", Buffer.from([0x89, 0x9b, 0x9a, 0xde]), null, "reject-no-library-entry");
writeFileSync(
  join(output, "manifest.json"),
  `${JSON.stringify({ generatedAt: "2026-09-05", license: "Original audit content; freely reusable", fixtures: manifest }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    output,
    fixtures: manifest.length,
    totalBytes: manifest.reduce((n, f) => n + f.bytes, 0),
  }),
);
