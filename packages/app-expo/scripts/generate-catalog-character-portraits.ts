#!/usr/bin/env node

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { BUNDLED_CATALOG_BOOK_DEFINITIONS } from "../src/lib/catalog/bundled-book-definitions";
import { getBundledCatalogCharactersById } from "../src/lib/narra/bundled-catalog-characters";
import { buildCharacterPortraitPrompt } from "../src/lib/narra/portrait-prompt";

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
const CONFIRMED_ADULT_FEMALE_CHARACTER_IDS = new Set([
  "anna-odintsova",
  "fenichka",
  "anna-karenina",
  "kitty-shcherbatskaya",
  "marya-bolkonskaya",
  "helene-bezukhova",
  "avdotya-raskolnikova",
  "anna-andreyevna",
  "nastasya-korobochka",
  "vera",
  "gentlemans-wife",
  "nadezhda",
  "ellohka-shchukina",
  "madame-gritsatsuyeva",
  "liza-kalachova",
  "olga-prozorova",
  "masha-kulygina",
  "irina-prozorova",
  "natalya-prozorova",
  "irina-arkadina",
  "masha-shamrayeva",
  "lyubov-ranevskaya",
  "varya",
  "katerina-kabanova",
  "marfa-kabanova",
]);
const DEFAULT_ENV_FILE = path.join(APP_DIR, ".env.local");
const CONFIG_FILE = path.join(APP_DIR, "src", "lib", "book", "cover-generation-config.json");
const REQUEST_TIMEOUT_MS = 180_000;
const CONCURRENCY = 8;

interface GenerationFailure {
  bookId: string;
  characterId: string;
  femaleBodyDirection: boolean;
  message: string;
}

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
        aspect_ratio: "3:4",
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

async function modifiedAtOrAfter(filePath: string, timestamp: number): Promise<boolean> {
  try {
    return (await stat(filePath)).mtimeMs >= timestamp;
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
      "export const CATALOG_CHARACTER_PORTRAIT_ASSETS: Readonly<Record<string, ImageSourcePropType>> = {",
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
  const requestedBookIds = process.argv
    .filter((arg) => arg.startsWith("--book="))
    .map((arg) => arg.slice(7));
  const requestedCharacterId = process.argv
    .find((arg) => arg.startsWith("--character="))
    ?.slice(12);
  const assumeAdultFemale = process.argv.includes("--assume-adult-female");
  const excludedCharacterIds = new Set(
    process.argv
      .filter((arg) => arg.startsWith("--exclude-character="))
      .map((arg) => arg.slice(20)),
  );
  const force = process.argv.includes("--force");
  const resumeSinceArgument = process.argv
    .find((arg) => arg.startsWith("--resume-since="))
    ?.slice(15);
  const resumeSince = resumeSinceArgument ? Date.parse(resumeSinceArgument) : Number.NaN;
  if (resumeSinceArgument && !Number.isFinite(resumeSince)) {
    throw new Error(`Invalid --resume-since timestamp: ${resumeSinceArgument}`);
  }
  if (!apiKey) throw new Error("OpenRouter API key is not configured");

  const jobs = BUNDLED_CATALOG_BOOK_DEFINITIONS.filter(
    (book) => requestedBookIds.length === 0 || requestedBookIds.includes(book.id),
  ).flatMap((book) =>
    (getBundledCatalogCharactersById(book.id) ?? [])
      .filter((character) => !requestedCharacterId || character.id === requestedCharacterId)
      .filter((character) => !excludedCharacterIds.has(character.id))
      .map((character) => ({
        book,
        character,
        outputPath: path.join(OUTPUT_DIR, book.id, `${character.id}.jpg`),
      })),
  );
  if ((requestedBookIds.length > 0 || requestedCharacterId) && jobs.length === 0)
    throw new Error(
      `Unknown catalog selection: book=${requestedBookIds.join(",") || "*"}, character=${requestedCharacterId ?? "*"}`,
    );

  let cursor = 0;
  let completed = 0;
  const failures: GenerationFailure[] = [];
  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const index = cursor++;
      const job = jobs[index];
      if (!job) return;
      await mkdir(path.dirname(job.outputPath), { recursive: true });
      if (Number.isFinite(resumeSince) && (await modifiedAtOrAfter(job.outputPath, resumeSince))) {
        completed += 1;
        process.stdout.write(
          `[${completed}/${jobs.length}] ${job.book.id}/${job.character.id}: уже готово в этом прогоне\n`,
        );
        continue;
      }
      if (!force && (await exists(job.outputPath))) {
        completed += 1;
        process.stdout.write(
          `[${completed}/${jobs.length}] ${job.book.id}/${job.character.id}: уже есть\n`,
        );
        continue;
      }
      const temporaryPath = `${job.outputPath}.${process.pid}.tmp`;
      const femaleBodyDirection =
        job.character.gender === "female" &&
        (assumeAdultFemale || CONFIRMED_ADULT_FEMALE_CHARACTER_IDS.has(job.character.id));
      try {
        const jpeg = await generatePortrait({
          apiKey,
          baseUrl,
          model,
          prompt: buildCharacterPortraitPrompt(job.character, {
            bookContext: `«${job.book.title}» (${job.book.author})`,
            genreId: "classic",
            genreLabel: "классическая литература",
            assumeAdultFemale: femaleBodyDirection,
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
        const message = error instanceof Error ? error.message : String(error);
        failures.push({
          bookId: job.book.id,
          characterId: job.character.id,
          femaleBodyDirection,
          message,
        });
        process.stderr.write(
          `[отказ] ${job.book.id}/${job.character.id}${femaleBodyDirection ? " [женский блок]" : ""}: ${message}\n`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()));
  if (requestedBookIds.length === 0) await writeAssetRegistry();
  process.stdout.write(
    `Итог: готово ${completed}/${jobs.length}, отказов ${failures.length}, отказов с женским блоком ${failures.filter((failure) => failure.femaleBodyDirection).length}.\n`,
  );
  if (failures.length > 0) process.exitCode = 2;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
