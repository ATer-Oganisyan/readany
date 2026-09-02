import { describe, expect, it } from "vitest";
import { applyCuratedPortraitAssets } from "./curated-portraits";
import type { NarraCharacter } from "./types";

function backendCharacter(overrides: Partial<NarraCharacter>): NarraCharacter {
  return {
    id: "character:abc",
    name: "Герой",
    fullName: "Герой",
    role: "",
    gender: "male",
    voice: "",
    traits: [],
    speechStyle: "",
    speechExamples: [],
    appearancePrompt: "",
    unlockProgress: 0,
    backendManaged: true,
    ...overrides,
  } as NarraCharacter;
}

describe("applyCuratedPortraitAssets", () => {
  it("подставляет кураторский портрет по короткому имени", () => {
    const [character] = applyCuratedPortraitAssets(
      [backendCharacter({ name: "Раскольников", fullName: "Родион Раскольников" })],
      "Преступление и наказание",
    );
    expect(character.portraitAssetId).toBe("crime-and-punishment/rodion-raskolnikov");
  });

  it("матчит по полному имени и по фамилии из полного имени", () => {
    const characters = applyCuratedPortraitAssets(
      [
        backendCharacter({ name: "Соня", fullName: "Софья Семёновна Мармеладова" }),
        backendCharacter({ name: "Аркадий Иванович", fullName: "Аркадий Иванович Свидригайлов" }),
      ],
      "Преступление и наказание",
    );
    expect(characters[0].portraitAssetId).toBe("crime-and-punishment/sonya-marmeladova");
    expect(characters[1].portraitAssetId).toBe("crime-and-punishment/arkady-svidrigailov");
  });

  it("не трогает персонажа с уже назначенным ассетом и не выдаёт один ассет дважды", () => {
    const characters = applyCuratedPortraitAssets(
      [
        backendCharacter({ name: "Раскольников", portraitAssetId: "custom/asset" }),
        backendCharacter({ name: "Родион Раскольников" }),
        backendCharacter({ name: "Раскольников" }),
      ],
      "Преступление и наказание",
    );
    expect(characters[0].portraitAssetId).toBe("custom/asset");
    expect(characters[1].portraitAssetId).toBe("crime-and-punishment/rodion-raskolnikov");
    expect(characters[2].portraitAssetId).toBeUndefined();
  });

  it("без названия книги или кураторского набора возвращает персонажей как есть", () => {
    const source = [backendCharacter({ name: "Раскольников" })];
    expect(applyCuratedPortraitAssets(source, undefined)).toBe(source);
    const [unknown] = applyCuratedPortraitAssets(source, "Неизвестная книга");
    expect(unknown.portraitAssetId).toBeUndefined();
  });

  it("книги вне белого списка не трогает, даже если есть кураторский набор", () => {
    const [anna] = applyCuratedPortraitAssets(
      [backendCharacter({ name: "Анна Каренина", fullName: "Анна Аркадьевна Каренина" })],
      "Анна Каренина",
    );
    expect(anna.portraitAssetId).toBeUndefined();
  });

  it("не подставляет портрет постороннему персонажу", () => {
    const [stranger] = applyCuratedPortraitAssets(
      [backendCharacter({ name: "Мармеладов", fullName: "Семён Захарович Мармеладов" })],
      "Преступление и наказание",
    );
    // Отец Сони — отдельный герой без кураторского портрета; фамилия Мармеладова
    // не должна притянуть портрет дочери.
    expect(stranger.portraitAssetId).toBeUndefined();
  });
});
