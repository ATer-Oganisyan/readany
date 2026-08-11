import path from 'node:path'
import { spawn } from 'node:child_process'
import { strFromU8, unzipSync } from 'fflate'

const MAX_EXTRACTED_BYTES = 64 * 1024 * 1024
const EPUB_TEXT_ENTRY = /\.(?:xhtml?|html?)$/i

function generationError(code, message) {
  return Object.assign(new Error(message), { code })
}

function decodeEntities(value) {
  const named = new Map([
    ['amp', '&'], ['apos', "'"], ['gt', '>'], ['lt', '<'], ['nbsp', ' '], ['quot', '"']
  ])
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hexadecimal = entity[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      if (Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        try { return String.fromCodePoint(codePoint) } catch { return match }
      }
    }
    return named.get(entity.toLowerCase()) ?? match
  })
}

function markupToText(markup) {
  return decodeEntities(String(markup)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseAttributes(fragment) {
  const result = {}
  for (const match of fragment.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    result[match[1].toLowerCase()] = decodeEntities(match[3])
  }
  return result
}

function safeZipPath(base, relative) {
  const decoded = (() => {
    try { return decodeURIComponent(relative) } catch { return relative }
  })()
  const resolved = path.posix.normalize(path.posix.join(base, decoded)).replace(/^\.\//, '')
  if (!resolved || resolved.startsWith('../') || path.posix.isAbsolute(resolved)) {
    throw generationError('BOOK_PARSE_FAILED', 'EPUB contains an unsafe content path')
  }
  return resolved
}

function epubText(bytes) {
  let entries
  try {
    entries = unzipSync(new Uint8Array(bytes), {
      filter(file) {
        return /(?:^|\/)(?:container\.xml|[^/]+\.opf)$/i.test(file.name) || EPUB_TEXT_ENTRY.test(file.name)
      }
    })
  } catch (error) {
    throw generationError('BOOK_PARSE_FAILED', `EPUB archive could not be read: ${error.message}`)
  }
  const entryNames = Object.keys(entries)
  const expandedBytes = entryNames.reduce((sum, name) => sum + entries[name].byteLength, 0)
  if (expandedBytes > MAX_EXTRACTED_BYTES) {
    throw generationError('BOOK_TOO_LARGE', 'EPUB expanded text exceeds 64 MiB')
  }
  const byLowerName = new Map(entryNames.map((name) => [name.toLowerCase(), name]))
  const readEntry = (name) => {
    const actual = byLowerName.get(name.toLowerCase())
    return actual ? strFromU8(entries[actual]) : ''
  }
  const container = readEntry('META-INF/container.xml')
  const rootfile = parseAttributes(container.match(/<rootfile\b([^>]*)>/i)?.[1] || '')['full-path']
  const opfName = rootfile
    ? byLowerName.get(rootfile.toLowerCase())
    : entryNames.find((name) => /\.opf$/i.test(name))
  const orderedNames = []
  if (opfName) {
    const opf = strFromU8(entries[opfName])
    const manifest = new Map()
    for (const match of opf.matchAll(/<item\b([^>]*)\/?\s*>/gi)) {
      const attributes = parseAttributes(match[1])
      if (attributes.id && attributes.href) manifest.set(attributes.id, attributes.href)
    }
    const base = path.posix.dirname(opfName)
    for (const match of opf.matchAll(/<itemref\b([^>]*)\/?\s*>/gi)) {
      const idref = parseAttributes(match[1]).idref
      const href = manifest.get(idref)
      if (!href) continue
      const name = safeZipPath(base, href.split('#')[0])
      const actual = byLowerName.get(name.toLowerCase())
      if (actual && EPUB_TEXT_ENTRY.test(actual) && !orderedNames.includes(actual)) orderedNames.push(actual)
    }
  }
  if (!orderedNames.length) {
    orderedNames.push(...entryNames.filter((name) => EPUB_TEXT_ENTRY.test(name)).sort())
  }
  const text = orderedNames.map((name) => markupToText(strFromU8(entries[name]))).filter(Boolean).join('\n\n')
  if (!text) throw generationError('BOOK_PARSE_FAILED', 'EPUB contains no readable text')
  return text
}

function processOutput(command, args, input, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const output = []
    const errors = []
    let outputBytes = 0
    const abort = () => child.kill('SIGKILL')
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.byteLength
      if (outputBytes > MAX_EXTRACTED_BYTES) return child.kill('SIGKILL')
      output.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      if (errors.reduce((sum, item) => sum + item.byteLength, 0) < 8_192) errors.push(chunk)
    })
    child.on('error', (error) => reject(generationError('BOOK_PARSE_FAILED', `${command} is unavailable: ${error.message}`)))
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) return reject(signal.reason || generationError('CANCELLED', 'book extraction cancelled'))
      if (outputBytes > MAX_EXTRACTED_BYTES) return reject(generationError('BOOK_TOO_LARGE', 'extracted text exceeds 64 MiB'))
      if (code !== 0) {
        return reject(generationError('BOOK_PARSE_FAILED', `${command} failed: ${Buffer.concat(errors).toString('utf8').slice(0, 300)}`))
      }
      resolve(Buffer.concat(output).toString('utf8'))
    })
    child.stdin.end(input)
  })
}

export async function extractBookText({ bytes: rawBytes, format, mimeType, signal }) {
  const bytes = Buffer.from(rawBytes)
  if (!bytes.byteLength) throw generationError('BOOK_PARSE_FAILED', 'book source is empty')
  const normalizedFormat = String(format || '').toLowerCase()
  const normalizedMime = String(mimeType || '').split(';')[0].trim().toLowerCase()
  let text
  if (normalizedFormat === 'epub' || normalizedMime === 'application/epub+zip') {
    text = epubText(bytes)
  } else if (normalizedFormat === 'pdf' || normalizedMime === 'application/pdf') {
    text = (await processOutput('pdftotext', ['-enc', 'UTF-8', '-', '-'], bytes, signal)).trim()
  } else if (normalizedFormat === 'fb2' || /(?:xml|fb2)/.test(normalizedMime)) {
    text = markupToText(bytes.toString('utf8'))
  } else if (normalizedFormat === 'txt' || normalizedMime.startsWith('text/')) {
    text = bytes.toString('utf8').replace(/\r/g, '').trim()
  } else {
    throw generationError('BOOK_FORMAT_UNSUPPORTED', `unsupported book format: ${normalizedFormat || normalizedMime}`)
  }
  if (!text) throw generationError('BOOK_PARSE_FAILED', 'book contains no readable text')
  if (Buffer.byteLength(text, 'utf8') > MAX_EXTRACTED_BYTES) {
    throw generationError('BOOK_TOO_LARGE', 'extracted text exceeds 64 MiB')
  }
  return text
}

export function representativeTextSelection(text, maxChars = 42_000) {
  if (text.length <= maxChars) {
    return {
      sample: text,
      chunks: [{ section: 'whole', start: 0, end: text.length, text }]
    }
  }
  const first = Math.floor(maxChars * 0.52)
  const middle = Math.floor(maxChars * 0.24)
  const last = maxChars - first - middle
  const middleStart = Math.max(first, Math.floor((text.length - middle) / 2))
  const chunks = [
    { section: 'beginning', start: 0, end: first, text: text.slice(0, first) },
    {
      section: 'middle',
      start: middleStart,
      end: middleStart + middle,
      text: text.slice(middleStart, middleStart + middle)
    },
    { section: 'ending', start: text.length - last, end: text.length, text: text.slice(-last) }
  ]
  return {
    sample: [
      chunks[0].text,
      '\n\n[ФРАГМЕНТ ИЗ СЕРЕДИНЫ КНИГИ]\n\n',
      chunks[1].text,
      '\n\n[ФРАГМЕНТ ИЗ КОНЦА КНИГИ]\n\n',
      chunks[2].text
    ].join(''),
    chunks
  }
}

export function representativeTextSample(text, maxChars = 42_000) {
  return representativeTextSelection(text, maxChars).sample
}
