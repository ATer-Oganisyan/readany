import { formatBookCoverIdentity } from "./format-book-cover-title";

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

const GENERATED_COVER_PLACEHOLDER_COLORS: Record<
  (typeof GENERATED_COVER_BACKGROUNDS)[number],
  string
> = {
  "deep cobalt blue": "#31569A",
  "muted vermilion red": "#B95043",
  "dark forest green": "#365C42",
  "burnt orange": "#B96632",
  "deep plum purple": "#65405F",
  "charcoal black": "#343434",
  "dusty turquoise": "#69A5A3",
  "mustard yellow": "#C49B38",
};

const LIGHT_TEXT_BACKGROUNDS = new Set([
  "deep cobalt blue",
  "muted vermilion red",
  "dark forest green",
  "deep plum purple",
  "charcoal black",
]);

export function generatedCoverBackgroundColor(input: {
  title: string;
  author?: string;
}): (typeof GENERATED_COVER_BACKGROUNDS)[number] {
  const formattedIdentity = formatBookCoverIdentity(input.title, input.author);
  const title = formattedIdentity.title.replaceAll("\u00A0", " ") || "Untitled book";
  const author = formattedIdentity.author || "Unknown author";
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

export function generatedCoverPlaceholderColor(input: {
  title: string;
  author?: string;
}): string {
  return GENERATED_COVER_PLACEHOLDER_COLORS[generatedCoverBackgroundColor(input)];
}
