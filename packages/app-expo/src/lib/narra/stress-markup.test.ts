import { afterEach, describe, expect, it } from "vitest";
import { BASE_STRESS_ENTRIES } from "./stress-dictionary";
import {
  applyActiveStressMarkup,
  applyStressMarkup,
  compileStressDictionary,
  parseStressedForm,
  primeCharacterStressForms,
  stressedNameForms,
} from "./stress-markup";

const dict = (entries: Array<{ stressed: string; inflect?: boolean }>) =>
  compileStressDictionary(entries);

afterEach(() => {
  // Возврат к базовому словарю, чтобы тесты не влияли друг на друга.
  primeCharacterStressForms([]);
});

describe("parseStressedForm", () => {
  it("принимает апостроф сразу после гласной (конвенция SaluteSpeech)", () => {
    expect(parseStressedForm("гермио'на")).toEqual({
      plain: "гермиона",
      stressed: "гермио'на",
    });
  });

  it("отклоняет апостроф после согласной, два апострофа и не-русские буквы", () => {
    expect(parseStressedForm("герм'иона")).toBeNull();
    expect(parseStressedForm("ге'рми'она")).toBeNull();
    expect(parseStressedForm("'гермиона")).toBeNull();
    expect(parseStressedForm("гермиона")).toBeNull();
    expect(parseStressedForm("hermi'one")).toBeNull();
  });

  it("нормализует типографский апостроф и комбинируемое ударение", () => {
    expect(parseStressedForm("гермио’на")?.stressed).toBe("гермио'на");
    expect(parseStressedForm("гермио́на")?.stressed).toBe("гермио'на");
  });
});

describe("applyStressMarkup — позиция и регистр", () => {
  const d = dict([{ stressed: "гермио'на", inflect: true }, { stressed: "звони'т" }]);

  it("ставит апостроф сразу после ударной гласной", () => {
    expect(applyStressMarkup("Гермиона звонит", d)).toBe("Гермио'на звони'т");
  });

  it("сохраняет регистр исходного слова", () => {
    expect(applyStressMarkup("ГЕРМИОНА", d)).toBe("ГЕРМИО'НА");
    expect(applyStressMarkup("гермиона", d)).toBe("гермио'на");
  });
});

describe("applyStressMarkup — границы слов", () => {
  it("не размечает словоформу внутри другого слова", () => {
    const d = dict([{ stressed: "оста'п", inflect: true }, { stressed: "щаве'ль" }]);
    expect(applyStressMarkup("остаповедение и щавельный суп", d)).toBe(
      "остаповедение и щавельный суп",
    );
    expect(applyStressMarkup("Остап ел щавель", d)).toBe("Оста'п ел щаве'ль");
  });

  it("размечает части дефисных имён по отдельности", () => {
    const d = dict([
      { stressed: "караба'с", inflect: true },
      { stressed: "бараба'с", inflect: true },
    ]);
    expect(applyStressMarkup("Карабас-Барабас", d)).toBe("Караба'с-Бараба'с");
  });
});

describe("stressedNameForms — словоформы от стема", () => {
  it("переносит ударение основы на падежные формы", () => {
    const d = dict([{ stressed: "база'ров", inflect: true }]);
    expect(applyStressMarkup("Базарова спросили, Базарову ответили, с Базаровым", d)).toBe(
      "База'рова спросили, База'рову ответили, с База'ровым",
    );
  });

  it("склоняет имена с основой на гласную («Мария» → «Марии»)", () => {
    const d = dict([{ stressed: "мари'я", inflect: true }]);
    expect(applyStressMarkup("книга Марии", d)).toBe("книга Мари'и");
  });

  it("ударение в окончании — только точная форма", () => {
    const forms = stressedNameForms("пьеро'");
    expect(forms.get("пьеро")).toBe("пьеро'");
    expect(forms.size).toBe(1);
    const d = dict([{ stressed: "пьеро'", inflect: true }]);
    expect(applyStressMarkup("Пьеро и пьером", d)).toBe("Пьеро' и пьером");
  });

  it("короткая основа — только точная форма", () => {
    const forms = stressedNameForms("ки'ти");
    expect(forms.get("кити")).toBe("ки'ти");
    expect(forms.size).toBe(1);
  });
});

describe("applyStressMarkup — SSML", () => {
  const d = dict([{ stressed: "база'ров", inflect: true }]);

  it("размечает только текстовые узлы, не трогая теги и атрибуты", () => {
    const ssml = `<speak><prosody rate="110%" pitch="+4%">Базаров молчал</prosody></speak>`;
    expect(applyStressMarkup(ssml, d)).toBe(
      `<speak><prosody rate="110%" pitch="+4%">База'ров молчал</prosody></speak>`,
    );
  });

  it("слово из словаря в значении атрибута не трогается", () => {
    const ssml = `<voice name="базаров">Базаров</voice>`;
    expect(applyStressMarkup(ssml, d)).toBe(`<voice name="базаров">База'ров</voice>`);
  });
});

describe("applyStressMarkup — уже размеченные слова", () => {
  it("не ставит второй апостроф", () => {
    const d = dict([{ stressed: "гермио'на", inflect: true }]);
    expect(applyStressMarkup("Гермио'на и Гермио’на", d)).toBe("Гермио'на и Гермио’на");
  });
});

describe("активный словарь", () => {
  it("базовый словарь размечает имена bundled-каталога и частотные слова", () => {
    expect(applyActiveStressMarkup("Хлестакову завидно")).toBe("Хлестако'ву зави'дно");
  });

  it("prime добавляет словоформы имён персонажей книги", () => {
    primeCharacterStressForms([
      { name: "Таргала", fullName: "Таргала Юг", stressedName: "Тарга'ла" },
    ]);
    expect(applyActiveStressMarkup("Таргала ушла, все ждали Таргалу")).toBe(
      "Тарга'ла ушла, все ждали Тарга'лу",
    );
    // Базовый словарь при этом остаётся активен.
    expect(applyActiveStressMarkup("звонит")).toBe("звони'т");
  });

  it("stressedName, не совпадающий с именем персонажа, игнорируется", () => {
    primeCharacterStressForms([
      { name: "Джензи", fullName: "Джензи Форс", stressedName: "Мага'та" },
    ]);
    expect(applyActiveStressMarkup("Магата пришла")).toBe("Магата пришла");
  });

  it("prime пустым списком возвращает базовый словарь", () => {
    primeCharacterStressForms([
      { name: "Джензи", fullName: "Джензи Форс", stressedName: "Дже'нзи" },
    ]);
    primeCharacterStressForms([]);
    expect(applyActiveStressMarkup("Джензи")).toBe("Джензи");
  });
});

describe("базовый словарь", () => {
  it("все записи валидны по конвенции «апостроф после гласной»", () => {
    for (const entry of BASE_STRESS_ENTRIES) {
      expect(parseStressedForm(entry.stressed), entry.stressed).not.toBeNull();
    }
  });

  it("омографов, требующих контекста, в словаре нет", () => {
    const compiled = compileStressDictionary(BASE_STRESS_ENTRIES);
    for (const homograph of ["замок", "дорога", "мука", "духи", "ирис", "хлопок", "творог"]) {
      expect(compiled.has(homograph), homograph).toBe(false);
    }
  });
});
