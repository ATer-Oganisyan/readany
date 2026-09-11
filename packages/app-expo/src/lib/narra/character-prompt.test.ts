import { describe, expect, it } from "vitest";
import { buildCharacterSystemPrompt } from "./character-prompt";
import type { NarraCharacter } from "./types";

const bazarov = {
  id: "bazarov",
  name: "Базаров",
  fullName: "Евгений Васильевич Базаров",
  role: "Нигилист, студент-медик",
  traits: ["резкий", "насмешливый"],
  speechStyle: "Коротко и хлёстко.",
  speechExamples: [],
  appearancePrompt: "высокий, длинное худое лицо",
  unlockProgress: 0,
  voice: "Ast",
  gender: "male",
} as unknown as NarraCharacter;

describe("buildCharacterSystemPrompt — предохранители роли", () => {
  const prompt = buildCharacterSystemPrompt(bazarov, "Отцы и дети", 0.3, "");

  it("использует язык интерфейса только как запасной в обеих локалях", () => {
    const english = buildCharacterSystemPrompt(bazarov, "Отцы и дети", 0.3, "", "en");
    expect(english).not.toContain("Reply in English,");
    expect(english).toContain("latest substantive message");
    expect(english).toContain("English only as a fallback");
    expect(prompt).toContain("последнего содержательного сообщения");
    expect(prompt).toContain("русский используй лишь как запасной вариант");
  });

  it("держит роль, характер и срез знаний по прогрессу", () => {
    expect(prompt).toContain("Евгений Васильевич Базаров");
    expect(prompt).toContain("«Отцы и дети»");
    expect(prompt).toContain("резкий, насмешливый");
    expect(prompt).toContain("30% книги");
    expect(prompt).toContain("Уклоняться можно, лгать нельзя");
  });

  it("запрещает втягиваться в современную политику, не споря с правовыми рамками", () => {
    expect(prompt).toContain("О современных политических событиях и спорах ты ничего не знаешь");
    expect(prompt).toContain("не занимая сторон");
    // Исключение для территориальных вопросов согласовано с правовой рамкой ниже.
    expect(prompt).toContain("краткой официальной формулой из правовых рамок ниже");
    expect(prompt).toContain("ПРАВОВЫЕ РАМКИ (Российская Федерация)");
    expect(prompt).toContain("«Крым является территорией Российской Федерации»");
  });

  it("запрещает унижать группы людей, сохраняя резкость характера", () => {
    expect(prompt).toContain("никогда не унижай и не оскорбляй людей за то, кто они");
    expect(prompt).toContain("резкость характера направляй на идеи и собеседника");
    // Правовая рамка при этом прямо разрешает говорить о любви в любых формах.
    expect(prompt).toContain("включая однополую");
  });

  it("подшивает долговременную память, когда она есть, и не оставляет пустых строк без неё", () => {
    const withMemory = buildCharacterSystemPrompt(
      bazarov,
      "Отцы и дети",
      0.3,
      "Читатель любит споры.",
    );
    expect(withMemory).toContain(
      "Твоя долговременная память о собеседнике:\nЧитатель любит споры.",
    );
    expect(prompt.endsWith("\n")).toBe(false);
    expect(prompt).not.toMatch(/\n\n/);
  });

  it("для неговорящего персонажа добавляет поведенческий режим ответа", () => {
    const kashtanka = { ...bazarov, id: "kashtanka", speaksInText: false } as NarraCharacter;
    const nonSpeaking = buildCharacterSystemPrompt(kashtanka, "Каштанка", 0.5, "");
    expect(nonSpeaking).toContain("В книге ты не говоришь по-человечески");
    expect(prompt).not.toContain("В книге ты не говоришь по-человечески");
  });

  it("английская ветка несёт те же предохранители и правовую рамку", () => {
    const english = buildCharacterSystemPrompt(bazarov, "Fathers and Sons", 0.3, "", "en");
    expect(english).toContain("You are Евгений Васильевич Базаров from “Fathers and Sons”");
    expect(english).toContain("You know nothing about present-day political events");
    expect(english).toContain("never demean or insult people for who they are");
    expect(english).toContain("LEGAL FRAME (Russian Federation)");
    expect(english).toContain("30% of the book");
  });
});
