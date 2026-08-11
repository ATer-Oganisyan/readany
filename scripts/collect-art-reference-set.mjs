import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve("assets/art-reference-set-100");
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "Narra2-art-reference-collector/1.0 (reference image research)";
const ALLOWED_LICENSE = /public domain|cc0|cc by/i;

const stripHtml = (value = "") =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const safeFilePart = (value) =>
  stripHtml(value)
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90)
    .replace(/[-.]+$/g, "") || "artwork";

const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

async function commonsRequest(params) {
  const url = new URL(COMMONS_API);
  for (const [key, value] of Object.entries({
    action: "query",
    format: "json",
    origin: "*",
    prop: "imageinfo",
    iiprop: "url|extmetadata|size|mime",
    iiurlwidth: "1200",
    ...params,
  })) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Commons API ${response.status}: ${url}`);
  const payload = await response.json();
  return Object.values(payload.query?.pages ?? {}).map(normalizeCommonsItem);
}

function normalizeCommonsItem(page) {
  const info = page.imageinfo?.[0] ?? {};
  const meta = info.extmetadata ?? {};
  const originalTitle = page.title.replace(/^File:/, "").replace(/\.[^.]+$/, "");
  return {
    key: page.pageid,
    title: originalTitle,
    artist: stripHtml(meta.Artist?.value) || "Автор не указан",
    date: stripHtml(meta.DateTimeOriginal?.value || meta.DateTime?.value),
    license: stripHtml(meta.LicenseShortName?.value),
    licenseUrl: meta.LicenseUrl?.value || "",
    sourcePage:
      info.descriptionurl ||
      `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`,
    imageUrl: (() => {
      if (!info.url) return "";
      const url = new URL("https://commons.wikimedia.org/w/thumb.php");
      url.searchParams.set("f", page.title.replace(/^File:/, ""));
      url.searchParams.set("w", String(Math.min(1200, info.width || 1200)));
      return url.toString();
    })(),
    mime: info.thumbmime || info.mime,
    width: info.thumbwidth || info.width || 0,
    height: info.thumbheight || info.height || 0,
    originalWidth: info.width || 0,
    originalHeight: info.height || 0,
    originalTitle: page.title.replace(/^File:/, ""),
  };
}

async function searchCommons(query, limit = 150) {
  return commonsRequest({
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: String(Math.min(limit, 500)),
  });
}

async function categoryCommons(category, limit = 500) {
  return commonsRequest({
    generator: "categorymembers",
    gcmtitle: `Category:${category}`,
    gcmtype: "file",
    gcmlimit: String(Math.min(limit, 500)),
  });
}

function isUsable(item, exclusion) {
  const name = `${item.originalTitle} ${item.title}`;
  return Boolean(
    item.imageUrl &&
      /image\/(jpeg|png|webp)/i.test(item.mime || "") &&
      Math.max(item.originalWidth, item.originalHeight) >= 480 &&
      ALLOWED_LICENSE.test(item.license) &&
      !exclusion.test(name),
  );
}

function takeUnique(target, candidates, amount, exclusion) {
  const used = new Set(target.map((item) => item.key));
  for (const item of candidates) {
    if (target.length >= amount) break;
    if (!used.has(item.key) && isUsable(item, exclusion)) {
      used.add(item.key);
      target.push(item);
    }
  }
}

async function buildSelection() {
  const suprematismExclusion =
    /verso|timeline|poster|lecture|industrial porcelain|exhibition|book cover|from cezanne|path from impressionism|drawings\.png|student|museum room|installation view|portrait of/i;
  const abstractExclusion =
    /portrait of|self.?portrait|photograph|grave|tomb|museum room|installation view|exhibition|poster|stamp|sculpture|ceramic|vessel|mural|building|monument|cover|book|verso|penrose|pythagorean|mondrianlike|abstractdraw|kachelstruktur|objectivism|black circle|black square|supremat|malevich/i;

  const suprematism = [];
  const suprematismSearch = await searchCommons("suprematism filetype:bitmap", 250);
  const suprematismTitle =
    /supremat|non.?objective|composition|black square|black circle|black cross|white on white|painterly realism|color masses|football player|mystic/i;
  takeUnique(
    suprematism,
    suprematismSearch.filter((item) => suprematismTitle.test(item.title)),
    40,
    suprematismExclusion,
  );
  const suprematismArtistQueries = [
    "Kazimir Malevich suprematist composition filetype:bitmap",
    "Olga Rozanova non-objective composition filetype:bitmap",
    "Ivan Kliun suprematism filetype:bitmap",
    "Ilya Chashnik suprematism filetype:bitmap",
    "Lyubov Popova non-objective composition filetype:bitmap",
  ];
  for (const query of suprematismArtistQueries) {
    if (suprematism.length >= 40) break;
    const candidates = await searchCommons(query, 100);
    const clearlySuprematist = candidates.filter((item) => suprematismTitle.test(item.title));
    takeUnique(suprematism, clearlySuprematist, 40, suprematismExclusion);
  }
  if (suprematism.length < 40) {
    const fallback = await categoryCommons("Suprematist paintings");
    takeUnique(suprematism, fallback, 40, suprematismExclusion);
  }

  const abstraction = [];
  const notInSuprematism = (item) =>
    !suprematism.some((suprematistItem) => suprematistItem.key === item.key);
  const hilma = await categoryCommons("Paintings by Hilma af Klint");
  takeUnique(abstraction, hilma.filter(notInSuprematism), 16, abstractExclusion);
  const geometric = await categoryCommons("Geometric abstract paintings");
  takeUnique(abstraction, geometric.filter(notInSuprematism), 28, abstractExclusion);
  if (abstraction.length < 40) {
    const fallback = await categoryCommons("Abstract paintings");
    takeUnique(abstraction, fallback.filter(notInSuprematism), 40, abstractExclusion);
  }

  if (suprematism.length !== 40 || abstraction.length !== 40) {
    throw new Error(
      `Не удалось собрать ровно 80 работ: супрематизм ${suprematism.length}, абстракция ${abstraction.length}`,
    );
  }
  return { suprematism, abstraction };
}

async function downloadGroup(groupName, items) {
  const directory = path.join(ROOT, groupName);
  await mkdir(directory, { recursive: true });
  for (const [index, item] of items.entries()) {
    const extension = item.mime?.includes("png")
      ? "png"
      : item.mime?.includes("webp")
        ? "webp"
        : "jpg";
    const filename = `${String(index + 1).padStart(2, "0")}-${safeFilePart(item.title)}.${extension}`;
    const destination = path.join(directory, filename);
    try {
      await access(destination);
    } catch {
      let response;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        response = await fetch(item.imageUrl, {
          headers: { "user-agent": USER_AGENT, referer: item.sourcePage },
        });
        if (response.ok) break;
        if (response.status !== 429 || attempt === 5) {
          throw new Error(`Не удалось скачать ${item.imageUrl}: ${response.status}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
      }
      await writeFile(destination, Buffer.from(await response.arrayBuffer()));
      if ((index + 1) % 10 === 0) console.log(`${groupName}: скачано ${index + 1}/${items.length}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    item.group = groupName;
    item.filename = `${groupName}/${filename}`;
  }
}

function buildGallery(items) {
  const cards = items
    .map(
      (item) => `<article>
        <a href="${item.sourcePage}" target="_blank" rel="noreferrer"><img src="${item.filename}" loading="lazy" alt="${item.title.replaceAll('"', "&quot;")}"></a>
        <div><strong>${item.title}</strong><span>${item.artist}</span><small>${item.license}</small></div>
      </article>`,
    )
    .join("\n");
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>80 примеров супрематизма и абстракционизма</title><style>
  body{margin:0;padding:32px;background:#f3f2ee;color:#171717;font:15px/1.4 system-ui,sans-serif}h1{font-size:clamp(28px,4vw,56px);max-width:900px;margin:0 0 32px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px}article{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 8px #0001}article a{display:block;aspect-ratio:1/1;background:#e8e7e2}img{width:100%;height:100%;object-fit:contain}article div{display:grid;gap:5px;padding:14px}span,small{color:#666}small{font-size:12px}
  </style><h1>80 примеров супрематизма и абстракционизма</h1><main class="grid">${cards}</main></html>`;
}

const selection = await buildSelection();
await mkdir(ROOT, { recursive: true });
await downloadGroup("01-suprematism", selection.suprematism);
await downloadGroup("02-abstraction", selection.abstraction);

const all = [...selection.suprematism, ...selection.abstraction];
const header = [
  "file",
  "group",
  "title",
  "artist",
  "date",
  "license",
  "license_url",
  "source_page",
  "original_dimensions",
];
const rows = all.map((item) => [
  item.filename,
  item.group,
  item.title,
  item.artist,
  item.date,
  item.license,
  item.licenseUrl,
  item.sourcePage,
  `${item.originalWidth}x${item.originalHeight}`,
]);
await writeFile(
  path.join(ROOT, "manifest.csv"),
  `${[header, ...rows].map((row) => row.map(csv).join(",")).join("\n")}\n`,
);
await writeFile(path.join(ROOT, "index.html"), buildGallery(all));
await writeFile(
  path.join(ROOT, "README.md"),
  "# Набор из 80 примеров\n\n- `01-suprematism` — 40 работ.\n- `02-abstraction` — 40 работ.\n- `index.html` — визуальная галерея.\n- `manifest.csv` — авторы, названия, лицензии и ссылки на оригиналы.\n\nИзображения получены через Wikimedia Commons API. Перед публикацией или коммерческим использованием сверяйтесь с лицензией конкретной работы в `manifest.csv`.\n",
);

console.log(`Готово: ${all.length} файлов в ${ROOT}`);
