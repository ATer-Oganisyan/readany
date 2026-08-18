#!/usr/bin/env node

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_DIR = path.resolve(APP_DIR, "../..");
const ENV_FILE = path.join(APP_DIR, ".env.local");
const OUTPUT_DIR = path.join(APP_DIR, "assets", "catalog", "character-video-samples");
const CHARACTERS_DIR = path.join(APP_DIR, "assets", "catalog", "characters");
const DEFAULT_MODEL = "x-ai/grok-imagine-video-1.5";
const DURATION_SECONDS = 4;
const RESOLUTION = "720p";
const POLL_INTERVAL_MS = 5_000;
const JOB_TIMEOUT_MS = 10 * 60_000;
const PROMPT_VARIANTS = new Set([
  "baseline",
  "locked-blink",
  "locked-still",
  "pixel-locked-still",
  "facial-microexpression",
  "facial-microexpression-natural-motion",
  "facial-microexpression-natural-motion-batch2",
  "facial-brow-only-batch3",
  "facial-brow-only-no-breathing-batch4",
  "grok-eyebrow-hair-only-batch5",
  "seedance-2.0-fast-brow-only-no-breathing",
]);

const SAMPLES = [
  {
    id: "anna-karenina",
    bookId: "anna-karenina",
    characterId: "anna-karenina",
    characterName: "Анна Каренина",
    bookTitle: "Анна Каренина",
    aspectRatio: "3:4",
    motion:
      "One soft natural blink near the middle of the clip, one extremely subtle breathing cycle, and an almost imperceptible settling movement in a single loose curl and the pearl earrings. The lips remain completely still.",
  },
  {
    id: "rodion-raskolnikov",
    bookId: "crime-and-punishment",
    characterId: "rodion-raskolnikov",
    characterName: "Родион Раскольников",
    bookTitle: "Преступление и наказание",
    aspectRatio: "3:4",
    motion:
      "One soft natural blink near the middle of the clip, one extremely subtle breathing cycle visible only in the shoulders and coat collar, and a tiny natural eye-focus adjustment. Keep the grave neutral expression unchanged and the lips completely still.",
  },
  {
    id: "buratino",
    bookId: "golden-key",
    characterId: "buratino",
    characterName: "Буратино",
    bookTitle: "Золотой ключик",
    aspectRatio: "1:1",
    motion:
      "One soft natural blink near the middle of the clip and an almost imperceptible closed-cycle sway of the cap tassel. Preserve the exact shape and length of the wooden nose, the smile, and every facial proportion. The mouth remains completely still.",
  },
  {
    id: "natasha-rostova",
    bookId: "war-and-peace",
    characterId: "natasha-rostova",
    characterName: "Наташа Ростова",
    bookTitle: "Война и мир",
    aspectRatio: "3:4",
    motion: "One soft blink and an almost imperceptible closed-cycle movement in one loose curl.",
  },
  {
    id: "evgeny-bazarov",
    bookId: "fathers-and-sons",
    characterId: "evgeny-bazarov",
    characterName: "Евгений Базаров",
    bookTitle: "Отцы и дети",
    aspectRatio: "3:4",
    motion: "One soft blink while the expression, hair, clothing, and body remain still.",
  },
  {
    id: "eugene-onegin",
    bookId: "eugene-onegin",
    characterId: "eugene-onegin",
    characterName: "Евгений Онегин",
    bookTitle: "Евгений Онегин",
    aspectRatio: "3:4",
    motion: "One soft blink while the expression, hair, clothing, and body remain still.",
  },
  {
    id: "grigory-pechorin",
    bookId: "hero-of-our-time",
    characterId: "grigory-pechorin",
    characterName: "Григорий Печорин",
    bookTitle: "Герой нашего времени",
    aspectRatio: "3:4",
    motion: "One soft blink while the expression, uniform, hair, and body remain still.",
  },
  {
    id: "ostap-bender",
    bookId: "twelve-chairs",
    characterId: "ostap-bender",
    characterName: "Остап Бендер",
    bookTitle: "Двенадцать стульев",
    aspectRatio: "3:4",
    motion: "One soft blink while the expression, cap, scarf, clothing, and body remain still.",
  },
  {
    id: "pavel-chichikov",
    bookId: "dead-souls",
    characterId: "pavel-chichikov",
    characterName: "Павел Чичиков",
    bookTitle: "Мёртвые души",
    aspectRatio: "3:4",
    motion: "One soft blink while the smile, hair, cravat, clothing, and body remain still.",
  },
  {
    id: "katerina-kabanova",
    bookId: "thunderstorm",
    characterId: "katerina-kabanova",
    characterName: "Катерина Кабанова",
    bookTitle: "Гроза",
    aspectRatio: "3:4",
    motion: "One soft blink while the expression, hair, earrings, clothing, and body remain still.",
  },
];

function humanizeCatalogSlug(value) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

async function readCatalogSamples() {
  const bookEntries = await readdir(CHARACTERS_DIR, { withFileTypes: true });
  const samples = [];
  for (const bookEntry of bookEntries) {
    if (!bookEntry.isDirectory()) continue;
    const characterEntries = await readdir(path.join(CHARACTERS_DIR, bookEntry.name), {
      withFileTypes: true,
    });
    for (const characterEntry of characterEntries) {
      if (!characterEntry.isFile() || !characterEntry.name.endsWith(".jpg")) continue;
      const characterId = characterEntry.name.slice(0, -4);
      samples.push({
        id: characterId,
        bookId: bookEntry.name,
        characterId,
        characterName: humanizeCatalogSlug(characterId),
        bookTitle: humanizeCatalogSlug(bookEntry.name),
        aspectRatio: bookEntry.name === "golden-key" && characterId === "buratino" ? "1:1" : "3:4",
        motion: "",
      });
    }
  }
  return samples.sort((left, right) =>
    `${left.bookId}/${left.characterId}`.localeCompare(`${right.bookId}/${right.characterId}`),
  );
}

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        const value = line
          .slice(separator + 1)
          .trim()
          .replace(/^['"]|['"]$/gu, "");
        return [key, value];
      }),
  );
}

function buildBaselinePrompt(sample) {
  return `Animate the provided portrait as an almost-still living painting in a perfectly seamless ${DURATION_SECONDS}-second loop.

CRITICAL LOOP REQUIREMENT: the first and final frames must be visually identical — exactly the same pose, head position, gaze, facial expression, open eyes, closed mouth, hair, clothing, background, lighting, composition, framing, and camera position. Every movement must form a closed cycle and return smoothly to its precise starting state before the final frame. Motion must flow continuously across the loop boundary with matching direction and speed, with no cut, jump, crossfade, transition, pause, deceleration, or visible reset.

Keep the camera completely locked. Preserve the character's exact identity, facial proportions, age, hairstyle, costume, painterly texture, colors, and original visual style.

Add only extremely subtle natural micro-motion: ${sample.motion}

The character must remain almost completely still. No speaking, no lip movement, no head turn, no body movement, no expression change, no camera movement, no zoom, no pan, no reframing, no focus shift, no background movement, no morphing, no warping, no facial distortion, no texture crawling, no flicker, and no new objects.

The result must feel like a still portrait that has quietly come alive while remaining a perfectly seamless infinite loop.`;
}

function buildLockedBlinkPrompt() {
  return `Create a perfectly seamless ${DURATION_SECONDS}-second loop from the provided portrait.

STATIC LOCKED CAMERA. The character remains perfectly still in the exact same pose, position, scale, composition, lighting, colors, facial expression, clothing, props, background, focus, depth of field, camera angle, and original painterly style. Preserve the exact identity, facial proportions, textures, and every detail of the source image.

CRITICAL LOOP REQUIREMENT: the first and final frames must be visually identical. Start and end with the eyes fully open in exactly the same position and expression. Keep the first and final half-second perfectly still. The blink must begin and finish entirely within the middle of the clip, returning to the exact source image well before the final frame. No cut, crossfade, transition, jump, pause at the seam, or visible reset.

The only action is exactly one slow natural blink. Close both eyelids naturally, hold them closed for one short beat, then reopen them in three or four small steps. After reopening, keep the eyes fully open and perfectly still for the rest of the clip. The irises, pupils, eyeballs, eyebrows, gaze direction, and surrounding face must remain fixed. The only changed pixels should be the eyelids and the immediately adjacent natural eyelid folds.

Do not add breathing or any secondary motion. Do not move the head, body, ears, tail, eyebrows, mouth, nose, hands, hair, jewelry, clothing, props, background, or any object. No expression change, camera motion, zoom, pan, reframing, focus shift, depth-of-field change, lighting change, color shift, flicker, texture crawling, morphing, warping, facial distortion, new object, or additional effect.

Preserve the original image everywhere except the eyelids. The result must look like the unchanged source portrait performing one controlled blink inside a perfectly seamless infinite loop.`;
}

function buildLockedStillPrompt() {
  return `Create a perfectly seamless ${DURATION_SECONDS}-second loop from the provided portrait.

ABSOLUTELY STATIC, PIXEL-LOCKED CAMERA AND FRAMING. Preserve the character’s exact identity, pose, position, scale, composition, lighting, colors, facial expression, clothing, props, background, focus, depth of field, camera angle, textures, and original visual style.

The image plane must remain completely frozen: identical crop, subject size, framing, and pixel alignment in every frame. ZERO optical or digital zoom of any kind, including any slow, subtle, or imperceptible zoom in, zoom out, push-in, or pull-out. No change in focal length, perspective, parallax, stabilization, or simulated camera motion.

The eyes remain fully open and perfectly still throughout the entire clip. No blinking. Keep the irises, pupils, gaze direction, eyebrows, eyelids, mouth, nose, head, ears, tail, hands, hair, clothing, props, and background fixed.

CRITICAL SEAMLESS LOOP REQUIREMENT: the first and final frames must be visually identical. Keep the first and final half-second perfectly still.

No camera movement, zoom, pan, reframing, expression change, lip movement, eye movement, lighting change, color shift, focus shift, flicker, texture crawling, morphing, warping, new objects, additional effects, cuts, crossfades, transitions, jumps, pauses, or visible resets at the seam.

  Preserve the original image everywhere.`;
}

function buildFacialMicroexpressionPrompt() {
  return `Create a seamless ${DURATION_SECONDS}-second loop from the provided portrait.

CAMERA LOCK: Treat the source image as a fixed 2D plate. Lock the camera and image plane completely. Every frame must have the exact same crop, framing, scale, perspective, focal length, and pixel alignment as the source image. No camera path or image-plane transformation: no zoom in, zoom out, push-in, pull-out, pan, tilt, dolly, orbit, parallax, stabilization, shake, reframing, rescaling, or background drift. The subject and every background edge must remain registered to the same pixel coordinates.

CHARACTER: Preserve the exact identity, pose, proportions, clothing, props, lighting, colors, textures, background, and original visual style. Keep the eyes open and the gaze fixed. Allow only one barely perceptible facial micro-expression in the middle of the clip: a slight softening or tension in the eyebrows and/or a tiny change at the mouth corners. Keep the lips closed. No eye, head, body, hair, clothing, prop, or breathing movement.

LOOP: The first and final frames must be identical to the original source image. The micro-expression must begin and end within the middle of the clip. Keep the first and final 0.5 seconds completely still and return to the exact source frame before the end. No cuts, crossfades, transitions, jumps, visible reset, flicker, morphing, warping, focus shift, lighting change, or color shift.

  Preserve the original portrait everywhere except for the minimal facial micro-expression.`;
}

function buildFacialMicroexpressionNaturalMotionPrompt() {
  return `Create a seamless ${DURATION_SECONDS}-second loop from the provided portrait.

CAMERA LOCK: Treat the source image as a fixed 2D plate. Lock the camera and image plane completely. Every frame must have the exact same crop, framing, scale, perspective, focal length, and pixel alignment as the source image. No camera path or image-plane transformation: no zoom in, zoom out, push-in, pull-out, pan, tilt, dolly, orbit, parallax, stabilization, shake, reframing, rescaling, or background drift. The subject and every background edge must remain registered to the same pixel coordinates.

CHARACTER: Preserve the exact identity, pose, proportions, clothing, props, lighting, colors, textures, background, and original visual style. Keep the eyes open and the gaze fixed.

MICRO-EXPRESSION: Allow only one ultra-subtle facial micro-expression in the middle of the clip: a barely detectable softening or tension in the eyebrows and/or an almost imperceptible relaxation of the mouth corners. Do not create a smile, grin, smirk, or visible change in the mouth silhouette. Keep the lips closed and teeth fully hidden. The expression must remain neutral and return exactly to the original source expression. Keep facial landmarks in their original relative arrangement and proportions; no facial warping, independent eye movement, or speech.

NATURAL MOTION: Allow one shallow, natural breathing cycle with an almost imperceptible rise and fall of the upper chest and shoulders. Permit minimal natural head settling and barely visible hair movement that follows the head. These movements must be slow, restrained, and return smoothly to the exact starting pose. No large head turn, nod, body gesture, clothing movement, or prop movement. These are subject motions only; the camera and image plane remain completely pixel-locked.

LOOP: The first and final frames must be identical to the original source image. The micro-expression, breathing, head settling, and hair movement must begin and end within the middle of the clip. Keep the first and final 0.5 seconds completely still and return to the exact source frame before the end. No cuts, crossfades, transitions, jumps, visible reset, flicker, morphing, warping, focus shift, lighting change, or color shift.

  Preserve the original portrait everywhere except for the minimal facial micro-expression and restrained natural motion.`;
}

function buildFacialBrowOnlyPrompt() {
  return `Create a seamless ${DURATION_SECONDS}-second loop from the provided portrait.

CAMERA LOCK: Treat the source image as a fixed 2D plate. Lock the camera and image plane completely. Every frame must have the exact same crop, framing, scale, perspective, focal length, and pixel alignment as the source image. No camera path or image-plane transformation: no zoom in, zoom out, push-in, pull-out, pan, tilt, dolly, orbit, parallax, stabilization, shake, reframing, rescaling, or background drift. The subject and every background edge must remain registered to the same pixel coordinates.

CHARACTER: Preserve the exact identity, pose, proportions, clothing, props, lighting, colors, textures, background, and original visual style. Keep the eyes open and the gaze fixed.

MICRO-EXPRESSION: Allow only one ultra-subtle change in eyebrow muscle tension in the middle of the clip. Keep the mouth, lips, mouth corners, cheeks, jaw, and chin completely unchanged. Do not create a smile, grin, smirk, or any change in the mouth silhouette. Keep the lips closed and teeth fully hidden. Keep facial landmarks in their original relative arrangement and proportions; no facial warping, independent eye movement, or speech.

NATURAL MOTION: Permit minimal natural head settling and barely visible hair movement that follows the head. These movements must be slow, restrained, and return smoothly to the exact starting pose. No breathing motion, chest expansion, shoulder lift, torso sway, large head turn, nod, body gesture, clothing movement, or prop movement. These are subject motions only; the camera and image plane remain completely pixel-locked.

LOOP: The first and final frames must be identical to the original source image. The eyebrow micro-expression, head settling, and hair movement must begin and end within the middle of the clip. Keep the first and final 0.5 seconds completely still and return to the exact source frame before the end. No cuts, crossfades, transitions, jumps, visible reset, flicker, morphing, warping, focus shift, lighting change, or color shift.

  Preserve the original portrait everywhere except for the minimal eyebrow micro-expression and restrained natural motion.`;
}

function buildGrokEyebrowHairOnlyPrompt() {
  return `Create a perfectly seamless ${DURATION_SECONDS}-second loop from the provided portrait.

CAMERA LOCK: Treat the source image as a fixed 2D plate. Lock the camera and image plane completely. Every frame must have the exact same crop, framing, scale, perspective, focal length, and pixel alignment as the source image. No camera path or image-plane transformation: no zoom in, zoom out, push-in, pull-out, pan, tilt, dolly, orbit, parallax, stabilization, shake, reframing, rescaling, or background drift. The subject and every background edge must remain registered to the same pixel coordinates.

CHARACTER: Preserve the exact identity, pose, proportions, clothing, props, lighting, colors, textures, background, and original visual style. Keep the eyes open and the gaze fixed.

MOTION: Allow only one almost imperceptible change in eyebrow tension in the middle of the clip, plus barely perceptible hair movement. All movement must be slow, restrained, and form a complete closed cycle. No shoulder movement, eye or mouth movement, smile, grin, speech, head turn or nod, body movement, clothing movement, or prop movement.

LOOP: The first and final frames must be identical to the original source image. The eyebrow change and hair movement must begin and end within the middle of the clip. Keep the first and final 0.5 seconds completely still and return to the exact source frame before the end. No cuts, crossfades, transitions, jumps, visible reset, flicker, morphing, warping, focus shift, lighting change, or color shift.

Preserve the original portrait everywhere except for the minimal eyebrow change and barely perceptible hair movement.`;
}

function buildSeedanceFrameLockedPrompt() {
  return `Create a perfectly seamless ${DURATION_SECONDS}-second loop from the provided portrait.

FRAME LOCK: Use the supplied portrait as both the exact first frame and the exact last frame. The opening and closing frames must match the source image pixel-for-pixel in composition, crop, subject size, pose, expression, lighting, colors, texture, and background. Return completely to that source image before the final frame.

CAMERA LOCK: Treat the portrait as a fixed 2D plate. Keep the camera and image plane pixel-locked in every frame: no zoom in, zoom out, push-in, pull-out, pan, tilt, dolly, orbit, parallax, stabilization, shake, reframing, rescaling, focal-length change, perspective change, or background drift. Every background edge must stay registered to the same pixel coordinates.

CHARACTER: Preserve the exact identity, proportions, clothing, props, lighting, colors, textures, and original visual style. Keep the eyes open, gaze fixed, lips closed, and mouth silhouette unchanged.

MOTION: Allow only one almost imperceptible eyebrow-tension change in the middle of the clip, plus minimal natural head settling and barely visible hair movement that follows the head. Keep all motion slow, restrained, and closed-cycle. No breathing, chest or shoulder movement, blinking, eye movement, mouth movement, smile, grin, smirk, speech, head turn, nod, body gesture, clothing movement, or prop movement.

LOOP: Keep the first and final 0.5 seconds completely still. Start the tiny subject motion only after the opening hold, finish it in the middle, and return to the exact source image well before the closing hold. No cuts, crossfades, transitions, jumps, pauses, visible resets, flicker, morphing, warping, focus shift, lighting change, color shift, or added objects.

Preserve the original portrait everywhere except for the restrained eyebrow, head-settling, and hair motion.`;
}

function buildPrompt(sample, variant) {
  if (variant === "locked-blink") return buildLockedBlinkPrompt();
  if (variant === "facial-microexpression") return buildFacialMicroexpressionPrompt();
  if (variant === "facial-microexpression-natural-motion") {
    return buildFacialMicroexpressionNaturalMotionPrompt();
  }
  if (variant === "facial-microexpression-natural-motion-batch2") {
    return buildFacialMicroexpressionNaturalMotionPrompt();
  }
  if (variant === "facial-brow-only-batch3") return buildFacialBrowOnlyPrompt();
  if (variant === "facial-brow-only-no-breathing-batch4") return buildFacialBrowOnlyPrompt();
  if (variant === "grok-eyebrow-hair-only-batch5") return buildGrokEyebrowHairOnlyPrompt();
  if (variant === "seedance-2.0-fast-brow-only-no-breathing") {
    return buildSeedanceFrameLockedPrompt();
  }
  if (variant === "locked-still" || variant === "pixel-locked-still") {
    return buildLockedStillPrompt();
  }
  return buildBaselinePrompt(sample);
}

function imagePath(sample) {
  return path.join(
    APP_DIR,
    "assets",
    "catalog",
    "characters",
    sample.bookId,
    `${sample.characterId}.jpg`,
  );
}

function outputStem(sample, variant) {
  if (variant === "locked-blink") return `${sample.id}-locked-blink`;
  if (variant === "locked-still") return `${sample.id}-locked-still`;
  if (variant === "pixel-locked-still") return `${sample.id}-pixel-locked-still`;
  if (variant === "facial-microexpression") return `${sample.id}-facial-microexpression`;
  if (variant === "facial-microexpression-natural-motion") {
    return `${sample.id}-facial-microexpression-natural-motion`;
  }
  if (variant === "facial-microexpression-natural-motion-batch2") {
    return `${sample.id}-facial-microexpression-natural-motion-batch2`;
  }
  if (variant === "facial-brow-only-batch3") return `${sample.id}-facial-brow-only-batch3`;
  if (variant === "facial-brow-only-no-breathing-batch4") {
    return `${sample.id}-facial-brow-only-no-breathing-batch4`;
  }
  if (variant === "grok-eyebrow-hair-only-batch5") {
    return `${sample.id}-grok-eyebrow-hair-only-batch5`;
  }
  if (variant === "seedance-2.0-fast-brow-only-no-breathing") {
    return `${sample.id}-seedance-2.0-fast-brow-only-no-breathing`;
  }
  return sample.id;
}

function outputPath(sample, variant) {
  return path.join(OUTPUT_DIR, `${outputStem(sample, variant)}.mp4`);
}

function metadataPath(sample, variant) {
  return path.join(OUTPUT_DIR, `${outputStem(sample, variant)}.json`);
}

function errorMessage(payload, fallback) {
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  if (typeof payload?.message === "string") return payload.message;
  return fallback;
}

async function responsePayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

async function submitJob({ apiKey, baseUrl, sample, prompt, model, frameMode }) {
  const image = await readFile(imagePath(sample));
  const imageDataUrl = `data:image/jpeg;base64,${image.toString("base64")}`;
  const frameImages = [
    {
      type: "image_url",
      image_url: { url: imageDataUrl },
      frame_type: "first_frame",
    },
  ];
  if (frameMode === "first-and-last") {
    frameImages.push({
      type: "image_url",
      image_url: { url: imageDataUrl },
      frame_type: "last_frame",
    });
  }
  const response = await fetch(`${baseUrl}/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost",
      "X-Title": "Narra character loop study",
    },
    body: JSON.stringify({
      model,
      prompt,
      duration: DURATION_SECONDS,
      resolution: RESOLUTION,
      aspect_ratio: sample.aspectRatio,
      generate_audio: false,
      frame_images: frameImages,
    }),
  });
  const payload = await responsePayload(response);
  if (!response.ok || !payload.id) {
    throw new Error(errorMessage(payload, `OpenRouter submit failed (${response.status})`));
  }
  return payload;
}

function resolvePollingUrl(baseUrl, job) {
  if (!job.polling_url) return `${baseUrl}/videos/${job.id}`;
  if (/^https?:\/\//u.test(job.polling_url)) return job.polling_url;
  return new URL(job.polling_url, `${baseUrl}/`).toString();
}

async function waitForJob({ apiKey, baseUrl, job }) {
  const pollingUrl = resolvePollingUrl(baseUrl, job);
  const startedAt = Date.now();
  while (Date.now() - startedAt < JOB_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    let response;
    try {
      response = await fetch(pollingUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (error) {
      process.stdout.write(
        `  status: network retry (${error instanceof Error ? error.message : String(error)})\n`,
      );
      continue;
    }
    const payload = await responsePayload(response);
    if (!response.ok) {
      throw new Error(errorMessage(payload, `OpenRouter polling failed (${response.status})`));
    }
    const status = payload.status ?? "unknown";
    process.stdout.write(`  status: ${status}\n`);
    if (status === "completed") return payload;
    if (status === "failed") {
      throw new Error(errorMessage(payload, "OpenRouter video generation failed"));
    }
  }
  throw new Error(`OpenRouter video generation timed out after ${JOB_TIMEOUT_MS / 60_000} minutes`);
}

async function downloadVideo({ apiKey, baseUrl, job, destination }) {
  const contentUrl = job.unsigned_urls?.[0] ?? `${baseUrl}/videos/${job.id}/content?index=0`;
  const response = await fetch(contentUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const payload = await responsePayload(response);
    throw new Error(errorMessage(payload, `OpenRouter download failed (${response.status})`));
  }
  const temporaryPath = `${destination}.${process.pid}.tmp`;
  await writeFile(temporaryPath, Buffer.from(await response.arrayBuffer()));
  await rename(temporaryPath, destination);
}

async function generateSample({
  apiKey,
  baseUrl,
  sample,
  variant,
  model,
  frameMode,
  force,
  resumeJobId,
}) {
  const destination = outputPath(sample, variant);
  if (!force && !resumeJobId) {
    try {
      await readFile(destination);
      process.stdout.write(`${sample.characterName}: уже существует, пропускаю\n`);
      return;
    } catch {
      // Continue with a paid generation only when no result exists.
    }
  }

  const prompt = buildPrompt(sample, variant);
  let submittedJob;
  if (resumeJobId) {
    submittedJob = { id: resumeJobId };
    process.stdout.write(`${sample.characterName} [${variant}]: продолжаю job ${resumeJobId}\n`);
  } else {
    process.stdout.write(
      `${sample.characterName} [${variant}]: отправляю ${model}, ${DURATION_SECONDS}s, ${RESOLUTION}, ${frameMode}\n`,
    );
    submittedJob = await submitJob({ apiKey, baseUrl, sample, prompt, model, frameMode });
  }
  process.stdout.write(`  job: ${submittedJob.id}\n`);
  const completedJob = await waitForJob({ apiKey, baseUrl, job: submittedJob });
  await downloadVideo({
    apiKey,
    baseUrl,
    job: completedJob,
    destination,
  });
  await writeFile(
    metadataPath(sample, variant),
    `${JSON.stringify(
      {
        character: sample.characterName,
        book: sample.bookTitle,
        sourceImage: path.relative(REPO_DIR, imagePath(sample)),
        outputVideo: path.relative(REPO_DIR, destination),
        model,
        promptVariant: variant,
        frameMode,
        durationSeconds: DURATION_SECONDS,
        resolution: RESOLUTION,
        aspectRatio: sample.aspectRatio,
        generateAudio: false,
        prompt,
        jobId: completedJob.id ?? submittedJob.id,
        generationId: completedJob.generation_id ?? submittedJob.generation_id ?? null,
        usage: completedJob.usage ?? null,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `${sample.characterName}: готово → ${path.relative(REPO_DIR, destination)}\n`,
  );
}

async function main() {
  const localEnv = parseEnv(await readFile(ENV_FILE, "utf8"));
  const apiKey = process.env.OPENROUTER_API_KEY || localEnv.EXPO_PUBLIC_OPENROUTER_API_KEY;
  const baseUrl = (
    process.env.OPENROUTER_BASE_URL ||
    localEnv.EXPO_PUBLIC_OPENROUTER_BASE_URL ||
    "https://openrouter.ai/api/v1"
  ).replace(/\/+$/u, "");
  if (!apiKey) throw new Error("OpenRouter API key is not configured");

  const requestedIds = process.argv
    .filter((argument) => argument.startsWith("--sample="))
    .map((argument) => argument.slice("--sample=".length));
  const availableSamples = process.argv.includes("--all-catalog")
    ? await readCatalogSamples()
    : SAMPLES;
  const selected = availableSamples.filter(
    (sample) => requestedIds.length === 0 || requestedIds.includes(sample.id),
  );
  if (selected.length === 0) {
    throw new Error(`Unknown sample: ${requestedIds.join(", ")}`);
  }

  const variant =
    process.argv
      .find((argument) => argument.startsWith("--variant="))
      ?.slice("--variant=".length) ?? "baseline";
  if (!PROMPT_VARIANTS.has(variant)) {
    throw new Error(`Unknown prompt variant: ${variant}`);
  }

  const model =
    process.argv.find((argument) => argument.startsWith("--model="))?.slice("--model=".length) ??
    process.env.OPENROUTER_VIDEO_MODEL ??
    localEnv.EXPO_PUBLIC_OPENROUTER_VIDEO_MODEL ??
    DEFAULT_MODEL;
  const frameMode =
    variant === "seedance-2.0-fast-brow-only-no-breathing" ? "first-and-last" : "first-frame";

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    for (const sample of selected) {
      process.stdout.write(
        `\n=== ${sample.characterName} / ${variant} (${sample.aspectRatio}) ===\n${buildPrompt(sample, variant)}\n`,
      );
    }
    return;
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const force = process.argv.includes("--force");
  const resumeJobId = process.argv
    .find((argument) => argument.startsWith("--resume-job="))
    ?.slice("--resume-job=".length);
  if (resumeJobId && selected.length !== 1) {
    throw new Error("--resume-job requires exactly one --sample");
  }

  const concurrencyArgument = process.argv
    .find((argument) => argument.startsWith("--concurrency="))
    ?.slice("--concurrency=".length);
  const concurrency = concurrencyArgument ? Number(concurrencyArgument) : 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) {
    throw new Error("--concurrency must be an integer between 1 and 3");
  }

  let nextIndex = 0;
  const failures = [];
  const worker = async () => {
    while (nextIndex < selected.length) {
      const sample = selected[nextIndex];
      nextIndex += 1;
      try {
        await generateSample({
          apiKey,
          baseUrl,
          sample,
          variant,
          model,
          frameMode,
          force,
          resumeJobId,
        });
      } catch (error) {
        const destination = outputPath(sample, variant);
        await rm(`${destination}.${process.pid}.tmp`, { force: true });
        failures.push({ sample, error });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, () => worker()));
  if (failures.length > 0) {
    throw new Error(
      failures
        .map(
          ({ sample, error }) =>
            `${sample.characterName}: ${error instanceof Error ? error.message : String(error)}`,
        )
        .join("\n"),
    );
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
