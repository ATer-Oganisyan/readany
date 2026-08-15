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

import { hasBundledOpenRouterKey } from "@/config/bundled-ai";
import {
  OPENROUTER_FALLBACK_IMAGE_MODEL,
  type OpenRouterImageRequest,
  generateOpenRouterImageWithFallback,
} from "@/lib/ai/openrouter-image";
import type { NarraGenreAnalysis } from "./genre-analysis";
import { generateSceneImage, persistSceneImageBase64, trackNarraMediaJob } from "./media";
import sceneGenerationConfig from "./scene-generation-config.json";
import { buildScenePrompt } from "./scene-prompt";
import type { NarraCharacter } from "./types";

const DEFAULT_SCENE_MODEL = sceneGenerationConfig.openRouterModel;

function sceneModel(): string {
  return process.env.EXPO_PUBLIC_OPENROUTER_SCENE_IMAGE_MODEL?.trim() || DEFAULT_SCENE_MODEL;
}

/** Метаданные книги для блоков «эпоха/мир» и жанра (лениво, вне юнит-тестов). */
function bookMetaForPrompt(bookId: string): {
  title: string;
  author?: string;
  description?: string;
  subjects?: string[];
  analyzedGenre?: NarraGenreAnalysis;
} {
  const { useLibraryStore, useNarraStore } = require("@/stores") as typeof import("@/stores");
  const book = useLibraryStore.getState().books.find((item) => item.id === bookId);
  return {
    title: book?.meta.title ?? "",
    author: book?.meta.author || undefined,
    description: book?.meta.description || undefined,
    subjects: book?.meta.subjects,
    analyzedGenre: useNarraStore.getState().books[bookId]?.genre,
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
  const book = bookMetaForPrompt(bookId);
  const prompt = buildScenePrompt({
    bookTitle: book.title,
    bookAuthor: book.author,
    bookDescription: book.description,
    bookSubjects: book.subjects,
    analyzedGenre: book.analyzedGenre,
    chapter,
    excerpt,
    characters,
    previousExcerpts: previousSceneExcerpts(bookId, excerpt),
  });

  const image = await generateOpenRouterImageWithFallback(
    {
      model: sceneModel(),
      prompt,
      aspectRatio: sceneGenerationConfig.aspectRatio as OpenRouterImageRequest["aspectRatio"],
      quality: sceneGenerationConfig.quality as OpenRouterImageRequest["quality"],
      outputFormat: sceneGenerationConfig.outputFormat as OpenRouterImageRequest["outputFormat"],
      outputCompression: sceneGenerationConfig.outputCompression,
    },
    OPENROUTER_FALLBACK_IMAGE_MODEL,
  );
  const extension = image.mimeType === "image/png" ? "png" : "jpg";
  return persistSceneImageBase64(bookId, image.base64, extension);
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
