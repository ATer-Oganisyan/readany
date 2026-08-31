import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const manifestPath = path.join(directory, 'books.json')

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalizeGutenbergText(value) {
  const text = String(value).replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const start = lines.findIndex((line) =>
    /^\*\*\* START OF THE PROJECT GUTENBERG EBOOK\b/.test(line)
  )
  const end = lines.findIndex((line, index) =>
    index > start && /^\*\*\* END OF THE PROJECT GUTENBERG EBOOK\b/.test(line)
  )
  if (start < 0 || end <= start) {
    throw new Error('Project Gutenberg body markers were not found')
  }
  return `${lines.slice(start + 1, end).join('\n').trim()}\n`
}

export async function fetchEvaluationBooks({
  outputDirectory,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  const configured = JSON.parse(await readFile(manifestPath, 'utf8'))
  await mkdir(outputDirectory, { recursive: true })
  const results = []

  for (const book of configured.books) {
    const response = await fetchImpl(book.sourceUrl, {
      headers: { 'user-agent': 'Narra book markup evaluation/1' }
    })
    if (!response.ok) throw new Error(`${book.id}: source returned HTTP ${response.status}`)
    const rawBytes = Buffer.from(await response.arrayBuffer())
    const rawHash = sha256(rawBytes)
    if (rawHash !== book.rawSha256) {
      throw new Error(`${book.id}: raw SHA-256 changed (${rawHash})`)
    }
    const sourceText = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes)
    const canonicalText = canonicalizeGutenbergText(sourceText)
    const canonicalBytes = Buffer.from(canonicalText, 'utf8')
    const canonicalHash = sha256(canonicalBytes)
    if (
      canonicalHash !== book.canonicalSha256 ||
      canonicalBytes.byteLength !== book.canonicalBytes ||
      canonicalText.length !== book.canonicalChars
    ) {
      throw new Error(`${book.id}: canonical text does not match frozen manifest`)
    }
    const filename = `${book.id}.txt`
    await writeFile(path.join(outputDirectory, filename), canonicalBytes)
    results.push({
      id: book.id,
      filename,
      sha256: canonicalHash,
      byteSize: canonicalBytes.byteLength,
      textChars: canonicalText.length
    })
  }

  await writeFile(
    path.join(outputDirectory, 'manifest.json'),
    `${JSON.stringify({ version: configured.version, books: results }, null, 2)}\n`
  )
  return results
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputDirectory = path.resolve(
    process.env.NARRA_BOOK_EVAL_DIR || path.join(os.tmpdir(), 'narra-book-evaluation')
  )
  const results = await fetchEvaluationBooks({ outputDirectory })
  console.log(JSON.stringify({ outputDirectory, books: results }, null, 2))
}
