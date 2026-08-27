/**
 * Генерация изображений сцен через Narra Gateway на движке OpenRouter (P16) —
 * единая точка входа.
 *
 * Раньше этот путь бил прямо в OpenRouter со встроенным ключом. Теперь запрос
 * идёт на /v2/media/images с engine=openrouter: провайдер и качество те же, но
 * ключ и модель остаются на сервере. 1024×1024 даёт квадратный aspectRatio 1:1,
 * согласно scene-generation-config.json.
 *
 * Промпт — 5-блочная схема scene-prompt.ts, БЕЗ цензорной нейтрализации текста
 * и safety-фолбэка (это костыли под цензора Кандинского, они искажали сцены).
 *
 * При отказе движка OpenRouter сцена не ломается: пробуем прежний
 * гейтвей-путь на Кандинском (media.ts), там нейтрализация сохранена.
 *
 * Референс-изображения (портреты героев) эндпоинт /images НЕ учитывает:
 * живой вызов 2026-08 принимает поле image, но игнорирует его содержимое,
 * поэтому консистентность героев держим паспортами внешности в промпте.
 */

import type { NarraGenreAnalysis } from "./genre-analysis";
import {
  generateSceneImage,
  persistSceneImageBase64,
  requestNarraGatewayImage,
  trackNarraMediaJob,
} from "./media";
import sceneGenerationConfig from "./scene-generation-config.json";
import { buildScenePrompt } from "./scene-prompt";
import type { NarraCharacter } from "./types";

/** Сцены генерируются квадратными и без дополнительной обрезки в приложении. */
const SCENE_WIDTH = 1024;
const SCENE_HEIGHT = 1024;

/** Модель выбирает сервер; здесь она нужна только для телеметрии. */
function sceneModel(): string {
  return sceneGenerationConfig.openRouterModel;
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

async function generateSceneImageViaGatewayOpenRouter(
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

  const { response, payload } = await requestNarraGatewayImage(prompt, {
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    engine: "openrouter",
  });
  if (!response.ok || !payload.base64) {
    throw new Error(payload.error || `Scene generation failed (${response.status})`);
  }
  return persistSceneImageBase64(bookId, payload.base64, "jpg");
}

/**
 * Единая точка генерации сцены. Сигнатура совпадает с generateSceneImage.
 *
 * При ошибке движка OpenRouter (собственный цензор OpenAI режет узнаваемых
 * франшизных героев — проверено живым вызовом на «Гарри Поттере»; сеть;
 * лимиты) сцена не ломается: пробуем гейтвей-путь на Кандинском. Обе попытки
 * видны в телеметрии со своими provider.
 */
export async function generateNarraSceneImage(
  bookId: string,
  chapter: string,
  excerpt: string,
  characters: NarraCharacter[],
): Promise<string> {
  try {
    return await trackNarraMediaJob(
      "image",
      "user",
      () => generateSceneImageViaGatewayOpenRouter(bookId, chapter, excerpt, characters),
      { provider: "openrouter", model: sceneModel() },
    );
  } catch (cause) {
    console.warn("[narra] gateway OpenRouter scene image failed, falling back to Kandinsky", cause);
    return generateSceneImage(bookId, chapter, excerpt, characters);
  }
}
