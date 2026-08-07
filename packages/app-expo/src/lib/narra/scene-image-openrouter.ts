/**
 * Генерация изображений сцен через OpenRouter (P16) — единая точка входа.
 *
 * Путь тот же, что у обложек (generate-book-cover.ts): POST {baseUrl}/images
 * со встроенным ключом из bundled-ai; модель и параметры — в
 * scene-generation-config.json. Промпт — 5-блочная схема scene-prompt.ts,
 * БЕЗ цензорной нейтрализации текста и safety-фолбэка (это костыли под
 * цензора Кандинского, они искажали сцены).
 *
 * Без встроенного ключа приложение честно откатывается на прежний
 * гейтвей-путь (media.ts → Kandinsky), там нейтрализация сохранена.
 *
 * Референс-изображения (портреты героев) эндпоинт /images НЕ учитывает:
 * живой вызов 2026-08 принимает поле image, но игнорирует его содержимое,
 * поэтому консистентность героев держим паспортами внешности в промпте.
 */

import {
  bundledOpenRouterEndpoint,
  getBundledApiKey,
  hasBundledOpenRouterKey,
} from "@/config/bundled-ai";
import { fetch } from "expo/fetch";
import { generateSceneImage, persistSceneImageBase64, trackNarraMediaJob } from "./media";
import sceneGenerationConfig from "./scene-generation-config.json";
import { buildScenePrompt } from "./scene-prompt";
import type { NarraCharacter } from "./types";

const DEFAULT_SCENE_MODEL = sceneGenerationConfig.openRouterModel;
const REQUEST_TIMEOUT_MS = 180_000;

interface OpenRouterImageResponse {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  error?: { message?: string };
}

function sceneModel(): string {
  return process.env.EXPO_PUBLIC_OPENROUTER_SCENE_IMAGE_MODEL?.trim() || DEFAULT_SCENE_MODEL;
}

/** Метаданные книги для блоков «эпоха/мир» и жанра (лениво, вне юнит-тестов). */
function bookMetaForPrompt(bookId: string): {
  title: string;
  author?: string;
  description?: string;
  subjects?: string[];
} {
  const { useLibraryStore } = require("@/stores") as typeof import("@/stores");
  const book = useLibraryStore.getState().books.find((item) => item.id === bookId);
  return {
    title: book?.meta.title ?? "",
    author: book?.meta.author || undefined,
    description: book?.meta.description || undefined,
    subjects: book?.meta.subjects,
  };
}

/**
 * Отрывки 1–2 последних сцен книги из narra-store — контекст «ранее в книге»
 * для связной серии иллюстраций. Текущий отрывок исключается (перегенерация).
 */
function previousSceneExcerpts(bookId: string, currentExcerpt: string): string[] {
  const { useNarraStore } = require("@/stores") as typeof import("@/stores");
  const scenes = useNarraStore.getState().books[bookId]?.scenes;
  if (!scenes) return [];
  return Object.values(scenes)
    .filter((scene) => scene.imageUri && scene.excerpt && scene.excerpt !== currentExcerpt)
    .sort((a, b) => b.generatedAt - a.generatedAt)
    .slice(0, 2)
    .map((scene) => scene.excerpt);
}

async function generateSceneImageViaOpenRouter(
  bookId: string,
  chapter: string,
  excerpt: string,
  characters: NarraCharacter[],
): Promise<string> {
  const apiKey = getBundledApiKey(bundledOpenRouterEndpoint);
  const baseUrl = bundledOpenRouterEndpoint.baseUrl.replace(/\/+$/, "");
  const book = bookMetaForPrompt(bookId);
  const prompt = buildScenePrompt({
    bookTitle: book.title,
    bookAuthor: book.author,
    bookDescription: book.description,
    bookSubjects: book.subjects,
    chapter,
    excerpt,
    characters,
    previousExcerpts: previousSceneExcerpts(bookId, excerpt),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: sceneModel(),
        prompt,
        aspect_ratio: sceneGenerationConfig.aspectRatio,
        quality: sceneGenerationConfig.quality,
        output_format: sceneGenerationConfig.outputFormat,
        output_compression: sceneGenerationConfig.outputCompression,
        n: 1,
      }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as OpenRouterImageResponse;
    if (!response.ok) {
      throw new Error(
        payload.error?.message || `OpenRouter scene image request failed (${response.status})`,
      );
    }
    const image = payload.data?.[0];
    if (!image?.b64_json) throw new Error("OpenRouter scene image response is empty");
    const extension = image.media_type === "image/png" ? "png" : "jpg";
    return persistSceneImageBase64(bookId, image.b64_json, extension);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Единая точка генерации сцены: OpenRouter при наличии встроенного ключа,
 * иначе прежний гейтвей-путь. Сигнатура совпадает с generateSceneImage.
 *
 * При ошибке OpenRouter (собственный цензор OpenAI режет узнаваемых
 * франшизных героев — проверено живым вызовом на «Гарри Поттере»; сеть;
 * лимиты) сцена не ломается: пробуем прежний гейтвей-путь. Обе попытки
 * видны в телеметрии со своими provider.
 */
export async function generateNarraSceneImage(
  bookId: string,
  chapter: string,
  excerpt: string,
  characters: NarraCharacter[],
): Promise<string> {
  if (!hasBundledOpenRouterKey) {
    return generateSceneImage(bookId, chapter, excerpt, characters);
  }
  try {
    return await trackNarraMediaJob(
      "image",
      "user",
      () => generateSceneImageViaOpenRouter(bookId, chapter, excerpt, characters),
      { provider: "openrouter", model: sceneModel() },
    );
  } catch (cause) {
    console.warn("[narra] OpenRouter scene image failed, falling back to gateway", cause);
    return generateSceneImage(bookId, chapter, excerpt, characters);
  }
}
