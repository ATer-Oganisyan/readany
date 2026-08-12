import coverGenerationConfig from "./cover-generation-config.json";

export type CoverTextTone = "dark" | "light";

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

  return coverGenerationConfig.backgroundColors[
    colorSeed % coverGenerationConfig.backgroundColors.length
  ];
}

export function generatedCoverTextTone(input: {
  title: string;
  author?: string;
}): CoverTextTone {
  return LIGHT_TEXT_BACKGROUNDS.has(generatedCoverBackgroundColor(input)) ? "light" : "dark";
}
