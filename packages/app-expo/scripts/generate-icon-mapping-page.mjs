import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = dirname(scriptDir);
const iconSourcePath = join(appRoot, "src/components/ui/Icon.tsx");
const outputPath = join(appRoot, "tools/icon-mapping/index.html");
const strokeAssetDir = join(appRoot, "assets/icons/mishanaer/stroke");
const filledAssetDir = join(appRoot, "assets/icons/mishanaer/filled");

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const iconLabelOverrides = {
  "arrow-from-square-up-right": "Открыть наружу",
  "arrow-to-line-down": "Скачать",
  "book-open-magnifying-glass": "Поиск по книге",
  "books-spines": "Книги",
  "chat-bubble": "Диалог",
  "chat-bubbles": "Диалоги",
  "check-circle": "Успех",
  "clock-3h": "Время",
  "dots-three-horizontal": "Ещё",
  "dots-three-vertical": "Ещё",
  "exclamation-triangle": "Предупреждение",
  "file-plus": "Добавить файл",
  "file-txt": "Текстовый файл",
  "magnifying-glass": "Поиск",
  "magnifying-glass-minus": "Уменьшить поиск",
  "magnifying-glass-plus": "Увеличить поиск",
  microchip: "Модель / процессор",
  "arrow-block-up": "Отправить",
  paperplane: "Отправить",
  "pencil-square": "Редактировать",
  "person-circle": "Профиль",
  "pulse-circle": "Загрузка",
  "question-circle": "Помощь",
  "share-network": "Поделиться",
  "skip-backward": "Назад по аудио",
  "skip-forward": "Вперёд по аудио",
  "text-t": "Типографика",
  "volume-2": "Громкость",
  "x-hexagon": "Ошибка",
};

const semanticFamilies = [
  ["book", "book-open", "books-spines", "book-open-magnifying-glass", "bookmark"],
  ["chat", "chat-bubble", "chat-bubbles", "reply", "message-circle", "message-square"],
  ["person", "person-circle", "people", "person-plus", "person-check"],
  [
    "search",
    "magnifying-glass",
    "magnifying-glass-plus",
    "magnifying-glass-minus",
    "book-open-magnifying-glass",
  ],
  ["audio", "play", "pause", "stop", "headphones", "volume-2", "skip-backward", "skip-forward"],
  [
    "navigation",
    "chevron-left",
    "chevron-right",
    "chevron-up",
    "chevron-down",
    "arrow-left",
    "arrow-right",
  ],
  [
    "status",
    "check",
    "check-circle",
    "checks",
    "x",
    "x-hexagon",
    "exclamation-triangle",
    "question-circle",
  ],
  ["files", "file-txt", "file-plus", "folder", "folder-plus", "folder-minus", "clipboard", "copy"],
  [
    "editing",
    "pencil",
    "pencil-square",
    "text-t",
    "text-b",
    "text-i",
    "strikethrough",
    "paint-roller",
  ],
  [
    "share",
    "share-network",
    "link",
    "arrow-from-square-up-right",
    "arrow-block-up",
    "paperplane",
    "arrow-to-line-down",
  ],
  ["settings", "gear", "wrench", "sliders", "funnel", "palette", "sun", "crescent"],
  ["analytics", "chart-bar", "chart-line", "trending-up", "flame", "trophy", "clock-3h"],
];

const featureRows = [
  ["Tab bar", "Библиотека", "books.vertical", "book", "filled", "TabNavigator · Library"],
  ["Tab bar", "Чаты", "message.fill", "chat-bubble", "filled", "TabNavigator · Chats"],
  ["Tab bar", "Профиль", "person.crop.circle", "person", "filled", "TabNavigator · Profile"],
  ["Tab bar", "Поиск", "magnifyingglass", "magnifying-glass", "filled", "TabNavigator · Search"],
  ["Toast", "Загрузка", "loader / activity", "pulse-circle", "stroke", "ToastPreview · loading"],
  ["Toast", "Успех", "checkmark.circle", "check-circle", "stroke", "ToastPreview · success"],
  ["Toast", "Ошибка", "xmark.circle", "exclamation-triangle", "stroke", "ToastPreview · error"],
  ["Chat", "Отправить", "paperplane.fill", "arrow-block-up", "stroke", "NarraChat · send"],
  ["Chat", "Микрофон", "mic.fill", "mic", "stroke", "NarraChat · voice input"],
  ["Reader", "Настройки", "gearshape", "gear", "stroke", "Reader toolbar"],
  ["Reader", "Наушники", "headphones", "headphones", "stroke", "Reader toolbar / native iOS"],
  ["Reader", "Пауза", "pause.fill", "pause", "stroke", "TTS controls"],
  ["Reader", "Стоп", "stop.fill", "stop", "stroke", "TTS controls / native iOS"],
  ["Native", "Назад", "chevron.backward", "chevron-left", "stroke", "Native headers"],
  ["Native", "Далее", "chevron.forward", "chevron-right", "stroke", "Native headers"],
  ["Native", "Добавить", "plus", "plus", "stroke", "Native buttons / sheets"],
  ["Native", "Закрыть", "xmark", "x", "stroke", "Native sheets"],
];

function toLabel(name) {
  return (
    iconLabelOverrides[name] ??
    name.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function alternativesFor(name, availableNames) {
  const available = new Set(availableNames);
  const family = semanticFamilies.find((members) => members.includes(name));
  const candidates =
    family ??
    availableNames.filter((candidate) => {
      const root = name.split("-")[0];
      return candidate.startsWith(`${root}-`) || candidate === root;
    });
  return candidates
    .filter((candidate) => candidate !== name && available.has(candidate))
    .slice(0, 4);
}

function imagePath(variant, name) {
  return `/assets/icons/mishanaer/${variant}/${encodeURIComponent(name)}.svg`;
}

const [iconSource, strokeFiles, filledFiles] = await Promise.all([
  readFile(iconSourcePath, "utf8"),
  readdir(strokeAssetDir),
  readdir(filledAssetDir),
]);

const strokeNames = strokeFiles
  .filter((file) => file.endsWith(".svg"))
  .map((file) => file.replace(/\.svg$/, ""));
const filledNames = filledFiles
  .filter((file) => file.endsWith(".svg"))
  .map((file) => file.replace(/\.svg$/, ""));
const allNames = [...new Set([...strokeNames, ...filledNames])].sort();

const rows = [];
const seenFeatureRows = new Set();
for (const [surface, semantic, source, mapped, variant, usedIn] of featureRows) {
  const key = `${surface}:${semantic}:${source}:${mapped}`;
  if (!allNames.includes(mapped) || seenFeatureRows.has(key)) continue;
  seenFeatureRows.add(key);
  rows.push({
    surface,
    semantic,
    source,
    mapped,
    variant,
    usedIn,
    alternatives: alternativesFor(mapped, allNames),
  });
}

const aliasPattern = /export const ([A-Za-z0-9_]+) = strokeIcon\("([^"]+)"\);/g;
for (const match of iconSource.matchAll(aliasPattern)) {
  const [, alias, mapped] = match;
  if (!allNames.includes(mapped)) continue;
  rows.push({
    surface: "API alias",
    semantic: toLabel(alias.replace(/Icon$/, "")),
    source: alias,
    mapped,
    variant: "stroke",
    usedIn: "components/ui/Icon.tsx",
    alternatives: alternativesFor(mapped, allNames),
  });
}

const systemPattern = /\s+"([^"]+)": "([^"]+)",/g;
for (const match of iconSource.matchAll(systemPattern)) {
  const [, source, mapped] = match;
  if (
    !allNames.includes(mapped) ||
    rows.some((row) => row.surface === "Native symbol" && row.source === source)
  )
    continue;
  rows.push({
    surface: "Native symbol",
    semantic: toLabel(mapped),
    source,
    mapped,
    variant: "stroke",
    usedIn: "NativeSymbol / context menus",
    alternatives: alternativesFor(mapped, allNames),
  });
}

const renderIcon = (variant, name, className = "icon") =>
  `<img class="${className}" src="${imagePath(variant, name)}" alt="" aria-hidden="true" />`;

const renderRows = rows
  .map((row) => {
    const alternatives = row.alternatives.length
      ? row.alternatives
          .map(
            (name) =>
              `<span class="alternative">${renderIcon("stroke", name, "alternative-icon")}<code>${escapeHtml(name)}</code></span>`,
          )
          .join("")
      : '<span class="muted">—</span>';

    return `<tr>
      <td class="was"><span class="meaning">${escapeHtml(row.semantic)}</span><code>${escapeHtml(row.source)}</code></td>
      <td class="became"><div class="became-main">${renderIcon(row.variant, row.mapped)}<span><strong>${escapeHtml(row.mapped)}</strong><small>${escapeHtml(row.variant)}</small></span></div></td>
      <td><div class="alternatives">${alternatives}</div></td>
      <td class="context"><strong>${escapeHtml(row.surface)}</strong><span>${escapeHtml(row.usedIn)}</span></td>
    </tr>`;
  })
  .join("");

const template = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Маппинг иконок</title>
    <style>
      :root { color-scheme: light; --ink: #111; --muted: #747474; --line: #e8e8e8; }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-width: 320px; background: #fff; color: var(--ink); }
      body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; }
      main { width: min(1320px, calc(100% - 48px)); margin: 0 auto; padding: 28px 0 64px; }
      header { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid var(--ink); }
      h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -.02em; }
      .meta { color: var(--muted); font-size: 12px; }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; min-width: 940px; border-collapse: collapse; table-layout: fixed; }
      th { padding: 0 12px 10px; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: .1em; text-align: left; text-transform: uppercase; }
      th:nth-child(1) { width: 25%; }
      th:nth-child(2) { width: 24%; }
      th:nth-child(3) { width: 34%; }
      th:nth-child(4) { width: 17%; }
      td { padding: 15px 12px; border-top: 1px solid var(--line); vertical-align: middle; }
      tbody tr:hover { background: #fafafa; }
      .was, .became-main { display: flex; align-items: center; gap: 12px; min-height: 28px; }
      .was { flex-direction: column; align-items: flex-start; gap: 3px; }
      .meaning, .became strong { font-size: 14px; font-weight: 600; }
      code { color: var(--muted); font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .icon { width: 24px; height: 24px; display: block; filter: brightness(0); }
      .became-main > span { display: flex; flex-direction: column; gap: 3px; }
      .became small { color: var(--muted); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
      .alternatives { display: flex; flex-wrap: wrap; gap: 10px 14px; }
      .alternative { display: inline-flex; align-items: center; gap: 6px; }
      .alternative-icon { width: 18px; height: 18px; }
      .context { color: var(--muted); font-size: 12px; line-height: 1.35; }
      .context strong, .context span { display: block; }
      .context strong { margin-bottom: 3px; color: var(--ink); font-size: 12px; font-weight: 600; }
      .muted { color: var(--muted); }
      @media (max-width: 700px) { main { width: calc(100% - 24px); padding-top: 18px; } header { align-items: flex-start; flex-direction: column; gap: 5px; } table { min-width: 860px; } td { padding: 13px 10px; } }
    </style>
  </head>
  <body>
    <main>
      <header><h1>Иконки · было → стало</h1><span class="meta">${rows.length} сопоставлений</span></header>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Было</th><th>Стало</th><th>Близкие варианты</th><th>Смысл · место</th></tr></thead>
          <tbody>${renderRows}</tbody>
        </table>
      </div>
    </main>
  </body>
</html>`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, template, "utf8");
console.log(`Generated ${rows.length} mapping rows at ${relative(appRoot, outputPath)}`);
