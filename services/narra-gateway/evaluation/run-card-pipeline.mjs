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
import { bookCharacterAnalysisText } from '../analysis/book-paratext.mjs'
import {
  bookChapters,
  bookParagraphs
} from '../analysis/book-text-index.mjs'
import {
  buildBookCardWindows,
  cardWindowForOffset,
  cardWindowIndexForOffset
} from '../analysis/book-card-windows.mjs'
import {
  applyRosterConfirmation,
  buildRosterConfirmationRequest,
  rosterConfirmationIdempotencyKey,
  validateRosterConfirmation
} from '../analysis/book-roster-confirmation.mjs'
import {
  buildCharacterCardRequest,
  characterCardIdempotencyKey,
  finalizeCharacterCard
} from '../analysis/book-character-card.mjs'
import { characterCardProjection } from '../analysis/book-character-card-contract.mjs'
import { deferredCardFragmentTarget } from '../analysis/book-character-card-runner.mjs'
import { reconcileCardsByBioLead } from '../analysis/book-card-markup-projection.mjs'
import { MAX_PUBLISHED_BOOK_CHARACTERS } from '../books/book-character-selection.mjs'

/** Те же ошибки, после которых прод переносит карточку дальше по книге. */
const DEFERRABLE_CARD_ERRORS = new Set([
  'CARD_BIO_MISSING', 'CARD_TRAITS_MISSING', 'CARD_BIO_UNGROUNDED_NAME',
  'CARD_FRAGMENTS_MISSING', 'CARD_FRAGMENTS_THIN'
])
const PRE_MODEL_CARD_ERRORS = new Set(['CARD_FRAGMENTS_MISSING', 'CARD_FRAGMENTS_THIN'])
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

/**
 * Разбор потока целиком: не только текст, но и то, дошёл ли он до конца.
 *
 * Непустой `content` сам по себе успехом не является. Поток может оборваться
 * после первых дельт — тогда придёт обрезанный JSON вроде `{"classifications": [`
 * — или принести событие ошибки уже после начала ответа. И то и другое надо
 * повторять, а не отдавать вызывающему: разбор JSON идёт вне цикла повторов, и
 * обрезанный ответ роняет прогон вместо повторного запроса.
 *
 * Признак завершённости — `[DONE]` или `finish_reason` у выбора: провайдеры
 * шлют либо то, либо другое. Но не всякая причина завершения означает готовый
 * ответ: `length` — это упёрлись в лимит токенов, `content_filter` — обрубили
 * фильтром, и в обоих случаях приходит ровно тот же обрезанный JSON, что при
 * обрыве соединения, только с честным `[DONE]` в конце. Поэтому причина
 * сохраняется и проверяется: `[DONE]` сам по себе завершённости не доказывает.
 */
const COMPLETE_FINISH_REASONS = new Set(['stop', 'tool_calls', 'function_call'])

export function parseEventStream(text) {
  let content = ''
  let terminated = false
  let finishReason = null
  let error = null
  let events = 0
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (!data) continue
    events += 1
    if (data === '[DONE]') {
      terminated = true
      continue
    }
    let event = null
    try {
      event = JSON.parse(data)
    } catch {
      continue
    }
    if (event?.error) {
      error = typeof event.error === 'string'
        ? event.error
        : String(event.error.message ?? JSON.stringify(event.error)).slice(0, 300)
      continue
    }
    const choice = event?.choices?.[0]
    if (choice?.finish_reason) {
      terminated = true
      finishReason = String(choice.finish_reason)
    }
    const piece = choice?.delta?.content ?? choice?.message?.content
    if (typeof piece === 'string') content += piece
  }
  const done = terminated &&
    (finishReason === null || COMPLETE_FINISH_REASONS.has(finishReason))
  return { content, done, finishReason, error, events }
}

/** Только текст ответа. Полнота потока — у {@link parseEventStream}. */
export function contentFromEventStream(text) {
  return parseEventStream(text).content
}

/**
 * Клиент модели. `postJsonImpl` подменяется тестом: решение «вернуть или
 * повторить» принимается здесь, и проверять его надо здесь же, а не по разбору
 * потока в отрыве от цикла повторов.
 */
export function createModelClient(env = process.env, { postJsonImpl = postJson, model: modelOverride } = {}) {
  const baseUrl = String(env.JUDGE_BASE_URL || env.LITELLM_BASE_URL || '').replace(/\/$/, '')
  const apiKey = env.JUDGE_API_KEY || env.LITELLM_API_KEY
  const model = modelOverride || env.JUDGE_MODEL || env.LITELLM_MODEL
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
  // Прод температуру не передаёт (LLM_OMIT_TEMPERATURE): часть моделей её не
  // принимает, и стенд обязан спрашивать так же, как прод.
  const omitTemperature = String(env.MODEL_OMIT_TEMPERATURE ?? '0') === '1'
  // Лимит ответа, как LLM_MAX_TOKENS_STRUCTURED_TASK у прода: без него ответ
  // подтверждения состава на сотню кандидатов обрезается умолчанием провайдера.
  const maxTokens = Number(env.MODEL_MAX_TOKENS || 0)
  return async (messages) => {
    let lastError = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await postJsonImpl({
          url: `${baseUrl}/chat/completions`,
          apiKey,
          body: {
            model,
            messages,
            ...(omitTemperature ? {} : { temperature: 0 }),
            ...(maxTokens > 0 ? { max_tokens: maxTokens } : {}),
            ...(stream ? { stream: true } : {})
          },
          timeoutMs
        })
        if (response.status >= 200 && response.status < 300) {
          if (stream) {
            const parsed = parseEventStream(response.text)
            if (parsed.error) {
              throw Object.assign(
                new Error(`model stream reported an error: ${parsed.error}`),
                { code: 'MODEL_STREAM_ERROR' }
              )
            }
            // Ответ отдаётся только у дошедшего до конца потока. Оборванный
            // поток с непустым `content` — это обрезанный JSON, и повторить его
            // дешевле, чем уронить прогон на разборе. Причина завершения важна
            // не меньше самого завершения: `length` приходит вместе с `[DONE]`,
            // и ответ при этом всё равно обрезан.
            if (parsed.content && parsed.done) return parsed.content
            if (parsed.content) {
              throw Object.assign(
                new Error(parsed.finishReason
                  ? `model stopped before finishing: ${parsed.finishReason}`
                  : 'model stream ended without a completion marker'),
                { code: 'MODEL_STREAM_TRUNCATED', finishReason: parsed.finishReason }
              )
            }
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

/**
 * Секундомер по стадиям.
 *
 * Мерить конвейер нужно по двум разным вопросам, и оба про время: сколько ждёт
 * читатель, открывший книгу, прежде чем увидит героев первых глав, и сколько
 * идёт подготовка всей книги. Первый ответ складывается не из всего прогона, а
 * из инвентаря, фрагментов, подтверждения roster и карточек одного окна;
 * второй — из всего. Без длительностей по стадиям ни то, ни другое из отчёта не
 * достать, поэтому они пишутся в отчёт, а не в лог.
 */
function createStopwatch(now = () => Date.now()) {
  const stages = []
  return {
    async measure(stage, operation, extra = {}) {
      const startedAt = now()
      try {
        return await operation()
      } finally {
        stages.push({ stage, durationMs: now() - startedAt, ...extra })
      }
    },
    stages
  }
}

/**
 * Навигация из оглавления каталога.
 *
 * Оглавление отдаёт границы в **байтах** utf-8, а весь позиционный индекс книги
 * живёт в code units utf-16 — тех же, что у evidence-смещений. Перепутать эти
 * единицы значит сдвинуть все главы на длину кириллицы, поэтому пересчёт явный:
 * длина префикса в utf-16 по его длине в байтах.
 */
export function navigationFromToc(toc, text) {
  const items = (toc?.items ?? [])
    .filter((item) => Number.isSafeInteger(item?.start_byte))
    .sort((left, right) => left.start_byte - right.start_byte)
  if (items.length < 2) return null
  const bytes = Buffer.from(text, 'utf8')
  const utf16At = (byteOffset) =>
    bytes.subarray(0, Math.min(byteOffset, bytes.length)).toString('utf8').length
  const segments = items.map((item, index) => ({
    key: String(item.key ?? `segment:${index + 1}`),
    title: String(item.title ?? ''),
    startOffset: utf16At(item.start_byte),
    endOffset: Number.isSafeInteger(item.end_byte_exclusive)
      ? utf16At(item.end_byte_exclusive)
      : text.length
  })).filter((segment) => segment.endOffset > segment.startOffset)
  return segments.length >= 2 ? { segments } : null
}

export async function runCardPipeline({
  text,
  title,
  author = '',
  runId = randomUUID(),
  bookEditionId = randomUUID(),
  maxCards = 0,
  cardConcurrency = 1,
  navigation = null,
  complete,
  // У подтверждения состава в проде своя модель (purpose roster_confirm), и
  // стенд на лёгкой модели карточек мерил бы не тот состав.
  completeRoster = complete,
  onProgress = () => {},
  now = () => Date.now()
}) {
  if (!text) throw inputError('text is required')
  const stopwatch = createStopwatch(now)
  const startedAt = now()
  const normalizedTextHash = sha256(Buffer.from(text, 'utf8'))
  // Навигация меняет не удобство, а сам предмет измерения: без неё главы
  // становятся синтетическими окнами по 30 000 символов, и «первые две главы»
  // превращаются в кусок, которого в книге нет. В продакшене навигация есть
  // всегда, поэтому и здесь она подаётся, когда доступна.
  const { paragraphs, chapters } = await stopwatch.measure('index', async () => {
    const indexed = bookParagraphs(text)
    return {
      paragraphs: indexed,
      chapters: bookChapters(text, { navigation, paragraphs: indexed })
    }
  })

  onProgress({ stage: 'inventory' })
  // Та же маска служебного текста, что в Prepare: без неё стенд мерил бы
  // инвентарь, которого в продакшене нет.
  const characterText = bookCharacterAnalysisText(text, { navigation }).text
  const { inventory, candidates } = await stopwatch.measure('inventory', async () => {
    const built = buildBookNameInventory({ text: characterText, navigation, normalizedTextHash })
    return { inventory: built, candidates: inventoryRoster(built) }
  })

  onProgress({ stage: 'fragments', count: candidates.length })
  const fragments = await stopwatch.measure('fragments', async () => collectBookCharacterFragments({
    text: characterText,
    navigation,
    characters: candidates.map((candidate) => ({
      characterKey: candidate.candidateKey,
      names: [
        candidate.displayName,
        ...candidate.aliases,
        ...(candidate.fullName ? [candidate.fullName] : [])
      ],
      ...(candidate.epithet ? { epithetForms: candidate.epithetForms } : {})
    })),
    // Собираем щедро: окно карточки вырезается ниже, и при скупом лимите в
    // окно первых глав попадал один абзац на персонажа — карточка строилась
    // фактически по одной цитате. В продакшене этой проблемы нет: там
    // фрагменты лежат в базе целиком, а окно отбирает их запросом.
    maxFragmentsPerCharacter: 4_000
  }))

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
    idempotencyKey: rosterConfirmationIdempotencyKey({
      runId,
      windowIndex: request.windowIndex,
      inventoryVersion: request.inventoryVersion,
      promptVersion: request.promptVersion
    }),
    ...request
  })
  const { confirmation, roster } = await stopwatch.measure(
    'roster_confirm',
    async () => {
      const rosterRaw = await completeRoster(rosterConfirmationMessages(normalizedRequest))
      const rosterShape = normalizeRosterConfirmationResult(parseJson(rosterRaw), normalizedRequest)
      const validated = validateRosterConfirmation({ request, response: rosterShape })
      return {
        confirmation: validated,
        roster: applyRosterConfirmation({ request, candidates, confirmation: validated, fragments })
      }
    },
    { candidateCount: request.roster.length, pairCount: request.candidatePairs.length }
  )

  onProgress({ stage: 'cards', count: roster.length })
  const cardWindows = buildBookCardWindows({ chapters })
  const byKey = new Map(fragments.characters.map((entry) => [entry.characterKey, entry]))
  const ordered = [...roster].sort((left, right) => right.mentionCount - left.mentionCount)
  const selected = maxCards > 0 ? ordered.slice(0, maxCards) : ordered
  const cards = []
  const cardFailures = []
  // Карточки независимы, и прод собирает их параллельно; последовательный
  // стенд на книге в сотню героев с переносами шёл бы часами.
  const buildCard = async (index, character) => {
    onProgress({ stage: 'card', index: index + 1, total: selected.length, name: character.canonicalName })
    const allFragments = character.candidateKeys
      .flatMap((key) => byKey.get(key)?.fragments ?? [])
      // Фрагменты слитых кандидатов теперь принадлежат одному персонажу.
      .map((fragment) => ({ ...fragment, characterKey: character.characterKey }))
      .sort((left, right) => left.startOffset - right.startOffset)
    const fragmentsUpTo = (window) => allFragments.filter((fragment) =>
      fragment.startOffset >= window.startOffset && fragment.endOffset <= window.endOffset)
    let window = cardWindowForOffset(chapters, character.firstMentionTextOffset)
    let windowIndex = cardWindowIndexForOffset(cardWindows.windows, chapters, character.firstMentionTextOffset)
    const cardStartedAt = now()
    const attempts = []
    let built = null
    // Тот же перенос, что в проде: карточку, которой здесь нечем обосноваться,
    // собирают в окне дальше по книге, где цитат больше.
    for (;;) {
      const windowFragments = fragmentsUpTo(window)
      try {
        if (!windowFragments.length) {
          throw Object.assign(new Error('no fragments in window'), { code: 'CARD_FRAGMENTS_MISSING' })
        }
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
          idempotencyKey: characterCardIdempotencyKey(cardRequest),
          ...cardRequest
        })
        const raw = await complete(characterCardMessages(normalizedCard))
        const shaped = normalizeCharacterCardResult(parseJson(raw), normalizedCard)
        const finalized = finalizeCharacterCard({
          input: cardRequest,
          result: shaped,
          fragments: windowFragments
        })
        built = { finalized, windowFragments }
        break
      } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN'
        attempts.push({ windowIndex, code, fragmentCount: windowFragments.length })
        if (!DEFERRABLE_CARD_ERRORS.has(code)) break
        const target = deferredCardFragmentTarget(code, windowFragments.length)
        const later = cardWindows.windows
          .filter((item) => item.windowIndex > windowIndex)
          .map((item) => ({ item, count: fragmentsUpTo(item).length }))
          .filter(({ count }) => count > windowFragments.length)
        const next = later.find(({ count }) => count >= target) ??
          (PRE_MODEL_CARD_ERRORS.has(code) ? null : later[later.length - 1])
        if (!next) break
        window = { startOffset: next.item.startOffset, endOffset: next.item.endOffset, chapterIndexes: next.item.chapterIndexes }
        windowIndex = next.item.windowIndex
      }
    }
    if (!built) {
      const last = attempts[attempts.length - 1]
      cardFailures.push({
        characterKey: character.characterKey,
        name: character.canonicalName,
        reason: last?.code ?? 'UNKNOWN',
        attempts,
        durationMs: now() - cardStartedAt
      })
      return
    }
    const { finalized, windowFragments } = built
    cards.push({
      card: finalized.card,
      audit: finalized.audit,
      // Длительность и окно на каждую карточку: из них считается и время до
      // первых героев, и время всей книги.
      durationMs: now() - cardStartedAt,
      windowIndex,
      deferrals: attempts.length,
      projection: characterCardProjection(finalized.card),
      // Координаты фрагментов нужны канарейке: она собирает из карточек
      // v3 и прогоняет настоящий Validate, а тот сверяет каждую цитату с
      // текстом по смещениям. Сами цитаты не дублируются — они и есть текст.
      fragments: windowFragments.map(({ fragmentId, startOffset, endOffset, chapterIndex }) =>
        ({ fragmentId, characterKey: character.characterKey, startOffset, endOffset, chapterIndex }))
    })
  }
  let cursor = 0
  await Promise.all(Array.from({ length: Math.max(1, cardConcurrency) }, async () => {
    while (cursor < selected.length) {
      const index = cursor++
      await buildCard(index, selected[index])
    }
  }))

  // То, что увидит читатель: сверка карточек по биографиям и двадцать самых
  // упоминаемых, как при публикации.
  const reconciled = reconcileCardsByBioLead({
    cards: cards.map(({ card }) => ({ ...card, aliases: [...(card.aliases ?? [])] })),
    fragmentsByCharacter: new Map(cards.map(({ card, fragments: cited }) => [card.characterKey, cited]))
  })
  const published = [...reconciled.cards]
    .sort((left, right) => (right.mentionCount ?? 0) - (left.mentionCount ?? 0))
    .slice(0, MAX_PUBLISHED_BOOK_CHARACTERS)
    .map((card) => ({
      characterKey: card.characterKey,
      name: card.name,
      mentionCount: card.mentionCount,
      traits: card.traits.map(({ value }) => value),
      bio: card.bio?.value ?? ''
    }))

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
    cardWindowCount: cardWindows.windows.length,
    timings: {
      totalMs: now() - startedAt,
      stages: stopwatch.stages
    },
    cards,
    cardFailures,
    merges: reconciled.merges,
    renames: reconciled.renames,
    published
  }
}

function parseArguments(argv) {
  const result = { maxCards: 0 }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--text') result.textPath = argv[++index]
    else if (value === '--toc') result.tocPath = argv[++index]
    else if (value === '--title') result.title = argv[++index]
    else if (value === '--author') result.author = argv[++index]
    else if (value === '--out') result.outPath = argv[++index]
    else if (value === '--run-id') result.runId = argv[++index]
    else if (value === '--cards') result.maxCards = Number(argv[++index])
    else if (value === '--navigation') result.navigationPath = argv[++index]
    else if (value === '--concurrency') result.cardConcurrency = Number(argv[++index])
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
  const completeRoster = process.env.JUDGE_ROSTER_MODEL
    ? createModelClient(process.env, { model: process.env.JUDGE_ROSTER_MODEL })
    : complete
  const text = await readFile(options.textPath, 'utf8')
  const navigation = options.navigationPath
    ? JSON.parse(await readFile(options.navigationPath, 'utf8'))
    : options.tocPath
      ? navigationFromToc(JSON.parse(await readFile(options.tocPath, 'utf8')), text)
      : null
  const started = Date.now()
  const report = await runCardPipeline({
    text,
    title: options.title,
    author: options.author ?? '',
    runId: options.runId,
    maxCards: options.maxCards,
    cardConcurrency: options.cardConcurrency ?? 1,
    navigation,
    complete,
    completeRoster,
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
