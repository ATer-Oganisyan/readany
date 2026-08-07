/**
 * «Оживление» картинок через OpenRouter Veo (P18) — image-to-video.
 *
 * Контракт /videos (проверен живым вызовом 2026-08): POST {baseUrl}/videos
 * с frame_images (first-frame conditioning, data:-URL исходного кадра)
 * возвращает 202 с job id → поллинг GET {baseUrl}/videos/{id} до
 * completed/failed → скачивание mp4 из unsigned_urls[0] с тем же ключом.
 *
 * Модель и параметры — animate-generation-config.json (дефолт
 * google/veo-3.1-lite: 4 с, 720p, без аудио ≈ $0.12 за ролик, ~70 с);
 * override — EXPO_PUBLIC_OPENROUTER_VIDEO_MODEL. Ориентация 16:9/9:16
 * (других Veo не поддерживает) выбирается по соотношению исходной картинки.
 *
 * Генерация ТОЛЬКО по явному тапу пользователя — это платные вызовы.
 */

import {
  bundledOpenRouterEndpoint,
  getBundledApiKey,
  hasBundledOpenRouterKey,
} from "@/config/bundled-ai";
import * as FileSystem from "expo-file-system/legacy";
import { fetch } from "expo/fetch";
import { Image } from "react-native";
import animateGenerationConfig from "./animate-generation-config.json";
import { narraMediaTargetPath, trackNarraMediaJob } from "./media";

const DEFAULT_VIDEO_MODEL = animateGenerationConfig.openRouterModel;
const POLL_INITIAL_INTERVAL_MS = 5_000;
const POLL_MAX_INTERVAL_MS = 15_000;
const POLL_BACKOFF_FACTOR = 1.2;
const JOB_TIMEOUT_MS = 4 * 60_000;

export type NarraImageOrientation = "landscape" | "portrait";

export interface AnimateNarraImageInput {
  /** file://-URI исходной картинки (сцена или портрет героя). */
  imageUri: string;
  /** Промпт движения из animate-prompt.ts. */
  motionPrompt: string;
  /** Ключ имени mp4-файла в narra-media (уникализируется меткой времени). */
  cacheKey: string;
  /** Явная ориентация; без неё определяется по размерам исходной картинки. */
  orientation?: NarraImageOrientation;
}

interface OpenRouterVideoJob {
  id?: string;
  status?: "pending" | "in_progress" | "processing" | "completed" | "failed";
  unsigned_urls?: string[];
  usage?: { cost?: number };
  error?: string | { message?: string };
}

function videoModel(): string {
  return process.env.EXPO_PUBLIC_OPENROUTER_VIDEO_MODEL?.trim() || DEFAULT_VIDEO_MODEL;
}

function jobError(job: OpenRouterVideoJob): string | undefined {
  return typeof job.error === "string" ? job.error : job.error?.message;
}

function imageMimeType(uri: string): string {
  return /\.png$/i.test(uri) ? "image/png" : "image/jpeg";
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

/** Ориентация картинки по её реальным размерам; при ошибке — альбомная. */
function detectOrientation(imageUri: string): Promise<NarraImageOrientation> {
  return new Promise((resolve) => {
    Image.getSize(
      imageUri,
      (width, height) => resolve(height > width ? "portrait" : "landscape"),
      () => resolve("landscape"),
    );
  });
}

async function createAnimationJob(
  baseUrl: string,
  apiKey: string,
  input: AnimateNarraImageInput,
  orientation: NarraImageOrientation,
): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(input.imageUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const response = await fetch(`${baseUrl}/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: videoModel(),
      prompt: input.motionPrompt,
      duration: animateGenerationConfig.durationSeconds,
      resolution: animateGenerationConfig.resolution,
      aspect_ratio:
        orientation === "portrait"
          ? animateGenerationConfig.portraitAspectRatio
          : animateGenerationConfig.landscapeAspectRatio,
      generate_audio: animateGenerationConfig.generateAudio,
      frame_images: [
        {
          type: "image_url",
          image_url: { url: `data:${imageMimeType(input.imageUri)};base64,${base64}` },
          frame_type: "first_frame",
        },
      ],
    }),
  });
  const job = (await response.json()) as OpenRouterVideoJob;
  if (!response.ok || !job.id) {
    throw new Error(jobError(job) || `OpenRouter video request failed (${response.status})`);
  }
  return job.id;
}

async function waitForAnimationJob(
  baseUrl: string,
  apiKey: string,
  jobId: string,
): Promise<OpenRouterVideoJob> {
  const startedAt = Date.now();
  let interval = POLL_INITIAL_INTERVAL_MS;
  while (Date.now() - startedAt < JOB_TIMEOUT_MS) {
    await sleep(interval);
    interval = Math.min(interval * POLL_BACKOFF_FACTOR, POLL_MAX_INTERVAL_MS);
    const response = await fetch(`${baseUrl}/videos/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const job = (await response.json()) as OpenRouterVideoJob;
    if (!response.ok) {
      throw new Error(jobError(job) || `OpenRouter video status failed (${response.status})`);
    }
    if (job.status === "completed") return job;
    if (job.status === "failed") {
      throw new Error(jobError(job) || "OpenRouter video generation failed");
    }
  }
  throw new Error("TIMEOUT: OpenRouter video generation timed out");
}

async function animateNarraImageRequest(input: AnimateNarraImageInput): Promise<string> {
  if (!hasBundledOpenRouterKey) {
    throw new Error("OpenRouter video generation is not configured");
  }
  const apiKey = getBundledApiKey(bundledOpenRouterEndpoint);
  const baseUrl = bundledOpenRouterEndpoint.baseUrl.replace(/\/+$/, "");
  const orientation = input.orientation ?? (await detectOrientation(input.imageUri));

  const jobId = await createAnimationJob(baseUrl, apiKey, input, orientation);
  const job = await waitForAnimationJob(baseUrl, apiKey, jobId);
  const contentUrl = job.unsigned_urls?.[0] ?? `${baseUrl}/videos/${jobId}/content?index=0`;

  const path = await narraMediaTargetPath(`${input.cacheKey}-${Date.now()}`, "mp4");
  const download = await FileSystem.downloadAsync(contentUrl, path, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (download.status !== 200) {
    await FileSystem.deleteAsync(path, { idempotent: true });
    throw new Error(`OpenRouter video download failed (${download.status})`);
  }
  return path;
}

/**
 * Оживляет картинку в зацикливаемое mp4-видео и возвращает file://-путь
 * в narra-media. Ошибки — сырые Error: экраны показывают человеческое
 * сообщение через reportNarraError/normalizeNarraError.
 */
export function animateNarraImage(input: AnimateNarraImageInput): Promise<string> {
  return trackNarraMediaJob("video", "user", () => animateNarraImageRequest(input), {
    provider: "openrouter",
    model: videoModel(),
  });
}
