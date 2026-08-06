#!/usr/bin/env node

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_DIR = path.resolve(SCRIPT_DIR, "..");
const REPOSITORY_DIR = path.resolve(WEBSITE_DIR, "..");
const BOOKS_FILE = path.join(WEBSITE_DIR, "src", "data", "cover-comparison-books.json");
const OUTPUT_ROOT = path.join(WEBSITE_DIR, "public", "cover-assets");
const MANIFEST_FILE = path.join(OUTPUT_ROOT, "manifest.json");
const ENV_FILE = path.join(REPOSITORY_DIR, "packages", "app-expo", ".env.local");
const BASE_URL = "https://openrouter.ai/api/v1";
const REQUEST_TIMEOUT_MS = 180_000;
const CONCURRENCY = 2;

const PROVIDERS = [
  {
    id: "nano-banana",
    label: "Nano Banana 2",
    model: "google/gemini-3.1-flash-image",
    parameters: { resolution: "1K" },
  },
  {
    id: "gpt-image",
    label: "GPT Image 2",
    model: "openai/gpt-image-2",
    parameters: { quality: "high" },
  },
];

const PROMPT_TEMPLATE = `Create the complete front-cover artwork for a contemporary intellectual book.

BOOK SUBJECT:
{{BOOK_SUBJECT}}

REQUIRED DOMINANT BACKGROUND COLOR:
{{BACKGROUND_COLOR}}

Translate the book’s central idea into one bold, intelligent and slightly unexpected visual metaphor. Do not illustrate the plot literally. The image should feel like an art director’s conceptual solution: restrained, cultured, memorable, subtly strange and open to interpretation.

Visual language: independent European art publishing, late modernist editorial design, Soviet and Central European book graphics, constructivist composition, archival visual culture, experimental museum catalogues and small intellectual publishing houses.

Use a distinctive combination of no more than two techniques: archival photography, hand-drawn illustration, engraving, photocopy, paper collage, flat geometric shapes, found imagery, halftone screening, risograph or imperfect offset printing. Combine analogue materiality with a precise contemporary composition.

Create one dominant graphic element or conceptual object. It must be the only primary focal point.

Place this dominant element within the lower two-thirds of the vertical canvas, from approximately 35% of the canvas height down to the bottom edge. Its visual center should sit approximately 60–72% down from the top edge. Let the object occupy a substantial part of the lower two-thirds instead of compressing it into the bottom third. It may extend through the middle and lower regions, approach, touch or be partially cropped by the bottom edge.

Keep the upper third visually quiet and subordinate. Fill this area with the required dominant background color, continuous paper texture, delicate print grain and subtle tonal variation. Quiet means low-detail, not blank, white, cream or beige. The upper area must remain part of the finished full-bleed artwork, but it must not contain a separate object, face, figure, symbol, strong geometric shape, high-contrast detail or secondary focal point.

The viewer’s eye must be drawn unmistakably into the lower two-thirds of the cover. The composition should feel deliberately weighted below the upper third: approximately 30% quiet visual field above and 70% active composition below.

Avoid centered, vertically balanced, symmetrical or evenly distributed compositions. Do not place the dominant element in the top third; it may occupy both the middle and bottom thirds as one continuous focal form. Do not repeat the primary object elsewhere in the image. Avoid decorative clutter. Every element must support the central metaphor.

Use radical cropping, unexpected scale, controlled asymmetry and visual tension. Prefer one clear visual gesture over a collection of small details.

Use the REQUIRED DOMINANT BACKGROUND COLOR as the unmistakable base color across the entire canvas. Add only 1–3 restrained supporting ink colors chosen for controlled contrast. Do not default to warm off-white, beige, cream, ivory, parchment, yellowed paper or natural kraft paper. Any visible paper texture must be dyed or printed in the required background color.

Add subtle analogue materiality: matte uncoated paper, paper grain, ink bleed, uneven registration, halftone dots, photocopy noise, worn printed texture or slightly irregular hand-cut edges. The result should feel physically printed rather than digitally rendered. Keep the texture refined and intentional, not dirty or excessively distressed.

The artwork must cover the entire vertical canvas from edge to edge. Full bleed, including the upper area. No exterior margins, frame, white border, passe-partout, separate title panel or unfinished background.

The quiet upper third must not look like an empty white margin or a reserved title box. It should be a deliberately composed field of color, paper texture and subtle printed variation, continuous with the rest of the artwork.

CRITICAL BACKGROUND RULE: the required background color must cover the complete canvas edge-to-edge and remain clearly visible across the quiet upper third and around the main object below. It must read as an intentional colored field, not as aging, discoloration or a small accent. Do not replace it with beige, cream, ivory, warm off-white or yellowed paper.

Flat, front-facing 2D artwork only. Generate the artwork itself, not a photograph or mockup of a physical book. No spine, perspective, hands, table, surrounding objects, realistic shadows or presentation scene.

ABSOLUTELY NO TEXT: no title, no author name, no publisher name, no logo, no letters from any alphabet, no words, no numbers, no captions, no labels, no handwriting, no typographic symbols, no fake text, no text-like marks, no signatures, no stamps and no barcode anywhere in the image.

Do not create abstract shapes resembling letters, numbers or writing. Replace any possible writing, document fragments or printed inscriptions with pure nonverbal texture.

Avoid glossy commercial illustration, cinematic lighting, photorealistic advertising, fantasy concept art, generic surrealism, polished 3D rendering, digital gradients, neon effects, stock-photo aesthetics and obvious AI-generated details.

CRITICAL COMPOSITION RULE: the main graphic element must not be confined to the bottom third. It must occupy the lower two-thirds of the canvas, beginning around 35% from the top and extending through the middle toward the bottom edge. No dominant element may appear in the upper third.

CRITICAL OUTPUT RULE: generate only the complete full-bleed cover artwork. Zero visible text. No mockup, no border and no reserved typography area.

Vertical book-cover format, 2:3 aspect ratio, high resolution, print-ready visual quality.`;

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

function buildPrompt(book) {
  const context = `Context for meaning only; never reproduce these names as text: “${book.title}” by ${book.author}. ${book.subject}`;
  return PROMPT_TEMPLATE.replace("{{BOOK_SUBJECT}}", context).replace(
    "{{BACKGROUND_COLOR}}",
    book.background,
  );
}

function extensionFor(mediaType) {
  if (mediaType === "image/jpeg" || mediaType === "image/jpg") return "jpg";
  if (mediaType === "image/webp") return "webp";
  return "png";
}

async function findExisting(providerId, bookId) {
  for (const extension of ["jpg", "jpeg", "png", "webp"]) {
    const candidate = path.join(OUTPUT_ROOT, providerId, `${bookId}.${extension}`);
    try {
      const info = await stat(candidate);
      if (info.size > 10_000) return candidate;
    } catch {
      // Continue searching.
    }
  }
  return null;
}

async function generateImage({ apiKey, provider, book }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:4321/ReadAny/cover-comparison",
        "X-Title": "Narra Cover Comparison",
      },
      body: JSON.stringify({
        model: provider.model,
        prompt: buildPrompt(book),
        aspect_ratio: "2:3",
        ...provider.parameters,
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
    if (!image?.b64_json) throw new Error("The response contains no image data");
    const mediaType = image.media_type || "image/png";
    return {
      buffer: Buffer.from(image.b64_json.replace(/^data:[^;]+;base64,/u, ""), "base64"),
      extension: extensionFor(mediaType),
      mediaType,
      cost: payload?.usage?.cost ?? null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function writeGeneratedImage({ apiKey, provider, book, force }) {
  const existing = force ? null : await findExisting(provider.id, book.id);
  if (existing) {
    return {
      status: "ready",
      path: `/cover-assets/${provider.id}/${path.basename(existing)}`,
      cached: true,
      cost: null,
    };
  }

  await mkdir(path.join(OUTPUT_ROOT, provider.id), { recursive: true });
  const generated = await generateImage({ apiKey, provider, book });
  const outputPath = path.join(OUTPUT_ROOT, provider.id, `${book.id}.${generated.extension}`);
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, generated.buffer);
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return {
    status: "ready",
    path: `/cover-assets/${provider.id}/${path.basename(outputPath)}`,
    cached: false,
    cost: generated.cost,
  };
}

async function runPool(tasks, worker, concurrency) {
  let nextIndex = 0;
  const results = Array(tasks.length);
  async function run() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await worker(tasks[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, run));
  return results;
}

async function main() {
  const books = JSON.parse(await readFile(BOOKS_FILE, "utf8"));
  const localEnv = parseEnv(await readFile(ENV_FILE, "utf8"));
  const apiKey = process.env.OPENROUTER_API_KEY || localEnv.EXPO_PUBLIC_OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter API key is not configured");

  const force = process.argv.includes("--force");
  const requestedBook = process.argv.find((argument) => argument.startsWith("--id="))?.slice(5);
  const requestedProvider = process.argv
    .find((argument) => argument.startsWith("--provider="))
    ?.slice(11);
  const selectedBooks = requestedBook ? books.filter((book) => book.id === requestedBook) : books;
  const selectedProviders = requestedProvider
    ? PROVIDERS.filter((provider) => provider.id === requestedProvider)
    : PROVIDERS;
  if (selectedBooks.length === 0) throw new Error(`Unknown book: ${requestedBook}`);
  if (selectedProviders.length === 0) throw new Error(`Unknown provider: ${requestedProvider}`);

  await mkdir(OUTPUT_ROOT, { recursive: true });
  const tasks = selectedBooks.flatMap((book) =>
    selectedProviders.map((provider) => ({ book, provider })),
  );
  const generated = new Map();
  let completed = 0;
  let totalCost = 0;
  await runPool(
    tasks,
    async ({ book, provider }) => {
      const prefix = `[${++completed}/${tasks.length}] ${book.id} · ${provider.label}`;
      process.stdout.write(`${prefix}… `);
      try {
        const result = await writeGeneratedImage({ apiKey, provider, book, force });
        generated.set(`${book.id}:${provider.id}`, result);
        if (typeof result.cost === "number") totalCost += result.cost;
        process.stdout.write(result.cached ? "уже есть\n" : "готово\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        generated.set(`${book.id}:${provider.id}`, { status: "error", error: message });
        process.stdout.write(`ошибка: ${message}\n`);
      }
    },
    CONCURRENCY,
  );

  // Preserve successful entries from previous partial runs.
  let previous = { books: [] };
  try {
    previous = JSON.parse(await readFile(MANIFEST_FILE, "utf8"));
  } catch {
    // This is the first run.
  }
  const previousById = new Map(previous.books.map((book) => [book.id, book]));
  const manifestBooks = [];
  for (const book of books) {
    const previousBook = previousById.get(book.id);
    const outputs = {};
    for (const provider of PROVIDERS) {
      const currentOutput = generated.get(`${book.id}:${provider.id}`);
      const previousOutput = previousBook?.outputs?.[provider.id];
      outputs[provider.id] =
        currentOutput?.status === "error" && previousOutput?.status === "ready"
          ? previousOutput
          : currentOutput || previousOutput || { status: "missing" };
    }
    manifestBooks.push({ ...book, outputs });
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    promptTemplate: PROMPT_TEMPLATE,
    providers: PROVIDERS,
    books: manifestBooks,
  };
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`Манифест обновлён. Стоимость этого запуска: $${totalCost.toFixed(4)}\n`);
}

await main();
