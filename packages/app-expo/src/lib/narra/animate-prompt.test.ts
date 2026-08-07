import { describe, expect, it } from "vitest";
import {
  MOTION_SUMMARY_CHAR_LIMIT,
  buildPortraitMotionPrompt,
  buildSceneMotionPrompt,
  sceneActionSummary,
} from "./animate-prompt";

describe("sceneActionSummary", () => {
  it("берёт первое предложение нарратива", () => {
    const summary = sceneActionSummary(
      "Гарри выхватил палочку и бросился к двери. Позади гремели шаги.",
    );
    expect(summary).toBe("Гарри выхватил палочку и бросился к двери");
  });

  it("пропускает реплики диалога и берёт нарратив", () => {
    const summary = sceneActionSummary(
      "— Стой! Кто идёт?\n— Свои, открывай.\nЧасовой медленно опустил ружьё и шагнул навстречу.",
    );
    expect(summary).toBe("Часовой медленно опустил ружьё и шагнул навстречу");
  });

  it("для отрывка из одних реплик берёт его начало", () => {
    const summary = sceneActionSummary("— Стой! Кто идёт?\n— Свои, открывай.");
    expect(summary).toContain("Стой");
  });

  it("схлопывает переносы и пробелы в одну строку", () => {
    const summary = sceneActionSummary("Ветер   гнал\nволны к берегу.");
    expect(summary).toBe("Ветер гнал волны к берегу");
  });

  it("ужимает длинное предложение до лимита с многоточием", () => {
    const summary = sceneActionSummary(`Он бежал ${"очень ".repeat(60)}быстро.`);
    expect(summary.length).toBeLessThanOrEqual(MOTION_SUMMARY_CHAR_LIMIT);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("пустой отрывок даёт пустую выжимку", () => {
    expect(sceneActionSummary("   \n  ")).toBe("");
  });
});

describe("buildSceneMotionPrompt", () => {
  it("собирает промпт: оживление, действие и ограничители", () => {
    const prompt = buildSceneMotionPrompt("Анна распахнула окно навстречу грозе.");
    expect(prompt).toContain("Оживи иллюстрацию: Анна распахнула окно навстречу грозе.");
    expect(prompt).toContain("Медленное кинематографичное движение");
    expect(prompt).toContain("сохраняй стиль и композицию исходного кадра");
    expect(prompt).toContain("без появления новых персонажей");
    expect(prompt).toContain("без текста");
  });

  it("без выжимки промпт остаётся валидным", () => {
    const prompt = buildSceneMotionPrompt("");
    expect(prompt.startsWith("Оживи иллюстрацию.")).toBe(true);
  });
});

describe("buildPortraitMotionPrompt", () => {
  it("описывает живой портрет без речи", () => {
    const prompt = buildPortraitMotionPrompt();
    expect(prompt).toContain("дыхание, моргание");
    expect(prompt).toContain("НЕ говорит");
    expect(prompt).toContain("взгляд остаётся на зрителе");
    expect(prompt).toContain("без появления новых персонажей");
  });
});
