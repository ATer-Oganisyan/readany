import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screen = readFileSync(
  new URL("../../screens/NarraCharactersScreen.tsx", import.meta.url),
  "utf8",
);
const ruCommon = JSON.parse(
  readFileSync(
    new URL("../../../../core/src/i18n/locales/ru/common.json", import.meta.url),
    "utf8",
  ),
) as { narra: { findingCharacters: string } };

describe("characters processing status", () => {
  it("shows the processing state in Narra's subtitle without a separate status row", () => {
    expect(screen).toContain('backendStatus?.manifest?.availability === "processing"');
    expect(screen).toContain('t("narra.findingCharacters", "Ищу персонажей…")');
    expect(screen).not.toContain("Размечаю книгу…");
    expect(ruCommon.narra.findingCharacters).toBe("Ищу персонажей…");
  });
});
