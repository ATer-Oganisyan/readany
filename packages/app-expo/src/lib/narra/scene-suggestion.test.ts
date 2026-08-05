import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCENE_SUGGESTION_INTERVAL,
  INITIAL_SCENE_SUGGESTION_STATE,
  SCENE_SUGGESTION_INTERVALS,
  type SceneSuggestionRelocate,
  type SceneSuggestionState,
  advanceSceneSuggestion,
} from "./scene-suggestion";

function pageRelocate(section: number, page: number): SceneSuggestionRelocate {
  return {
    section: { current: section, total: 10 },
    page: { current: page, total: 40 },
    fraction: (section * 40 + page) / 400,
  };
}

/** Прогоняет цепочку relocate, возвращает финальное состояние и число предложений. */
function run(
  events: SceneSuggestionRelocate[],
  interval: number,
  initial: SceneSuggestionState = INITIAL_SCENE_SUGGESTION_STATE,
) {
  let state = initial;
  let suggestions = 0;
  for (const detail of events) {
    const result = advanceSceneSuggestion(state, detail, interval);
    state = result.state;
    if (result.suggest) suggestions += 1;
  }
  return { state, suggestions };
}

describe("настройка частоты врезок", () => {
  it("дефолт — 8 страниц, варианты содержат выкл", () => {
    expect(DEFAULT_SCENE_SUGGESTION_INTERVAL).toBe(8);
    expect(SCENE_SUGGESTION_INTERVALS).toContain(0);
    expect(SCENE_SUGGESTION_INTERVALS).toContain(DEFAULT_SCENE_SUGGESTION_INTERVAL);
  });

  it("interval = 0 (выкл): никогда не предлагает и не копит счётчик", () => {
    const events = Array.from({ length: 30 }, (_, index) => pageRelocate(0, index + 1));
    const { state, suggestions } = run(events, 0);
    expect(suggestions).toBe(0);
    expect(state.pagesTurned).toBe(0);
  });
});

describe("счётчик перелистываний", () => {
  it("предлагает ровно раз в N страниц вперёд", () => {
    const events = Array.from({ length: 6 }, (_, index) => pageRelocate(0, index + 1));
    // Первый relocate — привязка позиции, дальше 5 перелистываний
    expect(run(events, 5).suggestions).toBe(1);
    expect(run(events, 5).state.pagesTurned).toBe(0);
  });

  it("после предложения счётчик начинается заново", () => {
    const events = Array.from({ length: 11 }, (_, index) => pageRelocate(0, index + 1));
    // 10 перелистываний при interval 5 → две врезки
    expect(run(events, 5).suggestions).toBe(2);
  });

  it("первый relocate (восстановление позиции) не считается страницей", () => {
    const { state } = run([pageRelocate(2, 17)], 5);
    expect(state.pagesTurned).toBe(0);
    expect(state.step).toEqual({ mode: "page", section: 2, page: 17 });
  });

  it("повтор той же позиции (resize, повторный relocate) не считается", () => {
    const { state } = run([pageRelocate(0, 1), pageRelocate(0, 1), pageRelocate(0, 1)], 5);
    expect(state.pagesTurned).toBe(0);
  });

  it("переход в следующую главу считается одним перелистыванием", () => {
    const { state } = run([pageRelocate(0, 39), pageRelocate(1, 1)], 5);
    expect(state.pagesTurned).toBe(1);
  });

  it("страница назад не считается, но и не сбрасывает счётчик", () => {
    const forward = [pageRelocate(0, 1), pageRelocate(0, 2), pageRelocate(0, 3)];
    const { state } = run([...forward, pageRelocate(0, 2)], 5);
    expect(state.pagesTurned).toBe(2);
  });

  it("прыжок (оглавление/поиск) сбрасывает счётчик", () => {
    const forward = Array.from({ length: 5 }, (_, index) => pageRelocate(0, index + 1));
    const { state, suggestions } = run([...forward, pageRelocate(7, 3)], 8);
    expect(suggestions).toBe(0);
    expect(state.pagesTurned).toBe(0);
    expect(state.step).toEqual({ mode: "page", section: 7, page: 3 });
  });

  it("программная навигация (suppressed) перепривязывает позицию без счёта", () => {
    let state = INITIAL_SCENE_SUGGESTION_STATE;
    state = advanceSceneSuggestion(state, pageRelocate(0, 1), 5).state;
    state = advanceSceneSuggestion(state, pageRelocate(0, 2), 5).state;
    const result = advanceSceneSuggestion(state, pageRelocate(0, 3), 5, true);
    expect(result.suggest).toBe(false);
    expect(result.state.pagesTurned).toBe(0);
    expect(result.state.step).toEqual({ mode: "page", section: 0, page: 3 });
  });

  it("moved=true при смене страницы — плашка скрывается при перелистывании", () => {
    let state = INITIAL_SCENE_SUGGESTION_STATE;
    state = advanceSceneSuggestion(state, pageRelocate(0, 1), 5).state;
    const moved = advanceSceneSuggestion(state, pageRelocate(0, 2), 5);
    expect(moved.moved).toBe(true);
    const same = advanceSceneSuggestion(moved.state, pageRelocate(0, 2), 5);
    expect(same.moved).toBe(false);
  });

  it("смена настройки применяется со следующего перелистывания", () => {
    // 4 перелистывания при interval 8 — врезки ещё нет
    const events = Array.from({ length: 5 }, (_, index) => pageRelocate(0, index + 1));
    const { state, suggestions } = run(events, 8);
    expect(suggestions).toBe(0);
    // Пользователь сменил частоту на 5: накопленное учитывается
    const next = advanceSceneSuggestion(state, pageRelocate(0, 6), 5);
    expect(next.suggest).toBe(true);
  });
});

describe("фолбэк без пагинации (scroll-режим, только fraction)", () => {
  const fraction = (value: number): SceneSuggestionRelocate => ({ fraction: value });

  it("плавное продвижение вперёд считается страницами", () => {
    const events = [0.1, 0.12, 0.14, 0.16].map(fraction);
    const { state, suggestions } = run(events, 3);
    expect(suggestions).toBe(1);
    expect(state.pagesTurned).toBe(0);
  });

  it("большой скачок доли — прыжок, счётчик заново", () => {
    const events = [0.1, 0.12, 0.6].map(fraction);
    const { state } = run(events, 5);
    expect(state.pagesTurned).toBe(0);
  });

  it("relocate без позиции игнорируется", () => {
    const result = advanceSceneSuggestion(INITIAL_SCENE_SUGGESTION_STATE, {}, 5);
    expect(result).toEqual({
      state: INITIAL_SCENE_SUGGESTION_STATE,
      suggest: false,
      moved: false,
    });
  });
});
