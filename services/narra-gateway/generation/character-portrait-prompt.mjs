export const PORTRAIT_PROMPT_CHAR_LIMIT = 1_600

const CLASSIC_PORTRAIT_ART_STYLE =
  'портретная иллюстрация в визуальном языке жанра «классическая литература»: ' +
  'классический живописный портрет в традиции книжной иллюстрации: натуральные пропорции, ' +
  'сдержанная академическая манера, мягкий естественный свет и благородная историческая палитра; ' +
  'единая серия работ одного художника; строго без текста, букв, цифр, надписей, логотипов и водяных знаков'

function shrinkPart(part, maxLength) {
  if (part.length <= maxLength) return part
  if (maxLength < 2) return ''
  const slice = part.slice(0, maxLength - 1)
  const lastSpace = slice.lastIndexOf(' ')
  const cut = lastSpace >= maxLength * 0.6 ? slice.slice(0, lastSpace) : slice
  const trimmed = cut.replace(/[\s,.;:!?…—-]+$/u, '')
  return trimmed ? `${trimmed}…` : ''
}

function budgetPrompt(parts, limit, artStyle) {
  const styleTail = `Стиль: ${artStyle}.`
  const body = parts.map((part) => String(part || '').replace(/\s+/gu, ' ').trim()).filter(Boolean)
  const assemble = () => [...body.filter(Boolean), styleTail].join(' ')
  let prompt = assemble()
  while (prompt.length > limit && body.some(Boolean)) {
    const overflow = prompt.length - limit
    let longest = 0
    for (let index = 1; index < body.length; index += 1) {
      if (body[index].length > body[longest].length) longest = index
    }
    body[longest] = shrinkPart(body[longest], body[longest].length - overflow)
    prompt = assemble()
  }
  return prompt
}

function bookContext(title, author) {
  return `«${title}»${author ? ` (${author})` : ''}`
}

function isBuratino(character, fullName) {
  const key = String(character?.characterKey || '').toLocaleLowerCase('ru')
  const name = String(fullName || character?.name || '').trim().toLocaleLowerCase('ru')
  return key === 'character:buratino' || key.endsWith(':buratino') || name === 'буратино'
}

/**
 * Серверный эквивалент origin/main buildCharacterPortraitPrompt для
 * автоматически подготавливаемых портретов. Bundle-контракт пока не несёт
 * жанр и expression, поэтому используются те же origin-дефолты.
 */
export function buildCharacterPortraitPrompt({ character, fullName, bookTitle, bookAuthor = '' }) {
  const context = bookContext(bookTitle, bookAuthor)
  if (isBuratino(character, fullName)) {
    return budgetPrompt([
      'Ровно одна неодушевлённая театральная деревянная марионетка в кадре — Буратино. Это не человек и не ребёнок: окрашенная резная кукла без возраста и без реалистичной человеческой анатомии.',
      'Вертикальный портрет куклы до талии в среднем плане, строго анфас. Между верхним краем изображения и макушкой ровно 10% высоты кадра. Светлый однотонный фон.',
      `Кукольный персонаж книги ${context}; простой костюм сказочного театра.`,
      'Без других персонажей, без текста, букв, логотипов и водяных знаков.'
    ], PORTRAIT_PROMPT_CHAR_LIMIT, CLASSIC_PORTRAIT_ART_STYLE)
  }

  const appearance = character.appearancePrompt || character.description || [
    character.age,
    character.role
  ].filter(Boolean).join(', ') || fullName

  return budgetPrompt([
    `Ровно один человек в кадре — ${fullName}, никого больше: без второстепенных персонажей, без силуэтов и людей на фоне.`,
    'Вертикальный портрет до талии в среднем плане, строго анфас, взгляд в камеру, ровный светлый однотонный фон. Камера отдалена: персонаж целиком показан от макушки до линии талии, полностью видны голова, плечи, грудь и весь торс; лицо не доминирует в кадре. Свободное пространство между верхним краем изображения и макушкой составляет ровно 10% высоты кадра. По сторонам плеч остаётся спокойное свободное пространство. Локти могут обрезаться боковыми краями, кисти рук не обязательны. Не делать headshot, крупный план лица или тесный погрудный кадр; не показывать человека в полный рост.',
    `Персонаж книги ${context}: одежда, причёска и антураж строго соответствуют эпохе и миру книги, без современной одежды.`,
    'Выражение лица: естественное, в характере.',
    `Внешность (соблюдать точно): ${appearance}.`
  ], PORTRAIT_PROMPT_CHAR_LIMIT, CLASSIC_PORTRAIT_ART_STYLE)
}
