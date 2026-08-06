#!/usr/bin/env node

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, "..");
const REPOSITORY_DIR = path.resolve(APP_DIR, "..", "..");
const WEBSITE_PUBLIC_DIR = path.join(REPOSITORY_DIR, "website", "public");
const MANIFEST_PATH = path.join(WEBSITE_PUBLIC_DIR, "cover-assets", "manifest.json");
const OUTPUT_DIR = path.join(
  APP_DIR,
  "assets",
  "catalog",
  "cover-variants",
  "nano-varied-backgrounds-v2",
);

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
await mkdir(OUTPUT_DIR, { recursive: true });

for (const [index, book] of manifest.books.entries()) {
  const output = book.outputs?.["nano-banana"];
  if (output?.status !== "ready" || !output.path) {
    throw new Error(`Nano Banana cover is unavailable: ${book.id}`);
  }

  const sourcePath = path.join(WEBSITE_PUBLIC_DIR, output.path.replace(/^\/+/, ""));
  const destinationPath = path.join(OUTPUT_DIR, `${book.id}.jpg`);
  await sharp(sourcePath)
    .flatten({ background: "#ffffff" })
    .resize(1024, 1536, { fit: "cover" })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(destinationPath);
  process.stdout.write(`[${index + 1}/${manifest.books.length}] ${book.id}\n`);
}

process.stdout.write("Nano Banana varied-background covers synced to Storybook.\n");
