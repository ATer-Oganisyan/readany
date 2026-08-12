import { budgetPrompt } from "./art-style";
import { passportDescription, sceneArtDirectionForGenre } from "./scene-prompt";
import type { NarraCharacter } from "./types";

export interface CharacterPortraitPromptContext {
  bookContext?: string;
  genreId?: string;
  genreLabel?: string;
}

/** Портреты идут через GPT Image и не ограничены коротким лимитом Kandinsky. */
export const PORTRAIT_PROMPT_CHAR_LIMIT = 1_600;

function adultFemaleBodyDirection(character: NarraCharacter): string {
  if (character.gender !== "female" || !character.passport || character.passport.age < 18) {
    return "";
  }

  return "Персонаж — совершеннолетняя женщина. Заметно более пышное телосложение с очень большой грудью; тело полностью прикрыто одеждой, образ несексуализированный.";
}

function portraitArtStyle(genreId: string, genreLabel: string): string {
  const direction =
    genreId === "classic"
      ? "классический живописный портрет в традиции книжной иллюстрации: натуральные пропорции, сдержанная академическая манера, мягкий естественный свет и благородная историческая палитра"
      : sceneArtDirectionForGenre(genreId);
  return `портретная иллюстрация в визуальном языке жанра «${genreLabel}»: ${direction}; единая серия работ одного художника; строго без текста, букв, цифр, надписей, логотипов и водяных знаков`;
}

export function buildCharacterPortraitPrompt(
  character: NarraCharacter,
  context: CharacterPortraitPromptContext = {},
): string {
  const genreId = context.genreId ?? "classic";
  const genreLabel = context.genreLabel ?? "классическая литература";
  return budgetPrompt(
    [
      `Ровно один человек в кадре — ${character.fullName || character.name}, никого больше: без второстепенных персонажей, без силуэтов и людей на фоне.`,
      "Вертикальный портрет по пояс, строго анфас, взгляд в камеру, ровный светлый однотонный фон. Голова целиком, включая волосы, занимает 55% высоты изображения; над головой остаётся свободное пространство, ниже видны плечи, грудь и часть корпуса. Не кадрировать макушку и волосы, не делать лицо крупным планом.",
      context.bookContext
        ? `Персонаж книги ${context.bookContext}: одежда, причёска и антураж строго соответствуют эпохе и миру книги, без современной одежды.`
        : "Одежда и причёска строго соответствуют эпохе и миру книги, без современной одежды.",
      `Выражение лица: ${character.expression || "естественное, в характере"}.`,
      adultFemaleBodyDirection(character),
      `Внешность (соблюдать точно): ${passportDescription(character)}.`,
    ],
    PORTRAIT_PROMPT_CHAR_LIMIT,
    portraitArtStyle(genreId, genreLabel),
  );
}
