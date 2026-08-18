#!/usr/bin/env node

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_DIR = path.join(APP_DIR, "assets", "catalog", "character-video-samples");
const TARGET = path.join(APP_DIR, "src", "lib", "narra", "catalog-character-video-assets.ts");
const SUFFIX = "-grok-eyebrow-hair-only-batch5";

const entries = [];
for (const fileName of (await readdir(OUTPUT_DIR)).filter((name) =>
  name.endsWith(`${SUFFIX}.json`),
)) {
  const metadata = JSON.parse(await readFile(path.join(OUTPUT_DIR, fileName), "utf8"));
  const sourceParts = String(metadata.sourceImage).split("/");
  const charactersIndex = sourceParts.lastIndexOf("characters");
  const bookId = sourceParts[charactersIndex + 1];
  const characterId = sourceParts[charactersIndex + 2]?.replace(/\.jpg$/u, "");
  const rawStem = path.basename(fileName, ".json");
  const boomerangFile = `${rawStem}-boomerang.mp4`;
  const boomerangPath = path.join(OUTPUT_DIR, boomerangFile);
  try {
    await readFile(boomerangPath);
  } catch {
    continue;
  }
  if (!bookId || !characterId) continue;
  entries.push({
    key: `${bookId}/${characterId}`,
    file: boomerangFile,
  });
}

entries.sort((left, right) => left.key.localeCompare(right.key));
const body = [
  "/** Bundled Grok character loops; generated from the batch-5 metadata files. */",
  "export const CATALOG_CHARACTER_VIDEO_ASSETS: Readonly<Record<string, number>> = {",
  ...entries.map(
    ({ key, file }) =>
      `  ${JSON.stringify(key)}: require(${JSON.stringify(`../../../assets/catalog/character-video-samples/${file}`)}),`,
  ),
  "};",
  "",
].join("\n");

await writeFile(TARGET, body);
process.stdout.write(`Wrote ${entries.length} catalog character video assets to ${TARGET}\n`);
