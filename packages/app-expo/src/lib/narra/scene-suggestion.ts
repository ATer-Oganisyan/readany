/**
 * Врезки «Нарисовать сцену» — логика «когда предложить».
 *
 * Читалка шлёт события relocate из foliate (см. use-reader-bridge.ts);
 * здесь считаем перелистывания или пройденные экраны прокрутки и раз в N страниц (настройка
 * пользователя) предлагаем визуализировать текущую сцену. Собственной
 * пагинации нет — только интерпретация полей relocate.
 */

/** Варианты настройки «Частота врезок»: страниц между предложениями, 0 — выкл. */
export const SCENE_SUGGESTION_INTERVALS = [3, 4, 8, 0] as const;
export const DEFAULT_SCENE_SUGGESTION_INTERVAL = 4;

/**
 * Первая врезка сессии книги показывается раньше обычного интервала — после
 * стольких перелистываний вперёд с открытия книги (P16: «на 1–3 странице»),
 * дальше — по обычной настройке.
 */
export const FIRST_SCENE_SUGGESTION_PAGES = 2;

/** Подмножество RelocateEvent, достаточное для счётчика. */
export interface SceneSuggestionRelocate {
  fraction?: number;
  reason?: string;
  section?: { current: number; total: number };
  page?: { current: number; total: number };
  scroll?: { offset: number; viewport: number };
}

/** Позиция чтения в терминах пагинации foliate. */
type SceneSuggestionStep =
  | { mode: "page"; section: number; page: number }
  | { mode: "scroll"; section: number; page: number; viewport: number }
  | { mode: "fraction"; fraction: number };

export interface SceneSuggestionState {
  step: SceneSuggestionStep | null;
  /** Перелистываний вперёд с прошлого предложения (или с открытия книги). */
  pagesTurned: number;
  /** Первая (ранняя) врезка этой сессии книги уже предлагалась. */
  firstSuggested: boolean;
}

export interface SceneSuggestionAdvance {
  state: SceneSuggestionState;
  /** Пора показать плашку «Нарисовать сцену». */
  suggest: boolean;
  /** Позиция чтения сменилась (для скрытия плашки при перелистывании). */
  moved: boolean;
}

export const INITIAL_SCENE_SUGGESTION_STATE: SceneSuggestionState = {
  step: null,
  pagesTurned: 0,
  firstSuggested: false,
};

/** Максимальный прирост доли книги, который ещё похож на одну страницу. */
const MAX_FRACTION_PAGE_STEP = 0.08;

/**
 * Максимальный шаг страниц renderer'а, который считаем «перелистнул вперёд».
 * Быстрые свайпы коалесцируются debounce'ом foliate в один relocate с шагом
 * 2–3 страницы — раньше это классифицировалось как «прыжок» и обнуляло
 * счётчик, из-за чего врезка могла не наступить никогда.
 */
const MAX_PAGE_TURN_STEP = 3;

function stepFromRelocate(detail: SceneSuggestionRelocate): SceneSuggestionStep | null {
  if (detail.scroll && detail.section) {
    const { offset, viewport } = detail.scroll;
    if (Number.isFinite(offset) && Number.isFinite(viewport) && viewport > 0) {
      return { mode: "scroll", section: detail.section.current, page: offset / viewport, viewport };
    }
  }
  if (detail.page && detail.section) {
    return { mode: "page", section: detail.section.current, page: detail.page.current };
  }
  if (typeof detail.fraction === "number" && Number.isFinite(detail.fraction)) {
    return { mode: "fraction", fraction: detail.fraction };
  }
  return null;
}

function sameStep(a: SceneSuggestionStep, b: SceneSuggestionStep): boolean {
  if (a.mode === "scroll" && b.mode === "scroll") {
    return a.section === b.section && a.page === b.page && a.viewport === b.viewport;
  }
  if (a.mode === "page" && b.mode === "page") {
    return a.section === b.section && a.page === b.page;
  }
  if (a.mode === "fraction" && b.mode === "fraction") {
    return a.fraction === b.fraction;
  }
  return false;
}

/**
 * Один шаг вперёд: перелистнули страницу (или перешли в следующую главу).
 * Всё прочее — либо шаг назад (не считаем, но не сбрасываем), либо прыжок
 * (оглавление/поиск/закладка) — счётчик начинается заново.
 */
function classifyMove(
  previous: SceneSuggestionStep,
  next: SceneSuggestionStep,
): "forward" | "backward" | "jump" {
  if (previous.mode !== "fraction" && next.mode !== "fraction" && previous.mode === next.mode) {
    // Поворот экрана меняет число экранов до той же позиции, но не означает чтение.
    if (
      previous.mode === "scroll" &&
      next.mode === "scroll" &&
      previous.viewport !== next.viewport
    ) {
      return "jump";
    }
    if (next.section === previous.section) {
      const delta = next.page - previous.page;
      // Быстрые свайпы приходят одним relocate с шагом 2–3 — это чтение вперёд
      const limit = previous.mode === "scroll" ? Number.POSITIVE_INFINITY : MAX_PAGE_TURN_STEP;
      if (delta > 0 && delta <= limit) return "forward";
      if (delta < 0 && delta >= -limit) return "backward";
      return "jump";
    }
    if (next.section === previous.section + 1) return "forward";
    if (next.section === previous.section - 1) return "backward";
    return "jump";
  }
  if (previous.mode === "fraction" && next.mode === "fraction") {
    const delta = next.fraction - previous.fraction;
    if (delta > 0 && delta <= MAX_FRACTION_PAGE_STEP) return "forward";
    if (delta < 0 && delta >= -MAX_FRACTION_PAGE_STEP) return "backward";
    return "jump";
  }
  // Сменился способ пагинации (например, переключили режим чтения)
  return "jump";
}

/**
 * Обрабатывает очередной relocate.
 *
 * @param interval страниц между предложениями; 0 или меньше — врезки выключены
 * @param suppressed навигация программная (восстановление позиции, переход по
 *   оглавлению) — позицию фиксируем, но перелистыванием не считаем
 */
export function advanceSceneSuggestion(
  state: SceneSuggestionState,
  detail: SceneSuggestionRelocate,
  interval: number,
  suppressed = false,
): SceneSuggestionAdvance {
  const step = stepFromRelocate(detail);
  const { firstSuggested } = state;
  if (!step) {
    return { state, suggest: false, moved: false };
  }

  if (interval <= 0) {
    return { state: { step, pagesTurned: 0, firstSuggested }, suggest: false, moved: false };
  }

  const previous = state.step;
  if (!previous) {
    return { state: { step, pagesTurned: 0, firstSuggested }, suggest: false, moved: false };
  }
  if (sameStep(previous, step)) {
    return {
      state: { step, pagesTurned: state.pagesTurned, firstSuggested },
      suggest: false,
      moved: false,
    };
  }

  const programmaticScroll =
    step.mode === "scroll" && detail.reason != null && detail.reason !== "scroll";
  if (suppressed || programmaticScroll) {
    // Программный переход (восстановление позиции, оглавление): перепривязываемся
    // к новой позиции, сам переход страницей не считаем, но накопленный счётчик
    // НЕ обнуляем — иначе guard-окно после каждой программной навигации
    // (и серии relocate при открытии книги) съедало прогресс до врезки.
    return {
      state: { step, pagesTurned: state.pagesTurned, firstSuggested },
      suggest: false,
      moved: true,
    };
  }

  const move = classifyMove(previous, step);
  if (move === "jump") {
    return { state: { step, pagesTurned: 0, firstSuggested }, suggest: false, moved: true };
  }
  if (move === "backward") {
    // Взгляд назад не обнуляет прогресс до следующей врезки
    return {
      state: { step, pagesTurned: state.pagesTurned, firstSuggested },
      suggest: false,
      moved: true,
    };
  }

  // Короткий свайп — часть экрана, а не ещё одна целая страница.
  const distance =
    previous.mode === "scroll" && step.mode === "scroll" && previous.section === step.section
      ? step.page - previous.page
      : 1;
  const pagesTurned = state.pagesTurned + distance;
  // Первая врезка сессии — раньше обычного интервала (но не позже него)
  const threshold = firstSuggested ? interval : Math.min(FIRST_SCENE_SUGGESTION_PAGES, interval);
  if (pagesTurned >= threshold - 1e-6) {
    return { state: { step, pagesTurned: 0, firstSuggested: true }, suggest: true, moved: true };
  }
  return { state: { step, pagesTurned, firstSuggested }, suggest: false, moved: true };
}
