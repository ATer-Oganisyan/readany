#!/usr/bin/env node

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SOURCE_ORIGIN = "https://mishanaer-icons.vercel.app";
const ICON_VERSION = "catalog-20260818-1";

const STROKE_ICONS = [
  "archive",
  "arrow-block-up",
  "arrow-down",
  "arrow-from-square-up-right",
  "arrow-left",
  "arrow-left-right",
  "arrow-right",
  "arrow-rotate-ccw-up",
  "arrow-rotate-cw-up",
  "arrow-to-line-down",
  "arrow-up",
  "arrows-left-right",
  "battery-0%",
  "battery-25%",
  "battery-50%",
  "battery-75%",
  "battery-100%",
  "battery-charging",
  "bell",
  "bin",
  "book",
  "book-open",
  "book-open-magnifying-glass",
  "bookmark",
  "books-spines",
  "bug",
  "calendar",
  "camera",
  "chart-bar",
  "chart-line",
  "chat-bubble",
  "chat-bubbles",
  "check",
  "check-circle",
  "checks",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "chevron-up",
  "clipboard",
  "clock-3h",
  "cloud",
  "code",
  "coffee-cup",
  "copy",
  "corners",
  "corners-in",
  "crescent",
  "database",
  "diamond",
  "dots-three-horizontal",
  "dots-three-vertical",
  "exclamation-circle",
  "exclamation-triangle",
  "eye",
  "eye-slash",
  "file-plus",
  "file-txt",
  "flame",
  "folder",
  "folder-minus",
  "folder-plus",
  "funnel",
  "gear",
  "globe",
  "grid-2x2",
  "hand",
  "hash",
  "headphones",
  "history",
  "image",
  "italic",
  "layers",
  "lightbulb",
  "link",
  "list",
  "list-alt1",
  "lock-locked",
  "magic-wand",
  "magnifying-glass",
  "magnifying-glass-minus",
  "magnifying-glass-plus",
  "mic",
  "microchip",
  "minus",
  "minus-circle",
  "note",
  "paint-roller",
  "palette",
  "paperclip",
  "paperplane",
  "pause",
  "pencil",
  "pencil-square",
  "people",
  "person",
  "person-circle",
  "pin",
  "play",
  "plus",
  "plus-circle",
  "pulse-circle",
  "puzzle-piece",
  "qr-code",
  "question-circle",
  "quote-left",
  "repeat",
  "reply",
  "robot",
  "scales-of-justice",
  "seal-check",
  "share-network",
  "shield",
  "skip-backward",
  "skip-forward",
  "smiley-happy",
  "sparkles",
  "star",
  "stop",
  "strikethrough",
  "sun",
  "tag",
  "text-b",
  "text-i",
  "text-t",
  "translate",
  "trending-up",
  "trophy",
  "volume-2",
  "wrench",
  "x",
  "x-hexagon",
];

const FILLED_ICONS = [
  "bell",
  "bin",
  "book",
  "chat-bubble",
  // Upstream's solid chat-bubbles knocks three dots out of the bubble; the tab bar uses the
  // plain solid variant, so re-syncing overwrites filled/chat-bubbles.svg with the dotted one.
  "chat-bubbles",
  "cloud",
  "headphones",
  "magnifying-glass",
  "pencil-square",
  "person",
  "stop",
];

// The reader toolbar is the only native control drawing filled icons.
const NATIVE_FILLED_ICONS = ["headphones", "person", "stop"];

// Only native navigation and Compose controls need raster sources. Regular UI uses SVG.
const NATIVE_STROKE_ICONS = [
  "arrow-left",
  "arrow-right",
  "arrow-to-line-down",
  "bell",
  "bin",
  "book",
  "bookmark",
  "books-spines",
  "chart-bar",
  "camera",
  "chat-bubble",
  "check",
  "chevron-left",
  "chevron-right",
  "clipboard",
  "cloud",
  "diamond",
  "dots-three-horizontal",
  "eye",
  "file-txt",
  "folder",
  "gear",
  "globe",
  "grid-2x2",
  "hand",
  "headphones",
  "image",
  "link",
  "list",
  "lock-locked",
  "magnifying-glass",
  "mic",
  "minus",
  "note",
  "palette",
  "paperclip",
  "paperplane",
  "pause",
  "pencil",
  "pencil-square",
  "people",
  "person",
  "pin",
  "play",
  "plus",
  "pulse-circle",
  "question-circle",
  "repeat",
  "reply",
  "share-network",
  "skip-backward",
  "skip-forward",
  "smiley-happy",
  "sparkles",
  "stop",
  "text-t",
  "translate",
  "volume-2",
  "x",
];

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const assetRoot = path.join(appRoot, "assets", "icons", "mishanaer");
const nativeIosIconRoot = path.join(
  appRoot,
  "modules",
  "native-controls",
  "ios",
  "Resources",
  "MishanaerIcons",
);
const generatedFile = path.join(appRoot, "src", "components", "ui", "mishanaer-icons.generated.ts");

function toIdentifier(name) {
  return `${name
    .replaceAll("%", "-percent")
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("")}Asset`;
}

function toLocalFileName(name) {
  return name.replaceAll("%", "percent");
}

async function fetchSvg(name, variant) {
  const directory = variant === "filled" ? "icons/solid" : "icons";
  const response = await fetch(
    `${SOURCE_ORIGIN}/${directory}/${encodeURIComponent(name)}.svg?v=${ICON_VERSION}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to download ${variant}/${name}: HTTP ${response.status}`);
  }
  const svg = await response.text();
  if (!svg.startsWith("<svg")) {
    throw new Error(`Invalid SVG returned for ${variant}/${name}`);
  }
  return svg;
}

async function writeRasterSet(svg, directory, name) {
  const blackSvg = svg.replaceAll("currentColor", "#000000");
  await Promise.all(
    [1, 2, 3].map((scale) => {
      const densitySuffix = scale === 1 ? "" : `@${scale}x`;
      return sharp(Buffer.from(blackSvg))
        .resize(24 * scale, 24 * scale)
        .png()
        .toFile(path.join(directory, `${name}${densitySuffix}.png`));
    }),
  );
}

async function syncVariant(names, variant) {
  const svgDirectory = path.join(assetRoot, variant);
  await mkdir(svgDirectory, { recursive: true });

  const rasterNames = variant === "filled" ? names : NATIVE_STROKE_ICONS;
  const nativeNames = variant === "filled" ? NATIVE_FILLED_ICONS : NATIVE_STROKE_ICONS;
  const rasterDirectory = path.join(assetRoot, `${variant}-png`);
  await mkdir(rasterDirectory, { recursive: true });
  await mkdir(nativeIosIconRoot, { recursive: true });

  for (const name of names) {
    const svg = await fetchSvg(name, variant);
    await writeFile(path.join(svgDirectory, `${toLocalFileName(name)}.svg`), `${svg.trim()}\n`);
    if (rasterNames.includes(name)) {
      await writeRasterSet(svg, rasterDirectory, toLocalFileName(name));
    }
    if (nativeNames.includes(name)) {
      // Нативные контролы читают только растры: UIToolbar не умеет взять SVG,
      // как это делает JS. Суффикс отличает filled от stroke — имена там те же.
      const suffix = variant === "filled" ? "-filled" : "";
      await writeRasterSet(svg, nativeIosIconRoot, `mishanaer-${toLocalFileName(name)}${suffix}`);
    }
  }
}

function assetImport(name, variant) {
  const identifier = `${variant === "filled" ? "Filled" : "Stroke"}${toIdentifier(name)}`;
  return `import ${identifier} from "../../../assets/icons/mishanaer/${variant}/${toLocalFileName(name)}.svg";`;
}

function propertyKey(name) {
  return /^[A-Za-z_$][\w$]*$/u.test(name) ? name : JSON.stringify(name);
}

function componentEntry(name, variant) {
  const identifier = `${variant === "filled" ? "Filled" : "Stroke"}${toIdentifier(name)}`;
  return `  ${propertyKey(name)}: ${identifier},`;
}

function rasterEntry(name, variant) {
  return `  ${propertyKey(name)}: require("../../../assets/icons/mishanaer/${variant}-png/${toLocalFileName(name)}.png"),`;
}

function createGeneratedModule() {
  const importPathCollator = new Intl.Collator("en", { numeric: true });
  const imports = [
    ...STROKE_ICONS.map((name) => ({ name, variant: "stroke" })),
    ...FILLED_ICONS.map((name) => ({ name, variant: "filled" })),
  ].sort((a, b) => {
    const aPath = `${a.variant}/${toLocalFileName(a.name)}.svg`;
    const bPath = `${b.variant}/${toLocalFileName(b.name)}.svg`;
    return importPathCollator.compare(aPath, bPath);
  });

  return `${[
    "// Generated by scripts/sync-mishanaer-icons.mjs. Do not edit by hand.",
    'import type { ImageSourcePropType } from "react-native";',
    ...imports.map(({ name, variant }) => assetImport(name, variant)),
    "",
    "export const strokeIconComponents = {",
    ...STROKE_ICONS.map((name) => componentEntry(name, "stroke")),
    "} as const;",
    "",
    "export const filledIconComponents = {",
    ...FILLED_ICONS.map((name) => componentEntry(name, "filled")),
    "} as const;",
    "",
    "export const strokeIconImages = {",
    ...NATIVE_STROKE_ICONS.map((name) => rasterEntry(name, "stroke")),
    "} as const satisfies Record<string, ImageSourcePropType>;",
    "",
    "export const filledIconImages = {",
    ...FILLED_ICONS.map((name) => rasterEntry(name, "filled")),
    "} as const satisfies Record<string, ImageSourcePropType>;",
  ].join("\n")}\n`;
}

await Promise.all([
  rm(assetRoot, { recursive: true, force: true }),
  rm(nativeIosIconRoot, { recursive: true, force: true }),
]);
await Promise.all([syncVariant(STROKE_ICONS, "stroke"), syncVariant(FILLED_ICONS, "filled")]);
await writeFile(
  path.join(assetRoot, "README.md"),
  `# Mishanaer Icons\n\nSynced from ${SOURCE_ORIGIN} at version \`${ICON_VERSION}\`.\n\nRun \`node scripts/sync-mishanaer-icons.mjs\` from \`packages/app-expo\` to refresh the selected app icons.\n`,
);
await writeFile(generatedFile, createGeneratedModule());

console.log(
  `Synced ${STROKE_ICONS.length} stroke and ${FILLED_ICONS.length} filled icons from ${SOURCE_ORIGIN}.`,
);
