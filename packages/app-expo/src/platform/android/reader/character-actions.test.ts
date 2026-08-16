import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENT_URL = new URL(
  "../../../screens/reader/ReaderCharacterActions.android.tsx",
  import.meta.url,
);
const ICON_FILES = ["chat.xml", "hourglass.xml", "refresh.xml", "stop.xml", "volume-up.xml"];

describe("Android character profile actions", () => {
  it("renders native vector icons instead of Material Symbols ligature text", () => {
    const source = readFileSync(COMPONENT_URL, "utf8");

    expect(source).toContain("<Icon");
    expect(source).not.toContain("materialSymbols");
    expect(source).not.toContain("<Text");
  });

  it.each(ICON_FILES)("ships the %s Android vector drawable", (fileName) => {
    const vector = readFileSync(
      new URL(`./character-action-icons/${fileName}`, import.meta.url),
      "utf8",
    );

    expect(vector).toContain("<vector");
    expect(vector).toContain("android:pathData=");
  });
});
