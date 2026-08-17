export type CoverTextTone = "dark" | "light";

const GENERATED_COVER_BACKGROUNDS = [
  "deep cobalt blue",
  "muted vermilion red",
  "dark forest green",
  "burnt orange",
  "deep plum purple",
  "charcoal black",
  "dusty turquoise",
  "mustard yellow",
] as const;

const LIGHT_TEXT_BACKGROUNDS = new Set([
  "deep cobalt blue",
  "muted vermilion red",
  "dark forest green",
  "deep plum purple",
  "charcoal black",
]);

export function generatedCoverBackgroundColor(input: { title: string; author?: string }): string {
  const title = input.title.trim() || "Untitled book";
  const author = input.author?.trim() || "Unknown author";
  const colorSeed = Array.from(`${title}:${author}`).reduce(
    (hash, character) => (hash * 31 + (character.codePointAt(0) || 0)) >>> 0,
    0,
  );

  return GENERATED_COVER_BACKGROUNDS[colorSeed % GENERATED_COVER_BACKGROUNDS.length];
}

export function generatedCoverTextTone(input: {
  title: string;
  author?: string;
}): CoverTextTone {
  return LIGHT_TEXT_BACKGROUNDS.has(generatedCoverBackgroundColor(input)) ? "light" : "dark";
}
