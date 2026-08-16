const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function invalid(message) {
  throw Object.assign(new Error(message), { code: 'VALIDATION', status: 400 })
}

function text(value, name, max, { required = false } = {}) {
  if (value == null && !required) return ''
  if (typeof value !== 'string') invalid(`${name}: нужна строка`)
  const result = value.replace(/\s+/gu, ' ').trim()
  if ((required && !result) || result.length > max) invalid(`${name}: недопустимая длина`)
  return result
}

function character(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`characters[${index}]: нужен объект`)
  }
  const allowed = new Set(['name', 'full_name', 'role', 'gender', 'appearance'])
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    invalid(`characters[${index}]: неизвестное поле`)
  }
  return {
    name: text(value.name, `characters[${index}].name`, 160, { required: true }),
    fullName: text(value.full_name, `characters[${index}].full_name`, 240),
    role: text(value.role, `characters[${index}].role`, 400),
    gender: text(value.gender, `characters[${index}].gender`, 32),
    appearance: text(value.appearance, `characters[${index}].appearance`, 1_500)
  }
}

export function parseSceneJobBody(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('body: нужен объект')
  const allowed = new Set([
    'request_id', 'book_title', 'book_author', 'chapter', 'excerpt',
    'characters', 'previous_excerpts'
  ])
  if (Object.keys(input).some((key) => !allowed.has(key))) invalid('body: неизвестное поле')
  const requestId = text(input.request_id, 'request_id', 36, { required: true })
  if (!UUID_V4.test(requestId)) invalid('request_id: нужен UUID v4')
  if (!Array.isArray(input.characters) || input.characters.length > 16) {
    invalid('characters: нужен массив до 16 элементов')
  }
  if (!Array.isArray(input.previous_excerpts) || input.previous_excerpts.length > 2) {
    invalid('previous_excerpts: нужен массив до 2 элементов')
  }
  return {
    requestId,
    bookTitle: text(input.book_title, 'book_title', 500, { required: true }),
    bookAuthor: text(input.book_author, 'book_author', 500),
    chapter: text(input.chapter, 'chapter', 500),
    excerpt: text(input.excerpt, 'excerpt', 4_000, { required: true }),
    characters: input.characters.map(character),
    previousExcerpts: input.previous_excerpts.map((value, index) =>
      text(value, `previous_excerpts[${index}]`, 1_200, { required: true })
    )
  }
}

function clipped(value, max) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).replace(/[\s,.;:!?…—-]+$/u, '')}…`
}

/** The client sends facts only; provider-specific prompt policy lives here. */
export function sceneGenerationPrompt(input) {
  const book = `«${input.bookTitle}»${input.bookAuthor ? ` (${input.bookAuthor})` : ''}`
  const characters = input.characters
    .map((value) => {
      const appearance = value.appearance || [value.role, value.gender].filter(Boolean).join(', ')
      return `${value.fullName || value.name}${appearance ? `: ${appearance}` : ''}`
    })
    .join('; ')
  const previous = input.previousExcerpts.length
    ? `Ранее в этой серии: ${input.previousExcerpts.map((value) => `«${clipped(value, 600)}»`).join(' ')}`
    : ''
  return [
    'Создай горизонтальную литературную иллюстрацию 3:2, единое пространство и один момент времени, не коллаж.',
    `Книга ${book}${input.chapter ? `, глава «${input.chapter}»` : ''}. Одежда, архитектура и предметы строго соответствуют эпохе и миру книги.`,
    `Главное — действие в разгаре жеста, без статичного позирования и взглядов в камеру. Отрывок: ${clipped(input.excerpt, 3_500)}`,
    characters
      ? `Персонажи: показывай только упомянутых в отрывке героев. Каноническая внешность: ${characters}.`
      : 'Показывай только тех людей, которые действуют в отрывке; не добавляй лишних персонажей.',
    previous,
    'Выразительная книжная графика, цельная палитра. Строго без текста, букв, цифр, логотипов и водяных знаков.'
  ].filter(Boolean).join('\n\n').slice(0, 8_000)
}
