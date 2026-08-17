import { readFileSync } from 'node:fs'
import { resolveCoverGenreProfile } from './cover-genre.mjs'

const coverGenerationConfig = JSON.parse(
  readFileSync(new URL('./cover-generation-config.json', import.meta.url), 'utf8')
)
const COVER_PROMPT_TEMPLATE = coverGenerationConfig.promptParagraphs.join('\n\n')
const MAX_THEME_CHARS = 800

export const BOOK_COVER_PROMPT_VERSION = 'book-cover-prompt-v3'

// Keep this algorithm semantically identical to coverPrompt() at origin/main
// 4da75687: packages/app-expo/src/lib/book/generate-book-cover.ts.
export function generatedCoverBackgroundColor(input) {
  const title = input.title.trim() || 'Untitled book'
  const author = input.author?.trim() || 'Unknown author'
  const colorSeed = Array.from(`${title}:${author}`).reduce(
    (hash, character) => (hash * 31 + (character.codePointAt(0) || 0)) >>> 0,
    0
  )
  return coverGenerationConfig.backgroundColors[
    colorSeed % coverGenerationConfig.backgroundColors.length
  ]
}

export function bookCoverPrompt(input) {
  const title = input.title.trim() || 'Untitled book'
  const author = input.author?.trim() || 'Unknown author'
  const themeSource = input.description?.trim() || input.excerpt?.trim()
  const theme = themeSource
    ? themeSource.replace(/\s+/gu, ' ').slice(0, MAX_THEME_CHARS)
    : 'Infer the central idea, mood, symbols and historical context from the title and author without reproducing their names as text.'
  const genre = resolveCoverGenreProfile(input)
  const backgroundColor = input.accentColor1?.trim() ||
    generatedCoverBackgroundColor({ title, author })
  const replacements = {
    '{{BOOK_TITLE}}': title,
    '{{AUTHOR}}': author,
    '{{BOOK_DESCRIPTION}}': theme,
    '{{BOOK_GENRE}}': genre.label,
    '{{GENRE_ART_DIRECTION}}': genre.artDirection,
    '{{BACKGROUND_COLOR}}': backgroundColor
  }

  return Object.entries(replacements).reduce(
    (prompt, [placeholder, value]) => prompt.replaceAll(placeholder, value),
    COVER_PROMPT_TEMPLATE
  )
}

export const catalogCoverPrompt = bookCoverPrompt
