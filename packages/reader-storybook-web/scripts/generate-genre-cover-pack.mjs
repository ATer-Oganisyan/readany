#!/usr/bin/env node

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STORYBOOK_DIR = path.resolve(SCRIPT_DIR, "..");
const REPOSITORY_DIR = path.resolve(STORYBOOK_DIR, "../..");
const BOOKS_FILE = path.join(STORYBOOK_DIR, "genre-cover-books.json");
const OUTPUT_DIR = path.join(STORYBOOK_DIR, "public", "genre-covers");
const MANIFEST_FILE = path.join(OUTPUT_DIR, "manifest.json");
const ENV_FILE = path.join(REPOSITORY_DIR, "packages", "app-expo", ".env.local");
const CONFIG_FILE = path.join(
  REPOSITORY_DIR,
  "packages",
  "app-expo",
  "src",
  "lib",
  "book",
  "cover-generation-config.json",
);
const BASE_URL = "https://openrouter.ai/api/v1";
const REQUEST_TIMEOUT_MS = 180_000;
const CONCURRENCY = 2;

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/gu, "")];
      }),
  );
}

function buildPrompt(template, book) {
  const replacements = {
    "{{BOOK_TITLE}}": book.title,
    "{{AUTHOR}}": book.author,
    "{{BOOK_DESCRIPTION}}": book.description,
    "{{BOOK_GENRE}}": book.genreLabel,
    "{{GENRE_ART_DIRECTION}}": book.stylePrompt,
    "{{BACKGROUND_COLOR}}": book.background,
  };
  return Object.entries(replacements).reduce(
    (prompt, [placeholder, value]) => prompt.replaceAll(placeholder, value),
    template,
  );
}

async function generateImage({ apiKey, model, prompt }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:3210/#genre-covers",
        "X-Title": "Narra Genre Cover Storybook",
      },
      body: JSON.stringify({
        model,
        prompt,
        aspect_ratio: "2:3",
        quality: "high",
        output_format: "jpeg",
        output_compression: 90,
        n: 1,
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || `OpenRouter returned ${response.status}`);
    }
    const image = payload?.data?.[0];
    if (!image?.b64_json) throw new Error("OpenRouter response contains no image data");
    return {
      bytes: Buffer.from(image.b64_json.replace(/^data:[^;]+;base64,/u, ""), "base64"),
      cost: payload?.usage?.cost ?? null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).size > 10_000;
  } catch {
    return false;
  }
}

async function runPool(items, worker) {
  let nextIndex = 0;
  const results = Array(items.length);
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return results;
}

async function main() {
  const [books, localEnv, config] = await Promise.all([
    readFile(BOOKS_FILE, "utf8").then(JSON.parse),
    readFile(ENV_FILE, "utf8").then(parseEnv),
    readFile(CONFIG_FILE, "utf8").then(JSON.parse),
  ]);
  const apiKey = process.env.OPENROUTER_API_KEY || localEnv.EXPO_PUBLIC_OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter API key is not configured");

  const model = process.env.OPENROUTER_IMAGE_MODEL || config.openRouterModel;
  const template = config.promptParagraphs.join("\n\n");
  const force = process.argv.includes("--force");
  const requestedId = process.argv.find((argument) => argument.startsWith("--id="))?.slice(5);
  const selectedBooks = requestedId ? books.filter((book) => book.id === requestedId) : books;
  if (selectedBooks.length === 0) throw new Error(`Unknown book: ${requestedId}`);

  await mkdir(OUTPUT_DIR, { recursive: true });
  let totalCost = 0;
  const results = await runPool(selectedBooks, async (book, index) => {
    const outputPath = path.join(OUTPUT_DIR, `${book.id}.jpg`);
    process.stdout.write(`[${index + 1}/${selectedBooks.length}] ${book.id}… `);
    if (!force && (await fileExists(outputPath))) {
      process.stdout.write("уже есть\n");
      return { id: book.id, status: "ready", cached: true, path: `/genre-covers/${book.id}.jpg` };
    }

    const temporaryPath = `${outputPath}.${process.pid}.tmp`;
    try {
      const result = await generateImage({ apiKey, model, prompt: buildPrompt(template, book) });
      await writeFile(temporaryPath, result.bytes);
      await rename(temporaryPath, outputPath);
      if (typeof result.cost === "number") totalCost += result.cost;
      process.stdout.write("готово\n");
      return {
        id: book.id,
        status: "ready",
        cached: false,
        path: `/genre-covers/${book.id}.jpg`,
        cost: result.cost,
      };
    } catch (error) {
      await rm(temporaryPath, { force: true });
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`ошибка: ${message}\n`);
      return { id: book.id, status: "error", error: message };
    }
  });

  const manifestBooks = await Promise.all(
    books.map(async (book) => {
      const current = results.find((result) => result.id === book.id);
      const outputPath = path.join(OUTPUT_DIR, `${book.id}.jpg`);
      const output =
        current ||
        ((await fileExists(outputPath))
          ? { id: book.id, status: "ready", cached: true, path: `/genre-covers/${book.id}.jpg` }
          : { id: book.id, status: "missing" });
      return { ...book, output };
    }),
  );
  const manifest = {
    generatedAt: new Date().toISOString(),
    provider: "OpenRouter",
    model,
    totalCost,
    books: manifestBooks,
  };
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`Манифест обновлён. Стоимость запуска: $${totalCost.toFixed(4)}\n`);
}

await main();
