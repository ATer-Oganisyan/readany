#!/usr/bin/env node

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { BUNDLED_CATALOG_BOOK_DEFINITIONS } from "../src/lib/catalog/bundled-book-definitions";
import { getBundledCatalogCharactersById } from "../src/lib/narra/bundled-catalog-characters";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_DIR = path.join(APP_DIR, "assets", "catalog", "characters");
const REGISTRY_FILE = path.join(
  APP_DIR,
  "src",
  "lib",
  "narra",
  "catalog-character-portrait-assets.ts",
);
const DEFAULT_ENV_FILE = path.join(APP_DIR, ".env.local");
const CONFIG_FILE = path.join(APP_DIR, "src", "lib", "book", "cover-generation-config.json");
const REQUEST_TIMEOUT_MS = 180_000;
const CONCURRENCY = 8;

function parseEnv(source: string): Record<string, string> {
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

async function readLocalEnv(): Promise<Record<string, string>> {
  const envFile = process.env.NARRA_ENV_FILE || DEFAULT_ENV_FILE;
  try {
    return parseEnv(await readFile(envFile, "utf8"));
  } catch {
    return {};
  }
}

function buildPrompt(input: {
  bookTitle: string;
  author: string;
  fullName: string;
  role: string;
  appearance: string;
}): string {
  return [
    "Use case: historical-scene",
    "Asset type: bundled square character portrait for a mobile reading app",
    `Primary request: create a distinctive portrait of ${input.fullName}, a character from \"${input.bookTitle}\" by ${input.author}.`,
    `Character role: ${input.role}.`,
    `Appearance: ${input.appearance}.`,
    "Style/medium: refined realistic painted portrait with natural skin texture; visually consistent with a serious literary edition, not a photo of an actor.",
    "Composition/framing: one person only, centered head-and-shoulders, face fully visible, looking toward camera, square crop with safe margins.",
    "Scene/backdrop: understated period-appropriate interior or neutral painterly background.",
    "Lighting/mood: soft directional museum portrait lighting, emotionally true to the character.",
    "Constraints: historically accurate clothing for the book; no modern objects; no text; no letters; no frame; no border; no watermark.",
  ].join("\n");
}

async function generatePortrait(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
}): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${input.baseUrl.replace(/\/+$/u, "")}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        aspect_ratio: "1:1",
        quality: "high",
        output_format: "jpeg",
        output_compression: 82,
        n: 1,
      }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as {
      data?: Array<{ b64_json?: string; media_type?: string }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(payload.error?.message || `Image request failed (${response.status})`);
    }
    const image = payload.data?.[0];
    if (!image?.b64_json) throw new Error("Image response did not contain image data");
    return Buffer.from(image.b64_json.replace(/^data:[^;]+;base64,/u, ""), "base64");
  } finally {
    clearTimeout(timeout);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeAssetRegistry(): Promise<void> {
  const entries = BUNDLED_CATALOG_BOOK_DEFINITIONS.flatMap((book) =>
    (getBundledCatalogCharactersById(book.id) ?? []).map(
      (character) =>
        `  "${book.id}/${character.id}": require("../../../assets/catalog/characters/${book.id}/${character.id}.jpg"),`,
    ),
  );
  await writeFile(
    REGISTRY_FILE,
    [
      'import type { ImageSourcePropType } from "react-native";',
      "",
      "export const CATALOG_CHARACTER_PORTRAIT_ASSETS: Readonly<",
      "  Record<string, ImageSourcePropType>",
      "> = {",
      ...entries,
      "};",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const localEnv = await readLocalEnv();
  const config = JSON.parse(await readFile(CONFIG_FILE, "utf8")) as { openRouterModel: string };
  const apiKey = process.env.OPENROUTER_API_KEY || localEnv.EXPO_PUBLIC_OPENROUTER_API_KEY;
  const baseUrl =
    process.env.OPENROUTER_BASE_URL ||
    localEnv.EXPO_PUBLIC_OPENROUTER_BASE_URL ||
    "https://openrouter.ai/api/v1";
  const model =
    process.env.OPENROUTER_IMAGE_MODEL ||
    localEnv.EXPO_PUBLIC_OPENROUTER_IMAGE_MODEL ||
    config.openRouterModel;
  const requestedBookId = process.argv.find((arg) => arg.startsWith("--book="))?.slice(7);
  const force = process.argv.includes("--force");
  if (!apiKey) throw new Error("OpenRouter API key is not configured");

  const jobs = BUNDLED_CATALOG_BOOK_DEFINITIONS.filter(
    (book) => !requestedBookId || book.id === requestedBookId,
  ).flatMap((book) =>
    (getBundledCatalogCharactersById(book.id) ?? []).map((character) => ({
      book,
      character,
      outputPath: path.join(OUTPUT_DIR, book.id, `${character.id}.jpg`),
    })),
  );
  if (requestedBookId && jobs.length === 0)
    throw new Error(`Unknown catalog book: ${requestedBookId}`);

  let cursor = 0;
  let completed = 0;
  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const index = cursor++;
      const job = jobs[index];
      if (!job) return;
      await mkdir(path.dirname(job.outputPath), { recursive: true });
      if (!force && (await exists(job.outputPath))) {
        completed += 1;
        process.stdout.write(
          `[${completed}/${jobs.length}] ${job.book.id}/${job.character.id}: уже есть\n`,
        );
        continue;
      }
      const temporaryPath = `${job.outputPath}.${process.pid}.tmp`;
      try {
        const jpeg = await generatePortrait({
          apiKey,
          baseUrl,
          model,
          prompt: buildPrompt({
            bookTitle: job.book.title,
            author: job.book.author,
            fullName: job.character.fullName,
            role: job.character.role,
            appearance: job.character.appearancePrompt,
          }),
        });
        await writeFile(temporaryPath, jpeg);
        await rename(temporaryPath, job.outputPath);
        completed += 1;
        process.stdout.write(
          `[${completed}/${jobs.length}] ${job.book.id}/${job.character.id}: готово\n`,
        );
      } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()));
  if (!requestedBookId) await writeAssetRegistry();
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
