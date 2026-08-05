import { beforeEach, describe, expect, it } from "vitest";
import type { NarraGender } from "./types";
import {
  VOICES,
  type VoiceAssignmentCharacter,
  assignVoices,
  clearVoicePlanCache,
  detectFirstPerson,
  narratorVoiceFor,
} from "./voice-rules";

function cast(genders: NarraGender[], overrides: Partial<VoiceAssignmentCharacter>[] = []) {
  return genders.map((gender, index) => ({
    id: `char-${index + 1}`,
    gender,
    rank: genders.length - index,
    ...overrides[index],
  }));
}

describe("narrator voice preference", () => {
  it("maps male to Сбер and female (default) to Афина", () => {
    expect(narratorVoiceFor("male")).toBe("She");
    expect(narratorVoiceFor("female")).toBe("Che");
    expect(narratorVoiceFor(undefined)).toBe("Che");
  });
});

describe("assignVoices, third person", () => {
  it("gives the protagonist the remaining assistant voice by gender", () => {
    const plan = assignVoices(cast(["male", "male", "female"]));

    expect(plan.narratorVoice).toBe("Che");
    expect(plan.assignments["char-1"]).toEqual({ voice: "She" });
    // Второй мужчина — актёрский пул: Фокин исключён из авто, значит Стерлинг.
    expect(plan.assignments["char-2"]).toEqual({ voice: "Ast" });
    expect(plan.assignments["char-3"]).toEqual({ voice: "Ste" });
  });

  it("falls back to the actor pool when no assistant matches the protagonist gender", () => {
    const plan = assignVoices(cast(["male", "female"]), { narratorPreference: "male" });

    expect(plan.narratorVoice).toBe("She");
    // Оба ассистентских остатка женские — герой-мужчина идёт в актёрский пул.
    expect(plan.assignments["char-1"]).toEqual({ voice: "Ast" });
    // Ассистентские голоса — только нарратору и главному герою; остальные — из библиотеки.
    expect(plan.assignments["char-2"]).toEqual({ voice: "Ste" });
  });

  it("respects a precomputed rank over array order", () => {
    const plan = assignVoices([
      { id: "sidekick", gender: "male", rank: 1 },
      { id: "hero", gender: "male", rank: 10 },
    ]);

    expect(plan.assignments.hero).toEqual({ voice: "She" });
    expect(plan.assignments.sidekick).toEqual({ voice: "Ast" });
  });
});

describe("assignVoices, first person", () => {
  it("shares the narrator voice with the protagonist and passes the assistant on", () => {
    const plan = assignVoices(cast(["female", "male", "female"]), { firstPerson: true });

    // Главгерой-рассказчик — один голос с нарратором.
    expect(plan.assignments["char-1"]).toEqual({ voice: "Che" });
    // Второй ассистентский — следующему по значимости (мужчина — Сбер).
    expect(plan.assignments["char-2"]).toEqual({ voice: "She" });
    expect(plan.assignments["char-3"]).toEqual({ voice: "Ste" });
  });
});

describe("assignVoices, pool exhaustion and extras", () => {
  it("repeats voices with a prosody modifier once the gender pool is exhausted", () => {
    const genders = Array.from({ length: 9 }, () => "female" as const);
    const plan = assignVoices(cast(genders));

    // Нарратор Che, главная героиня Erm, дальше женский пул: Ste, Tso, Chr, Saf.
    const assignments = genders.map((_, index) => plan.assignments[`char-${index + 1}`]);
    expect(assignments.slice(0, 5).map((a) => a.voice)).toEqual([
      "Erm",
      "Ste",
      "Tso",
      "Chr",
      "Saf",
    ]);
    expect(assignments.slice(0, 5).every((a) => a.prosody === undefined)).toBe(true);
    // Шестая героиня повторяет первый голос пула, но с просодией.
    expect(assignments[5].voice).toBe("Ste");
    expect(assignments[5].prosody).toBeDefined();
    expect(assignments[6]).toMatchObject({ voice: "Tso" });
    expect(assignments[6].prosody).toBeDefined();
  });

  it("gives unnamed minor characters the narrator voice", () => {
    const plan = assignVoices(cast(["male", "male"], [{}, { isMinor: true }]));

    expect(plan.assignments["char-2"]).toEqual({ voice: plan.narratorVoice });
  });

  it("never auto-assigns easter eggs or broken voices", () => {
    const genders = Array.from({ length: 40 }, (_, i): NarraGender => (i % 2 ? "female" : "male"));
    const plan = assignVoices(cast(genders));

    const used = new Set(Object.values(plan.assignments).map((a) => a.voice));
    expect(used.has("Mar")).toBe(false);
    expect(used.has("Kas")).toBe(false);
    // TODO(Фокин): Efo вернётся в пул после починки синтеза на gateway.
    expect(used.has("Efo")).toBe(false);
  });

  it("prioritizes Сафронова for children's books", () => {
    const plan = assignVoices(cast(["male", "female", "female"]), { childrensBook: true });

    expect(plan.assignments["char-2"]).toEqual({ voice: "Saf" });
    expect(plan.assignments["char-3"]).toEqual({ voice: "Ste" });
  });
});

describe("assignVoices, determinism and caching", () => {
  beforeEach(() => clearVoicePlanCache());

  it("is deterministic for identical input", () => {
    const characters = cast(["male", "female", "male", "female", "male"]);
    expect(assignVoices(characters)).toEqual(assignVoices([...characters]));
  });

  it("caches the plan per book", () => {
    const characters = cast(["male", "female"]);
    const first = assignVoices(characters, { bookId: "book-1" });
    const second = assignVoices(characters, { bookId: "book-1" });

    expect(second).toBe(first);
    // Смена входных данных инвалидирует кэш той же книги.
    const changed = assignVoices(cast(["female", "male"]), { bookId: "book-1" });
    expect(changed).not.toBe(first);
  });
});

describe("voice registry", () => {
  it("keeps assistants, actors and easter eggs consistent", () => {
    const assistants = Object.values(VOICES).filter((voice) => voice.type === "assistant");
    expect(assistants.map((voice) => voice.name).sort()).toEqual(["Афина", "Джой", "Сбер"]);
    expect(VOICES.Mar).toMatchObject({ type: "easter", autoAssign: false });
    expect(VOICES.Kas).toMatchObject({ type: "easter", autoAssign: false });
  });
});

describe("detectFirstPerson", () => {
  it("detects first-person narration outside dialogue", () => {
    const text = [
      "Я выехал из крепости рано утром. Дорога шла степью.",
      "Мне не спалось всю ночь. Я думал о Марье Ивановне.",
      "— Куда путь держишь? — спросил встречный казак.",
      "Меня охватило странное предчувствие. Ветер усиливался.",
    ].join("\n");

    expect(detectFirstPerson(text)).toBe(true);
  });

  it("ignores first-person pronouns inside direct speech", () => {
    const text = [
      "Базаров вошёл в комнату и поставил чемодан. Аркадий последовал за ним.",
      "— Я нигилист, — сказал Базаров. — Мне всё равно.",
      "Николай Петрович посмотрел на сына. Вечер был тих.",
      "Слуга принёс самовар. Разговор не клеился.",
    ].join("\n");

    expect(detectFirstPerson(text)).toBe(false);
  });
});
