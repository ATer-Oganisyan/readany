import { beforeEach, describe, expect, it } from "vitest";
import type { NarraCharacter } from "./types";
import {
  classifySegmentKind,
  clearReaderVoicePlan,
  markupVoiceSegments,
  primeReaderVoicePlan,
  resolveReaderVoiceForChunk,
} from "./voice-markup";

const NARRATOR = "Che";

function character(overrides: Partial<NarraCharacter> & { id: string }): NarraCharacter {
  return {
    name: overrides.id,
    fullName: overrides.id,
    role: "Персонаж",
    gender: "male",
    voice: "Ast",
    traits: [],
    speechStyle: "",
    speechExamples: [],
    appearancePrompt: "",
    unlockProgress: 0,
    ...overrides,
  };
}

const BAZAROV = character({
  id: "bazarov",
  name: "Базаров",
  fullName: "Евгений Васильевич Базаров",
  voice: "She",
});
const ARKADY = character({
  id: "arkady",
  name: "Аркадий",
  fullName: "Аркадий Николаевич Кирсанов",
  voice: "Ast",
});
const ANNA = character({
  id: "anna",
  name: "Одинцова",
  fullName: "Анна Сергеевна Одинцова",
  gender: "female",
  voice: "Ste",
});
const CAST = [BAZAROV, ARKADY, ANNA];

describe("classifySegmentKind", () => {
  it("treats dash lines with a capital letter or «ёлочки» as speech", () => {
    expect(classifySegmentKind("— Пойдём отсюда.")).toBe("speech");
    expect(classifySegmentKind("«Я подумаю», — ответила она.")).toBe("speech");
  });

  it("treats plain prose and lowercase dash tails as narration", () => {
    expect(classifySegmentKind("Вечер был тих, самовар остывал.")).toBe("narration");
    // Авторская ремарка после «!» отделяется в свой сегмент — это не реплика.
    expect(classifySegmentKind("— сказал Базаров, вставая.")).toBe("narration");
  });
});

describe("markupVoiceSegments: атрибуция реплик", () => {
  it("reads narration with the narrator voice", () => {
    const [entry] = markupVoiceSegments(["Сад был запущен и тёмен."], CAST, NARRATOR);
    expect(entry).toMatchObject({ voice: NARRATOR, characterId: null, kind: "narration" });
  });

  it("attributes by a speech verb inside the same segment", () => {
    const [entry] = markupVoiceSegments(
      ["— Природа не храм, а мастерская, — сказал Базаров."],
      CAST,
      NARRATOR,
    );
    expect(entry).toMatchObject({ voice: "She", characterId: "bazarov", kind: "speech" });
  });

  it("attributes «ёлочки» speech by the tail after the closing quote", () => {
    const [entry] = markupVoiceSegments(
      ["«Я подумаю об этом», — ответила Одинцова."],
      CAST,
      NARRATOR,
    );
    expect(entry).toMatchObject({ voice: "Ste", characterId: "anna" });
  });

  it("attributes by the attribution tail in the next segment", () => {
    const entries = markupVoiceSegments(
      ["— Ты готов ехать?", "— спросил Аркадий, поднимаясь."],
      CAST,
      NARRATOR,
    );
    expect(entries[0]).toMatchObject({ voice: "Ast", characterId: "arkady", kind: "speech" });
    // Сама ремарка — нарратив, голосом нарратора.
    expect(entries[1]).toMatchObject({ voice: NARRATOR, characterId: null, kind: "narration" });
  });

  it("falls back to the nearest name mentioned in previous narration", () => {
    const entries = markupVoiceSegments(
      ["Базаров подошёл к окну и долго молчал.", "— Здесь душно."],
      CAST,
      NARRATOR,
    );
    expect(entries[1]).toMatchObject({ voice: "She", characterId: "bazarov" });
  });

  it("does not mistake an in-line address for the speaker", () => {
    const entries = markupVoiceSegments(
      ["Базаров усмехнулся и отложил ланцет.", "— Послушай, Аркадий, это всё романтизм."],
      CAST,
      NARRATOR,
    );
    // Имя внутри реплики — обращение; спикер — из предыдущего нарратива.
    expect(entries[1]).toMatchObject({ voice: "She", characterId: "bazarov" });
  });

  it("gives unattributed speech the narrator voice (правило 7)", () => {
    const [entry] = markupVoiceSegments(["— Кто здесь?"], CAST, NARRATOR);
    expect(entry).toMatchObject({ voice: NARRATOR, characterId: null, kind: "speech" });
  });

  it("prefers voiceOverride and passes prosody for auto voices", () => {
    const withProsody = character({
      id: "arkady",
      name: "Аркадий",
      fullName: "Аркадий Николаевич Кирсанов",
      voice: "Ast",
      voiceProsody: { pitch: 2 },
    });
    const overridden = character({
      id: "bazarov",
      name: "Базаров",
      fullName: "Евгений Васильевич Базаров",
      voice: "She",
      voiceOverride: "Mar",
    });
    const entries = markupVoiceSegments(
      ["— Ну что, поехали, — сказал Аркадий.", "— Поехали, — ответил Базаров."],
      [withProsody, overridden],
      NARRATOR,
    );
    expect(entries[0]).toMatchObject({ voice: "Ast", prosody: { pitch: 2 } });
    // Ручной выбор приоритетнее автоназначения; просодия авто-плана не тянется.
    expect(entries[1]).toMatchObject({ voice: "Mar" });
    expect(entries[1].prosody).toBeUndefined();
  });
});

describe("активный план озвучки (реестр для edge-плеера)", () => {
  beforeEach(() => clearReaderVoicePlan());

  it("resolves chunk voices after priming and normalizes whitespace", () => {
    primeReaderVoicePlan(
      ["— Природа не храм, а мастерская, — сказал Базаров.", "Сад молчал."],
      CAST,
      NARRATOR,
    );
    expect(
      resolveReaderVoiceForChunk("— Природа не храм,  а мастерская, — сказал Базаров."),
    ).toMatchObject({ voice: "She" });
    expect(resolveReaderVoiceForChunk("Сад молчал.")).toMatchObject({ voice: NARRATOR });
    expect(resolveReaderVoiceForChunk("Незнакомый текст.")).toBeNull();
  });

  it("append extends the plan without dropping earlier entries", () => {
    primeReaderVoicePlan(["Первый абзац."], CAST, NARRATOR);
    primeReaderVoicePlan(["— Едем, — сказал Аркадий."], CAST, NARRATOR, { append: true });
    expect(resolveReaderVoiceForChunk("Первый абзац.")).toMatchObject({ voice: NARRATOR });
    expect(resolveReaderVoiceForChunk("— Едем, — сказал Аркадий.")).toMatchObject({
      voice: "Ast",
    });
  });

  it("clear resets the plan", () => {
    primeReaderVoicePlan(["Текст."], CAST, NARRATOR);
    clearReaderVoicePlan();
    expect(resolveReaderVoiceForChunk("Текст.")).toBeNull();
  });
});
