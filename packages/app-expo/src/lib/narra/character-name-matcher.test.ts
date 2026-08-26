import { describe, expect, it } from "vitest";
import {
  buildCharacterNameMatcherSpec,
  findCharacterNameMatches,
  stemNameToken,
} from "./character-name-matcher";

function matchedTexts(text: string, spec: ReturnType<typeof buildCharacterNameMatcherSpec>) {
  return findCharacterNameMatches(text, spec).map((match) => ({
    text: text.slice(match.start, match.end),
    characterId: match.characterId,
  }));
}

describe("stemNameToken", () => {
  it("срезает финальный гласный, «й» и «ь»", () => {
    expect(stemNameToken("гермиона")).toBe("гермион");
    expect(stemNameToken("малфой")).toBe("малфо");
    expect(stemNameToken("игорь")).toBe("игор");
    expect(stemNameToken("базаров")).toBe("базаров");
  });
});

describe("падежи русских имён", () => {
  const spec = buildCharacterNameMatcherSpec([
    { id: "hermione", name: "Гермиона", fullName: "Гермиона Грейнджер" },
  ]);

  it("матчит «Гермиону» и «Гермионы» (acceptance из work order)", () => {
    expect(matchedTexts("Он увидел Гермиону в библиотеке.", spec)).toEqual([
      { text: "Гермиону", characterId: "hermione" },
    ]);
    expect(matchedTexts("Без Гермионы всё пошло не так.", spec)).toEqual([
      { text: "Гермионы", characterId: "hermione" },
    ]);
  });

  it("матчит творительный и предложный падежи", () => {
    expect(matchedTexts("Он говорил с Гермионой о Грейнджер.", spec)).toEqual([
      { text: "Гермионой", characterId: "hermione" },
      { text: "Грейнджер", characterId: "hermione" },
    ]);
  });

  it("склеивает полное имя в один матч", () => {
    expect(matchedTexts("Вошла Гермиона Грейнджер.", spec)).toEqual([
      { text: "Гермиона Грейнджер", characterId: "hermione" },
    ]);
  });
});

describe("защиты матчера", () => {
  it("не матчит имя внутри другого слова", () => {
    const spec = buildCharacterNameMatcherSpec([
      { id: "bazarov", name: "Базаров", fullName: "Евгений Васильевич Базаров" },
    ]);
    expect(matchedTexts("Разбазарованное имущество Базарова.", spec)).toEqual([
      { text: "Базарова", characterId: "bazarov" },
    ]);
  });

  it("не матчит слово со строчной буквы", () => {
    const spec = buildCharacterNameMatcherSpec([{ id: "seryozha", name: "Серёжа" }]);
    expect(matchedTexts("Пришёл Серёжа, а серёжа-омоним — нет.", spec)).toEqual([
      { text: "Серёжа", characterId: "seryozha" },
    ]);
  });

  it("короткая основа матчится точными падежными формами", () => {
    const spec = buildCharacterNameMatcherSpec([{ id: "anna", name: "Анна" }]);
    expect(matchedTexts("Анну позвали, а без Анны не начали.", spec)).toEqual([
      { text: "Анну", characterId: "anna" },
      { text: "Анны", characterId: "anna" },
    ]);
    // Произвольные продолжения короткой основы по-прежнему не матчатся.
    expect(matchedTexts("Аннушка и Аннуитет остались без совпадений.", spec)).toEqual([]);
  });

  it("слишком короткие имена не матчатся вовсе", () => {
    const spec = buildCharacterNameMatcherSpec([{ id: "li", name: "Ли" }]);
    expect(matchedTexts("Ли пришёл.", spec)).toEqual([]);
  });

  it("частотные слова и титулы из стоп-листа не подсвечиваются", () => {
    const spec = buildCharacterNameMatcherSpec([
      { id: "vera", name: "Вера" },
      { id: "andrey", name: "Князь Андрей", fullName: "Андрей Николаевич Болконский" },
    ]);
    expect(matchedTexts("Вера в лучшее. Князь уехал.", spec)).toEqual([]);
    expect(matchedTexts("Андрей уехал.", spec)).toEqual([
      { text: "Андрей", characterId: "andrey" },
    ]);
  });
});

describe("фамилии-прилагательные", () => {
  const spec = buildCharacterNameMatcherSpec([
    { id: "vronsky", name: "Вронский", fullName: "Алексей Кириллович Вронский" },
    { id: "ranevskaya", name: "Раневская", fullName: "Любовь Андреевна Раневская" },
  ]);

  it("матчит мужскую и женскую падежные формы", () => {
    expect(matchedTexts("Без Вронского Раневскую не дождались.", spec)).toEqual([
      { text: "Вронского", characterId: "vronsky" },
      { text: "Раневскую", characterId: "ranevskaya" },
    ]);
  });

  it("не матчит падежную основу внутри другого слова", () => {
    expect(matchedTexts("Аннуитет и Вронскогорский показатель.", spec)).toEqual([]);
  });

  it("не превращает обычное прилагательное в ссылку на однофамильца", () => {
    const ambiguous = buildCharacterNameMatcherSpec([{ id: "white", name: "Белый" }]);
    expect(matchedTexts("На Белом море начался шторм.", ambiguous)).toEqual([]);
  });
});

describe("два персонажа с общей фамилией", () => {
  const spec = buildCharacterNameMatcherSpec([
    { id: "draco", name: "Драко", fullName: "Драко Малфой" },
    { id: "lucius", name: "Люциус", fullName: "Люциус Малфой" },
  ]);

  it("«Малфой» при двух Малфоях не подсвечивается (acceptance из work order)", () => {
    expect(matchedTexts("Малфой усмехнулся. Малфоя не было видно.", spec)).toEqual([]);
  });

  it("полное имя остаётся однозначным и подсвечивается целиком", () => {
    expect(matchedTexts("Драко Малфой усмехнулся.", spec)).toEqual([
      { text: "Драко Малфой", characterId: "draco" },
    ]);
    expect(matchedTexts("Речь Люциуса Малфоя удивила всех.", spec)).toEqual([
      { text: "Люциуса Малфоя", characterId: "lucius" },
    ]);
  });

  it("фраза из неоднозначных слов, сужающаяся до одного персонажа, матчится", () => {
    const kareninSpec = buildCharacterNameMatcherSpec([
      { id: "anna", name: "Анна", fullName: "Анна Аркадьевна Каренина" },
      { id: "karenin", name: "Каренин", fullName: "Алексей Александрович Каренин" },
      { id: "vronsky", name: "Вронский", fullName: "Алексей Кириллович Вронский" },
    ]);
    // «Алексей» и «Каренин» по отдельности неоднозначны, вместе — только Каренин
    expect(matchedTexts("Алексей Каренин молчал.", kareninSpec)).toEqual([
      { text: "Алексей Каренин", characterId: "karenin" },
    ]);
    expect(matchedTexts("Каренина не было дома. Алексей ждал.", kareninSpec)).toEqual([]);
  });

  it("разные персонажи подряд не склеиваются в один матч", () => {
    expect(matchedTexts("Драко Люциусу не ответил.", spec)).toEqual([
      { text: "Драко", characterId: "draco" },
      { text: "Люциусу", characterId: "lucius" },
    ]);
  });
});

describe("границы и служебные случаи", () => {
  it("пустой текст и пустая спека безопасны", () => {
    const spec = buildCharacterNameMatcherSpec([]);
    expect(findCharacterNameMatches("", spec)).toEqual([]);
    expect(findCharacterNameMatches("Просто текст без имён.", spec)).toEqual([]);
    expect(findCharacterNameMatches("Текст.", null)).toEqual([]);
  });

  it("возвращает корректные индексы для нескольких матчей", () => {
    const spec = buildCharacterNameMatcherSpec([
      { id: "bazarov", name: "Базаров", fullName: "Евгений Васильевич Базаров" },
      { id: "arkady", name: "Аркадий", fullName: "Аркадий Николаевич Кирсанов" },
    ]);
    const text = "Базаров и Аркадий приехали в Марьино.";
    const matches = findCharacterNameMatches(text, spec);
    expect(matches).toEqual([
      { start: 0, end: 7, characterId: "bazarov" },
      { start: 10, end: 17, characterId: "arkady" },
    ]);
  });

  it("слова через знаки препинания не склеиваются во фразу", () => {
    const spec = buildCharacterNameMatcherSpec([
      { id: "draco", name: "Драко", fullName: "Драко Малфой" },
      { id: "lucius", name: "Люциус", fullName: "Люциус Малфой" },
    ]);
    // «Драко. Малфой» — фамилия отделена точкой и остаётся неоднозначной
    expect(matchedTexts("Драко. Малфой ушёл.", spec)).toEqual([
      { text: "Драко", characterId: "draco" },
    ]);
  });
});
