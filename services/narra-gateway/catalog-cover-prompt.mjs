import { readFileSync } from 'node:fs'
import { resolveCoverGenreProfile } from './cover-genre.mjs'

const coverGenerationConfig = JSON.parse(
  readFileSync(new URL('./cover-generation-config.json', import.meta.url), 'utf8')
)
const COVER_PROMPT_TEMPLATE = coverGenerationConfig.promptParagraphs.join('\n\n')
const MAX_THEME_CHARS = 800

export const BOOK_COVER_PROMPT_VERSION = 'book-cover-prompt-v3'

function text(value, fallback, max = 500) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : fallback
}

export function generatedCoverBackgroundColor({ title, author }) {
  const bookTitle = text(title, 'Untitled book')
  const bookAuthor = text(author, 'Unknown author')
  const colorSeed = Array.from(`${bookTitle}:${bookAuthor}`).reduce(
    (hash, character) => (hash * 31 + (character.codePointAt(0) || 0)) >>> 0,
    0
  )
  return coverGenerationConfig.backgroundColors[
    colorSeed % coverGenerationConfig.backgroundColors.length
  ]
}

export function bookCoverPrompt({
  title,
  author,
  description,
  excerpt,
  context,
  subjects = []
}) {
  const bookTitle = text(title, 'Untitled book')
  const bookAuthor = text(author, 'Unknown author')
  const themeSource = [description, context, excerpt]
    .find((value) => typeof value === 'string' && value.trim())
  const theme = themeSource
    ? themeSource.trim().replace(/\s+/gu, ' ').slice(0, MAX_THEME_CHARS)
    : 'Infer the central idea, mood, symbols and historical context from the title and author without reproducing their names as text.'
  const genre = resolveCoverGenreProfile({
    subjects: Array.isArray(subjects) ? subjects : [],
    title: bookTitle,
    description: themeSource ? theme : undefined,
    excerpt
  })
  const backgroundColor = generatedCoverBackgroundColor({
    title: bookTitle,
    author: bookAuthor
  })
  const replacements = {
    '{{BOOK_TITLE}}': bookTitle,
    '{{AUTHOR}}': bookAuthor,
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
