/**
 * Промпты движения для «оживления» картинок (P18) — чистая сборка без сторов.
 *
 * Видео-модель получает исходный кадр (first-frame conditioning), поэтому
 * промпт описывает только ДВИЖЕНИЕ: короткая выжимка действия из отрывка
 * плюс жёсткие ограничители — сохранять стиль и композицию кадра, не менять
 * план, не добавлять персонажей и текст.
 */

/** Потолок выжимки действия в промпте движения. */
export const MOTION_SUMMARY_CHAR_LIMIT = 180;

const MOTION_GUARDRAILS =
  "Медленное кинематографичное движение, сохраняй стиль и композицию исходного кадра, " +
  "без резких смен плана, без появления новых персонажей, без текста, без добавления " +
  "политической символики, лозунгов и флагов, которых нет в кадре.";

function oneLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function capSentence(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const slice = value.slice(0, maxLength - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace >= maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s,.;:!?…—-]+$/u, "")}…`;
}

/**
 * Выжимка действия из отрывка — одно предложение. Реплики (строки на «—»)
 * пропускаются: движение в кадре задаёт нарратив, а не диалог; если отрывок
 * состоит из одних реплик, берётся его начало.
 */
export function sceneActionSummary(excerpt: string): string {
  const narration = excerpt
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^[—–-]/.test(line))
    .join(" ");
  const source = oneLine(narration || excerpt);
  if (!source) return "";
  const sentence = source.match(/^.{10,}?[.!?…]+(?=\s|$)/u)?.[0] ?? source;
  return capSentence(sentence.trim().replace(/[.!?…]+$/u, ""), MOTION_SUMMARY_CHAR_LIMIT);
}

/** Промпт движения сцены: оживить иллюстрацию с действием из отрывка. */
export function buildSceneMotionPrompt(excerpt: string): string {
  const summary = sceneActionSummary(excerpt);
  const action = summary ? `: ${summary}` : "";
  return `Оживи иллюстрацию${action}. ${MOTION_GUARDRAILS}`;
}
