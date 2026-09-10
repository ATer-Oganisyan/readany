/**
 * Тексты книг для frozen identity fixtures.
 *
 * `fetch-books.mjs` тянет четыре книги стадийного плана и падает при любом
 * расхождении хэша. Здесь задача другая: получить текст под каждую фикстуру
 * идентичности, включая те, что в том манифесте не описаны, и явно сообщить,
 * совпал ли текст с зафиксированным в фикстуре. Расхождение не роняет прогон,
 * а попадает в отчёт: Gutenberg периодически перегенерирует файлы, и метрика
 * уровня roster от смены байта не меняется, но знать об этом нужно.
 *
 * Русские фикстуры каталога текста здесь не получают: их нормализованный текст
 * живёт в MinIO рядом с run'ом, а не в открытом источнике.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalizeGutenbergText } from './fetch-books.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))

/**
 * Источник текста на фикстуру. `gutenbergId` берётся из самой фикстуры, где он
 * есть; здесь остаются только те, где источник в фикстуре не записан, и
 * фрагментные наборы, у которых текст не Gutenberg.
 */
export const IDENTITY_BOOK_SOURCES = Object.freeze({
  'alice-wonderland-pdnc-v1': { kind: 'gutenberg', gutenbergId: 11 },
  'anne-green-gables-pdnc-v1': { kind: 'gutenberg' },
  'dorian-gray-pdnc-v1': { kind: 'gutenberg' },
  'invisible-man-pdnc-v1': { kind: 'gutenberg' },
  'pride-prejudice-bookcoref-v1': { kind: 'gutenberg' },
  'sense-sensibility-pdnc-v1': { kind: 'gutenberg' },
  'siddhartha-bookcoref-v1': { kind: 'gutenberg' },
  'little-women-litbank-chapter-one-v1': {
    kind: 'raw',
    url: 'https://raw.githubusercontent.com/dbamman/litbank/master/coref/brat/514_little_women_brat.txt'
  },
  'deti-kapitana-granta-ru-v1': { kind: 'catalog' },
  'evgeniy-onegin-ru-v1': { kind: 'catalog' }
})

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function defaultIdentityBookDirectory(env = process.env) {
  return path.resolve(
    env.NARRA_IDENTITY_BOOK_DIR ||
    env.NARRA_BOOK_EVAL_DIR ||
    path.join(os.tmpdir(), 'narra-identity-books')
  )
}

export async function listIdentityFixturePaths() {
  const { readdir } = await import('node:fs/promises')
  const names = await readdir(path.join(directory, 'identity'))
  return names
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(directory, 'identity', name))
}

function pinnedTextHash(source) {
  return source?.canonicalTextSha256 || source?.textSha256 || ''
}

/**
 * Текст под фикстуру: из кэша каталога, иначе из источника. Возвращает статус
 * `cached|fetched|unavailable` и совпадение с зафиксированным хэшом.
 */
export async function loadIdentityBookText({
  fixture,
  outputDirectory,
  fetchImpl = globalThis.fetch,
  allowFetch = true
}) {
  const id = String(fixture?.id || '')
  const configured = IDENTITY_BOOK_SOURCES[id]
  if (!configured) return { id, status: 'unavailable', reason: 'no_configured_source' }
  if (configured.kind === 'catalog') {
    return { id, status: 'unavailable', reason: 'catalog_text_not_public' }
  }
  const pinned = pinnedTextHash(fixture.source ?? {})
  const cachePath = path.join(outputDirectory, `${id}.txt`)
  try {
    const cached = await readFile(cachePath, 'utf8')
    return {
      id,
      status: 'cached',
      text: cached,
      textHash: sha256(Buffer.from(cached, 'utf8')),
      pinnedTextHash: pinned,
      path: cachePath
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (!allowFetch) return { id, status: 'unavailable', reason: 'not_cached' }

  const gutenbergId = configured.gutenbergId ?? fixture.source?.gutenbergId
  const url = configured.kind === 'raw'
    ? configured.url
    : `https://www.gutenberg.org/cache/epub/${gutenbergId}/pg${gutenbergId}.txt`
  if (!url || (configured.kind === 'gutenberg' && !gutenbergId)) {
    return { id, status: 'unavailable', reason: 'no_source_url' }
  }
  const response = await fetchImpl(url, {
    headers: { 'user-agent': 'Narra book markup evaluation/1' }
  })
  if (!response.ok) {
    return { id, status: 'unavailable', reason: `http_${response.status}` }
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const text = configured.kind === 'gutenberg'
    ? canonicalizeGutenbergText(decoded)
    : decoded.replace(/\r\n?/g, '\n')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(cachePath, text, 'utf8')
  return {
    id,
    status: 'fetched',
    text,
    textHash: sha256(Buffer.from(text, 'utf8')),
    pinnedTextHash: pinned,
    path: cachePath
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputDirectory = defaultIdentityBookDirectory()
  const results = []
  for (const fixturePath of await listIdentityFixturePaths()) {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
    const loaded = await loadIdentityBookText({ fixture, outputDirectory })
    results.push({
      id: loaded.id,
      status: loaded.status,
      reason: loaded.reason ?? null,
      chars: loaded.text?.length ?? 0,
      textHash: loaded.textHash ?? null,
      pinnedTextHash: loaded.pinnedTextHash || null,
      matchesPinnedHash: loaded.pinnedTextHash
        ? loaded.pinnedTextHash === loaded.textHash
        : null
    })
  }
  console.log(JSON.stringify({ outputDirectory, books: results }, null, 2))
}
