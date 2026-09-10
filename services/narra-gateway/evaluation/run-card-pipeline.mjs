/**
 * Сквозной прогон нового конвейера на одном тексте книги.
 *
 * Inventory → фрагменты → подтверждение roster (1 вызов) → окна → карточки
 * (по вызову на персонажа). Ни базы, ни MinIO: всё держится в памяти, чтобы
 * прогон можно было сделать на любом тексте и сравнить с замороженным gold тем
 * же скорером, каким мерится продовый пайплайн.
 *
 *   JUDGE_BASE_URL=... JUDGE_API_KEY=... JUDGE_MODEL=... \
 *   node evaluation/run-card-pipeline.mjs --text /tmp/book.txt \
 *     --title "Гордость и предубеждение" --author "Джейн Остин" \
 *     --out /tmp/run.json [--cards 12]
 *
 * Модель берётся из тех же переменных, что у судьи карточек: это осознанно —
 * прогон исследовательский, и штатный `generation-service-client` требует
 * поднятого сервиса генерации, которого локально нет.
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { Agent, request as httpsRequest } from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildBookNameInventory,
  inventoryRoster,
  inventorySignificant
} from '../analysis/book-name-inventory.mjs'
import { collectBookCharacterFragments } from '../analysis/book-character-fragments.mjs'
import {
  bookChapters,
  bookParagraphs
} from '../analysis/book-text-index.mjs'
import { cardWindowForOffset } from '../analysis/book-card-windows.mjs'
import {
  applyRosterConfirmation,
  buildRosterConfirmationRequest,
  validateRosterConfirmation
} from '../analysis/book-roster-confirmation.mjs'
import {
  buildCharacterCardRequest,
  finalizeCharacterCard
} from '../analysis/book-character-card.mjs'
import { characterCardProjection } from '../analysis/book-character-card-contract.mjs'
import {
  normalizeCharacterCardRequest,
  normalizeCharacterCardResult,
  normalizeRosterConfirmationRequest,
  normalizeRosterConfirmationResult,
  characterCardMessages,
  rosterConfirmationMessages
} from '../generation/internal-generation-contracts.mjs'

function inputError(message) {
  return Object.assign(new TypeError(message), { code: 'CARD_PIPELINE_INPUT_INVALID' })
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Первый JSON-объект в ответе модели: рассуждающие модели любят обёртки. */
function parseJson(raw) {
  const text = String(raw ?? '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : text).trim()
  try {
    return JSON.parse(body)
  } catch {
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start < 0 || end <= start) throw inputError('model did not return JSON')
    return JSON.parse(body.slice(start, end + 1))
  }
}

/**
 * POST через `node:https`, а не через `fetch`.
 *
 * У встроенного fetch есть свой headers timeout в 300 секунд, и он не
 * настраивается ни `AbortSignal`, ни опциями запроса — только глобальным
 * undici-диспетчером, которого в зависимостях нет. Рассуждающая модель на
 * запросе подтверждения roster из 128 кандидатов думает дольше пяти минут, и
 * запрос падал с `UND_ERR_HEADERS_TIMEOUT` ровно на этом пороге.
 */
function postJson({ url, apiKey, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (handler) => (value) => {
      if (settled) return
      settled = true
      handler(value)
    }
    const succeed = finish(resolve)
    const fail = finish(reject)
    const payload = Buffer.from(JSON.stringify(body), 'utf8')
    const target = new URL(url)
    const call = httpsRequest({
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      // Соединение закрывается вместе с ответом. Держать keep-alive здесь
      // нечего: между вызовами модели проходят минуты, простаивающее
      // соединение провайдер рвёт сам, и сброс приходит на уже завершённый
      // запрос — тот самый `ECONNRESET: socket hang up`, который уронил прогон
      // «Преступления и наказания» посреди подтверждения roster, минуя цикл
      // повторов.
      agent: new Agent({ keepAlive: false }),
      headers: {
        'content-type': 'application/json',
        'content-length': payload.byteLength,
        connection: 'close',
        authorization: `Bearer ${apiKey}`
      }
    }, (response) => {
      const chunks = []
      // `call.setTimeout` — таймаут простоя сокета, а не всей операции: он
      // сам сбрасывается на каждом байте, поэтому у потокового ответа ловит
      // настоящее молчание, а не длительность запроса.
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('error', fail)
      response.on('end', () => succeed({
        status: response.statusCode ?? 0,
        text: Buffer.concat(chunks).toString('utf8')
      }))
    })
    call.setTimeout(timeoutMs, () => {
      call.destroy(Object.assign(new Error('model request timed out'), { code: 'MODEL_TIMEOUT' }))
    })
    call.on('error', fail)
    call.end(payload)
  })
}

/**
 * Ответ модели из потока Server-Sent Events.
 *
 * Зачем поток вообще. Подтверждение roster — это ~35 000 токенов запроса, и
 * рассуждающая модель молчит над ним минуты. За это время по соединению не идёт
 * ни байта, и посредник провайдера его рвёт: прогон «Преступления и наказания»
 * падал трижды подряд и тремя разными способами — HTTP 503 «connection
 * termination», `ECONNRESET` и `socket hang up`. Поток заставляет провайдера
 * присылать байты непрерывно, и рвать становится нечего.
 *
 * Рассуждение приходит в `reasoning_content`, ответ — в `content`; собирается
 * только второе, иначе в разбор JSON уходят размышления модели.
 */
/** Тело — поток SSE, а не обычный JSON. */
export function isEventStream(text) {
  return /^\s*(?::|data:|event:)/m.test(String(text))
}

export function contentFromEventStream(text) {
  let content = ''
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') continue
    let event = null
    try {
      event = JSON.parse(data)
    } catch {
      continue
    }
    const choice = event?.choices?.[0]
    const piece = choice?.delta?.content ?? choice?.message?.content
    if (typeof piece === 'string') content += piece
  }
  return content
}

export function createModelClient(env = process.env) {
  const baseUrl = String(env.JUDGE_BASE_URL || env.LITELLM_BASE_URL || '').replace(/\/$/, '')
  const apiKey = env.JUDGE_API_KEY || env.LITELLM_API_KEY
  const model = env.JUDGE_MODEL || env.LITELLM_MODEL
  // Бюджет простоя, а не всей операции: `call.setTimeout` — таймаут молчания
  // сокета, он сбрасывается на каждом байте. При потоке провайдер начинает
  // присылать байты за секунды (измерено на настоящем запросе подтверждения
  // roster: первый байт через 2.6 с), поэтому долгое молчание означает не
  // «модель думает», а «запрос попал на застрявший upstream». Прежние
  // тридцать минут превращали такой случай в тридцать минут ожидания: прогон
  // «Преступления и наказания» простоял 22 минуты на первой попытке и 10 минут
  // на тривиальном запросе в 8 000 токенов, тогда как запрос на 32 000 токенов
  // в тот же момент прошёл за 10 секунд. Две минуты молчания — это уже сбой, и
  // дешевле начать заново.
  const timeoutMs = Number(env.MODEL_TIMEOUT_MS || 120_000)
  if (!baseUrl || !apiKey || !model) return null
  const attempts = Number(env.MODEL_MAX_ATTEMPTS || 5)
  // Поток по умолчанию: без него длинный запрос рвут по простою. `MODEL_STREAM=0`
  // оставлен для провайдера, который потока не умеет.
  const stream = String(env.MODEL_STREAM ?? '1') !== '0'
  return async (messages) => {
    let lastError = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await postJson({
          url: `${baseUrl}/chat/completions`,
          apiKey,
          body: { model, messages, temperature: 0, ...(stream ? { stream: true } : {}) },
          timeoutMs
        })
        if (response.status >= 200 && response.status < 300) {
          if (stream) {
            const content = contentFromEventStream(response.text)
            if (content) return content
            // Пустой ответ при потоке значит одно из двух, и различать их
            // обязательно. Если в теле есть события SSE, поток кончился до
            // первого куска ответа — рассуждение шло, ответ не начался; это
            // обрыв, и повторять его можно. Если событий нет, провайдер ответил
            // обычным JSON, хотя его просили потоком, — тогда разбираем как
            // непотоковый ответ. Раньше здесь в обоих случаях шёл JSON.parse по
            // тексту SSE, и настоящий обрыв выглядел как «Unexpected token 'd',
            // \"data: {\"ch\"…\" is not valid JSON».
            if (isEventStream(response.text)) {
              throw Object.assign(
                new Error('model stream ended before any content delta'),
                { code: 'MODEL_STREAM_TRUNCATED' }
              )
            }
          }
          const body = JSON.parse(response.text)
          return body?.choices?.[0]?.message?.content ?? ''
        }
        lastError = new Error(`model failed: HTTP ${response.status} ${response.text.slice(0, 400)}`)
        if (response.status < 500) throw lastError
      } catch (error) {
        lastError = error
        if (attempt === attempts) throw error
      }
      // Пауза между попытками, а не три подряд.
      //
      // Прогон «Преступления и наказания» упал на подтверждении roster с тремя
      // HTTP 503 «upstream connect error … connection termination»: шлюз
      // провайдера сдаётся на длинном рассуждении, и три мгновенных повтора
      // приходят в ту же перегрузку. Ждать здесь дешевле, чем терять час
      // прогона: запрос всё равно занимает минуты.
      const waitMs = Math.min(60_000, 2_000 * 2 ** (attempt - 1))
      process.stderr.write(`${JSON.stringify({
        stage: 'model_retry',
        attempt,
        waitMs,
        reason: String(lastError?.message ?? '').slice(0, 200)
      })}\n`)
      await new Promise((resolve) => { setTimeout(resolve, waitMs) })
    }
    throw lastError ?? new Error('model request failed')
  }
}

export async function runCardPipeline({
  text,
  title,
  author = '',
  runId = randomUUID(),
  bookEditionId = randomUUID(),
  maxCards = 0,
  complete,
  onProgress = () => {}
}) {
  if (!text) throw inputError('text is required')
  const normalizedTextHash = sha256(Buffer.from(text, 'utf8'))
  const paragraphs = bookParagraphs(text)
  const chapters = bookChapters(text, { paragraphs })

  onProgress({ stage: 'inventory' })
  const inventory = buildBookNameInventory({ text, normalizedTextHash })
  const candidates = inventoryRoster(inventory)

  onProgress({ stage: 'fragments', count: candidates.length })
  const fragments = collectBookCharacterFragments({
    text,
    characters: candidates.map((candidate) => ({
      characterKey: candidate.candidateKey,
      names: [
        candidate.displayName,
        ...candidate.aliases,
        ...(candidate.fullName ? [candidate.fullName] : [])
      ]
    })),
    // Собираем щедро: окно карточки вырезается ниже, и при скупом лимите в
    // окно первых глав попадал один абзац на персонажа — карточка строилась
    // фактически по одной цитате. В продакшене этой проблемы нет: там
    // фрагменты лежат в базе целиком, а окно отбирает их запросом.
    maxFragmentsPerCharacter: 4_000
  })

  onProgress({ stage: 'roster_confirm' })
  const request = buildRosterConfirmationRequest({
    runId,
    bookEditionId,
    title,
    author,
    inventoryVersion: inventory.inventoryVersion,
    normalizedTextHash,
    candidates,
    fragments
  })
  if (!request) throw inputError('inventory produced nothing to confirm')
  const normalizedRequest = normalizeRosterConfirmationRequest({
    idempotencyKey:
      `${runId}:roster-confirm:${request.inventoryVersion}:${request.promptVersion}`,
    ...request
  })
  const rosterRaw = await complete(rosterConfirmationMessages(normalizedRequest))
  const rosterShape = normalizeRosterConfirmationResult(parseJson(rosterRaw), normalizedRequest)
  const confirmation = validateRosterConfirmation({ request, response: rosterShape })
  const roster = applyRosterConfirmation({ request, candidates, confirmation })

  onProgress({ stage: 'cards', count: roster.length })
  const byKey = new Map(fragments.characters.map((entry) => [entry.characterKey, entry]))
  const ordered = [...roster].sort((left, right) => right.mentionCount - left.mentionCount)
  const selected = maxCards > 0 ? ordered.slice(0, maxCards) : ordered
  const cards = []
  const cardFailures = []
  for (const [index, character] of selected.entries()) {
    onProgress({ stage: 'card', index: index + 1, total: selected.length, name: character.canonicalName })
    const window = cardWindowForOffset(chapters, character.firstMentionTextOffset)
    const windowFragments = character.candidateKeys
      .flatMap((key) => byKey.get(key)?.fragments ?? [])
      .filter((fragment) =>
        fragment.startOffset >= window.startOffset && fragment.endOffset <= window.endOffset)
      // Фрагменты слитых кандидатов теперь принадлежат одному персонажу.
      .map((fragment) => ({ ...fragment, characterKey: character.characterKey }))
      .sort((left, right) => left.startOffset - right.startOffset)
    if (!windowFragments.length) {
      cardFailures.push({ characterKey: character.characterKey, reason: 'no_fragments_in_window' })
      continue
    }
    try {
      const cardRequest = buildCharacterCardRequest({
        runId,
        bookEditionId,
        characterKey: character.characterKey,
        character: {
          canonicalName: character.canonicalName,
          names: [character.canonicalName, ...character.names],
          mentionCount: character.mentionCount,
          firstMentionTextOffset: character.firstMentionTextOffset
        },
        window,
        fragments: windowFragments,
        title,
        author,
        normalizedTextHash,
        inventoryVersion: inventory.inventoryVersion
      })
      const normalizedCard = normalizeCharacterCardRequest({
        idempotencyKey:
          `${runId}:character-card:${character.characterKey}:${cardRequest.promptVersion}`,
        ...cardRequest
      })
      const raw = await complete(characterCardMessages(normalizedCard))
      const shaped = normalizeCharacterCardResult(parseJson(raw), normalizedCard)
      const finalized = finalizeCharacterCard({
        input: cardRequest,
        result: shaped,
        fragments: windowFragments
      })
      cards.push({
        card: finalized.card,
        audit: finalized.audit,
        projection: characterCardProjection(finalized.card),
        // Координаты фрагментов нужны канарейке: она собирает из карточек
        // v3 и прогоняет настоящий Validate, а тот сверяет каждую цитату с
        // текстом по смещениям. Сами цитаты не дублируются — они и есть текст.
        fragments: windowFragments.map(({ fragmentId, startOffset, endOffset, chapterIndex }) =>
          ({ fragmentId, characterKey: character.characterKey, startOffset, endOffset, chapterIndex }))
      })
    } catch (error) {
      cardFailures.push({
        characterKey: character.characterKey,
        reason: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
        message: String(error?.message ?? '').slice(0, 300)
      })
    }
  }

  return {
    runId,
    bookEditionId,
    title,
    normalizedTextHash,
    textLength: text.length,
    chapterCount: chapters.length,
    inventory: {
      inventoryVersion: inventory.inventoryVersion,
      candidateCount: inventory.candidates.length,
      ...inventory.thresholds
    },
    significantTier: inventorySignificant(inventory).map(({ candidateKey, displayName, count }) =>
      ({ candidateKey, displayName, count })),
    confirmation: {
      candidateCount: request.roster.length,
      candidatePairCount: request.candidatePairs.length,
      forbiddenPairCount: request.forbiddenPairs.length,
      acceptedMergeCount: confirmation.acceptedMerges.length,
      rejectedCount: confirmation.rejected.length,
      rejected: confirmation.rejected.slice(0, 40),
      acceptedMerges: confirmation.acceptedMerges,
      kinds: Object.fromEntries(
        ['person', 'place', 'group', 'other'].map((kind) =>
          [kind, confirmation.classifications.filter((item) => item.kind === kind).length])
      )
    },
    // В форме, которую читает score-frozen-identity.mjs.
    roster: roster.map((character) => ({
      entityKey: character.characterKey,
      canonicalName: character.canonicalName,
      aliases: character.names,
      observationCount: character.mentionCount
    })),
    cards,
    cardFailures
  }
}

function parseArguments(argv) {
  const result = { maxCards: 0 }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--text') result.textPath = argv[++index]
    else if (value === '--title') result.title = argv[++index]
    else if (value === '--author') result.author = argv[++index]
    else if (value === '--out') result.outPath = argv[++index]
    else if (value === '--run-id') result.runId = argv[++index]
    else if (value === '--cards') result.maxCards = Number(argv[++index])
    else throw inputError(`unknown argument: ${value}`)
  }
  if (!result.textPath) throw inputError('--text is required')
  if (!result.title) throw inputError('--title is required')
  if (!result.outPath) throw inputError('--out is required')
  return result
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2))
  const complete = createModelClient()
  if (!complete) throw inputError('JUDGE_BASE_URL, JUDGE_API_KEY and JUDGE_MODEL are required')
  const text = await readFile(options.textPath, 'utf8')
  const started = Date.now()
  const report = await runCardPipeline({
    text,
    title: options.title,
    author: options.author ?? '',
    runId: options.runId,
    maxCards: options.maxCards,
    complete,
    onProgress: (event) => process.stderr.write(`  ${JSON.stringify(event)}\n`)
  })
  await writeFile(options.outPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stderr.write(`done in ${Math.round((Date.now() - started) / 1000)}s\n`)
  console.log(JSON.stringify({
    inventory: report.inventory,
    confirmation: report.confirmation,
    rosterCount: report.roster.length,
    cardCount: report.cards.length,
    cardFailures: report.cardFailures
  }, null, 2))
}
