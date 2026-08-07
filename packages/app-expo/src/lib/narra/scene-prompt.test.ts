import { describe, expect, it } from "vitest";
import {
  SCENE_ART_DIRECTIONS,
  SCENE_PROMPT_CHAR_LIMIT,
  buildScenePrompt,
  mentionedCharacters,
  passportDescription,
  sceneArtDirectionForGenre,
} from "./scene-prompt";
import type { NarraCharacter } from "./types";

function character(overrides: Partial<NarraCharacter>): NarraCharacter {
  return {
    id: "id",
    name: "Имя",
    fullName: "Имя Фамилия",
    role: "герой",
    gender: "male",
    voice: "voice",
    traits: [],
    speechStyle: "",
    speechExamples: [],
    appearancePrompt: "высокий юноша",
    unlockProgress: 0,
    ...overrides,
  };
}

const harry = character({
  id: "harry",
  name: "Гарри",
  fullName: "Гарри Поттер",
  appearancePrompt: "худой юноша в круглых очках",
  passport: {
    age: 15,
    gender: "male",
    build: "худощавое телосложение",
    hair: "чёрные растрёпанные волосы",
    eyes: "ярко-зелёные глаза",
    face: "шрам-молния на лбу",
    outfit: "школьная мантия",
  },
});

const bazarov = character({
  id: "bazarov",
  name: "Базаров",
  fullName: "Евгений Базаров",
  appearancePrompt: "высокий молодой человек с длинными волосами",
  passport: {
    age: 28,
    gender: "male",
    build: "крепкое сложение",
    hair: "тёмно-русые длинные волосы",
    eyes: "зелёные глаза",
    face: "худое длинное лицо, бакенбарды",
    outfit: "длинный балахон с кистями",
  },
});

describe("сценные арт-направления по жанрам", () => {
  it("покрывают все id жанров cover-genre", () => {
    const coverGenreIds = [
      "classic",
      "manga",
      "fanfiction",
      "children",
      "poetry",
      "drama",
      "mystery-thriller",
      "science-fiction",
      "adventure",
      "fantasy",
      "horror",
      "romance",
      "historical-fiction",
      "biography-memoir",
      "philosophy",
      "psychology-self-help",
      "business-economics",
      "science-technology",
      "history-politics",
      "literary-fiction",
    ];
    for (const id of coverGenreIds) {
      expect(SCENE_ART_DIRECTIONS[id], `нет сценного арт-направления для ${id}`).toBeTruthy();
    }
  });

  it("неизвестный жанр падает в живописную иллюстрацию", () => {
    expect(sceneArtDirectionForGenre("unknown")).toBe(SCENE_ART_DIRECTIONS.classic);
  });

  it("сценные направления отличаются от обложечных: фанфик — аниме-момент, детектив — нуар", () => {
    expect(sceneArtDirectionForGenre("fanfiction")).toContain("аниме");
    expect(sceneArtDirectionForGenre("mystery-thriller")).toContain("Нуар");
    expect(sceneArtDirectionForGenre("manga")).toContain("Аниме-кадр");
  });
});

describe("buildScenePrompt — схема из 5 блоков", () => {
  const fanficInput = {
    bookTitle: "Гарри Поттер и Тень Хогвартса",
    bookAuthor: "anonymous_author",
    bookSubjects: ["фанфик"],
    chapter: "Глава 7. Дуэль",
    excerpt:
      "Гарри выхватил палочку и бросился вперёд, отбивая заклятие; вспышка ударила в стену, осыпав их каменной крошкой.",
    characters: [harry, bazarov],
    previousExcerpts: [
      "Гарри крался по тёмному коридору восьмого этажа.",
      "Сова принесла письмо без подписи, и класс замер.",
    ],
  };

  it("фанфик: жанр, эпоха, действие, паспорта, контекст серии", () => {
    const prompt = buildScenePrompt(fanficInput);

    // 1. Жанр — через resolveCoverGenreProfile, но со сценным направлением
    expect(prompt).toContain("ЖАНР И СТИЛЬ (fanfiction or transformative fiction)");
    expect(prompt).toContain("полуреалистичная аниме-иллюстрация момента");
    // 2. Эпоха/мир: «Название» (Автор)
    expect(prompt).toContain("«Гарри Поттер и Тень Хогвартса» (anonymous_author)");
    expect(prompt).toContain("глава «Глава 7. Дуэль»");
    expect(prompt).toContain("соответствуют эпохе и миру книги");
    // 3. Действие — жёсткие требования динамики
    expect(prompt).toContain("ДЕЙСТВИЕ момента в движении");
    expect(prompt).toContain("Никаких статичных поз");
    expect(prompt).toContain("взглядов в камеру");
    expect(prompt).toContain("группового позирования");
    expect(prompt).toContain("Гарри выхватил палочку");
    // 4. Персонажи: только упомянутые, паспорт дословно
    expect(prompt).toContain("Гарри Поттер: худой юноша в круглых очках, 15 лет");
    expect(prompt).toContain("шрам-молния на лбу");
    expect(prompt).not.toContain("Базаров");
    // 5. Контекст: 1–2 предыдущие сцены книги
    expect(prompt).toContain("ранее в книге");
    expect(prompt).toContain("Гарри крался по тёмному коридору");
    expect(prompt).toContain("Сова принесла письмо");

    expect(prompt.length).toBeLessThanOrEqual(SCENE_PROMPT_CHAR_LIMIT);
  });

  it("классика («Отцы и дети»): живописное направление и паспорт героя", () => {
    const prompt = buildScenePrompt({
      bookTitle: "Отцы и дети",
      bookAuthor: "Иван Тургенев",
      bookSubjects: ["классическая проза"],
      chapter: "Глава IV",
      excerpt:
        "Базаров быстро соскочил с тарантаса и зашагал к дому, размахивая испачканной землёй ладонью.",
      characters: [harry, bazarov],
    });

    expect(prompt).toContain("ЖАНР И СТИЛЬ (literary fiction)");
    expect(prompt).toContain("живописная иллюстрация");
    expect(prompt).toContain("«Отцы и дети» (Иван Тургенев)");
    expect(prompt).toContain(
      "Евгений Базаров: высокий молодой человек с длинными волосами, 28 лет",
    );
    expect(prompt).toContain("длинный балахон с кистями");
    expect(prompt).not.toContain("Поттер");
    // Без предыдущих сцен блока контекста нет
    expect(prompt).not.toContain("ранее в книге");
  });

  it("промпт превышает старый лимит Кандинского и не цензурит текст сцены", () => {
    const prompt = buildScenePrompt({
      bookTitle: "Как закалялась сталь",
      bookAuthor: "Николай Островский",
      chapter: "Глава 2",
      excerpt:
        "Восстание вспыхнуло ночью: выстрелы гремели у станции, командующий отрядом поднял оружие, кровь стучала в висках Павла.",
      characters: [],
    });

    // Снятие цензора: слова отрывка не подменяются эвфемизмами
    expect(prompt).toContain("Восстание вспыхнуло ночью");
    expect(prompt).toContain("выстрелы гремели");
    expect(prompt).toContain("оружие");
    expect(prompt).not.toContain("собрание");
    expect(prompt).not.toContain("резкие звуки");
    // Лимит 950 знаков Кандинского больше не действует
    expect(prompt.length).toBeGreaterThan(950);
    expect(prompt.length).toBeLessThanOrEqual(SCENE_PROMPT_CHAR_LIMIT);
  });

  it("очень длинный отрывок ужимается до потолка ~2500 знаков", () => {
    const prompt = buildScenePrompt({
      bookTitle: "Книга",
      chapter: "Глава",
      excerpt: "Герой бежал по длинному коридору мимо бесконечных дверей. ".repeat(120),
      characters: [harry, bazarov],
      previousExcerpts: ["Сцена первая. ".repeat(60), "Сцена вторая. ".repeat(60)],
    });
    expect(prompt.length).toBeLessThanOrEqual(SCENE_PROMPT_CHAR_LIMIT);
    expect(prompt).toContain("ДЕЙСТВИЕ момента в движении");
  });

  it("без упомянутых героев — запрет добавлять лишних людей", () => {
    const prompt = buildScenePrompt({
      bookTitle: "Книга",
      chapter: "Глава",
      excerpt: "Пустая улица тонула в тумане, где-то хлопнула дверь.",
      characters: [harry, bazarov],
    });
    expect(prompt).toContain("Не добавляй лишних людей");
    expect(prompt).not.toContain("Гарри");
    expect(prompt).not.toContain("Базаров");
  });
});

describe("переиспользуемые помощники паспортов", () => {
  it("passportDescription собирает паспорт дословно", () => {
    expect(passportDescription(harry)).toBe(
      "худой юноша в круглых очках, 15 лет, худощавое телосложение, чёрные растрёпанные волосы, ярко-зелёные глаза, шрам-молния на лбу, школьная мантия",
    );
    expect(passportDescription(character({ appearancePrompt: "только внешность" }))).toBe(
      "только внешность",
    );
  });

  it("mentionedCharacters находит героев по имени и полному имени", () => {
    const found = mentionedCharacters("Гарри посмотрел на дверь", [harry, bazarov]);
    expect(found.map((item) => item.id)).toEqual(["harry"]);
  });
});
