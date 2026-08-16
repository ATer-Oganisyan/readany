import { createHash } from 'node:crypto'

const BACKGROUNDS = [
  'deep cobalt blue',
  'muted vermilion red',
  'dark forest green',
  'burnt orange',
  'deep plum purple',
  'charcoal black',
  'dusty turquoise',
  'mustard yellow'
]

function text(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function catalogCoverPrompt({ title, author, context = '' }) {
  const bookTitle = text(title, 'Untitled book').slice(0, 500)
  const bookAuthor = text(author, 'Unknown author').slice(0, 500)
  const summary = text(context, 'Infer the central idea, mood and historical context from the title and author.')
    .replace(/\s+/gu, ' ')
    .slice(0, 1_200)
  const seed = createHash('sha256').update(`${bookTitle}\n${bookAuthor}`).digest()[0]
  const background = BACKGROUNDS[seed % BACKGROUNDS.length]
  return [
    'Create complete vertical 2:3 front-cover artwork for a literary book.',
    `Meaning context only: “${bookTitle}” by ${bookAuthor}. ${summary}`,
    'Translate the central idea into one intelligent visual metaphor, not a literal plot summary.',
    `Use a full-bleed ${background} matte paper field with restrained analogue print texture.`,
    'Place one compact dominant illustration in the lower half; keep the upper third quiet but fully colored.',
    'Independent European editorial design, late-modernist and constructivist book graphics, controlled asymmetry.',
    'Absolutely no visible text, letters, numbers, logos, signatures, barcode, border or physical-book mockup.',
    'Generate only the finished flat cover artwork.'
  ].join('\n\n')
}
