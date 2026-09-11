import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildCharacterNameMatcherSpec, findCharacterNameMatches } from "./character-name-matcher";
import { emptyNarraBookState, isCharacterUnlocked, withNarraCharacters } from "./domain";
import type { NarraCharacter } from "./types";

describe("characters encountered in the reader", () => {
  it("opens a visible character before the percentage threshold and preserves it on refresh", () => {
    const character = {
      id: "r",
      unlockProgress: 0.01353,
      encounteredInReader: true,
    } as NarraCharacter;
    expect(isCharacterUnlocked(0.0034, { ...character, encounteredInReader: false })).toBe(false);
    expect(isCharacterUnlocked(0.0034, character)).toBe(true);
    const state = { ...emptyNarraBookState("book"), characters: [character] };
    const refreshed = withNarraCharacters(state, [
      { ...character, encounteredInReader: undefined },
    ]);
    expect(isCharacterUnlocked(0, refreshed.characters[0])).toBe(true);
    expect(
      withNarraCharacters(emptyNarraBookState("other"), [
        { ...character, encounteredInReader: undefined },
      ]).characters[0].encounteredInReader,
    ).toBeUndefined();
  });

  it("does not mistake Raskolnikov for his mother or resolve ambiguous inflections", () => {
    const spec = buildCharacterNameMatcherSpec([
      { id: "r", name: "Раскольников" },
      { id: "mother", name: "Пульхерия Александровна Раскольникова" },
    ]);
    expect(
      findCharacterNameMatches("Раскольников, студент", spec).map((m) => m.characterId),
    ).toEqual(["r"]);
    expect(findCharacterNameMatches("У Раскольникова", spec)).toEqual([]);
    expect(
      findCharacterNameMatches("Пульхерия Александровна Раскольникова", spec).map(
        (m) => m.characterId,
      ),
    ).toEqual(["mother"]);
  });

  it("reports only displayed spans once, excluding prefetched offscreen names", () => {
    const html = readFileSync(
      new URL("../../../assets/reader/reader.template.html", import.meta.url),
      "utf8",
    );
    const source = html.slice(
      html.indexOf("    function reportVisibleCharacters()"),
      html.indexOf("    function characterNameInjectStyles"),
    );
    const spans = ["visible", "offscreen"].map((id) => ({ getAttribute: () => id }));
    let displayed = spans[0];
    const messages: unknown[] = [];
    const context = vm.createContext({
      view: {
        lastLocation: {
          range: {
            startContainer: { ownerDocument: { querySelectorAll: () => spans } },
            intersectsNode: (span: unknown) => span === displayed,
          },
        },
      },
      CHARACTER_NAME_ATTR: "data-readany-character-id",
      _encounteredCharacterIds: new Set(),
      _characterReaderLoadId: "book-load",
      postToRN: (type: string, payload: unknown) => messages.push({ type, payload }),
    });
    vm.runInContext(source + "reportVisibleCharacters(); reportVisibleCharacters();", context);
    expect(messages).toEqual([
      {
        type: "charactersEncountered",
        payload: { characterIds: ["visible"], loadId: "book-load" },
      },
    ]);
    displayed = spans[1];
    vm.runInContext("reportVisibleCharacters()", context);
    expect(messages).toHaveLength(2);
  });
});
