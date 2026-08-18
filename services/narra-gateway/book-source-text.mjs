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

function sectionTitle(markup, fallback) {
  const heading = String(markup).match(/<(?:h1|h2|title)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|title)>/i)?.[1]
  const normalized = heading ? markupToText(heading) : ''
  return (normalized || fallback || '').slice(0, 500)
}

function joinStructuredSections(rawSections) {
  const textParts = []
  const sections = []
  let offset = 0
  const readable = rawSections
    .map((section, sourceIndex) => ({ ...section, sourceIndex }))
    .filter((section) => section.text)
  for (const [index, section] of readable.entries()) {
    const startOffset = offset
    textParts.push(section.text)
    offset += section.text.length
    if (index < readable.length - 1) {
      textParts.push('\n\n')
      offset += 2
    }
    sections.push({
      key: section.key,
      title: section.title || '',
      sourceIndex: section.sourceIndex,
      startOffset,
      endOffset: offset
    })
  }
  return { text: textParts.join(''), sections }
}

function wholeDocument(text, key = 'document', title = '') {
  return {
    text,
    sections: [{ key, title, startOffset: 0, endOffset: text.length }]
  }
}

function sectionsFromOffsets(text, candidates, prefix) {
  const byOffset = new Map()
  for (const candidate of candidates) {
    if (
      Number.isSafeInteger(candidate.startOffset) &&
      candidate.startOffset > 0 &&
      candidate.startOffset < text.length &&
      !byOffset.has(candidate.startOffset)
    ) {
      byOffset.set(candidate.startOffset, String(candidate.title || '').trim().slice(0, 500))
    }
  }
  const starts = [0, ...byOffset.keys()].sort((left, right) => left - right)
  return starts.map((startOffset, index) => ({
    key: `${prefix}:${index + 1}`,
    title: byOffset.get(startOffset) || (index === 0 && starts.length > 1 ? 'Начало' : ''),
    startOffset,
    endOffset: starts[index + 1] ?? text.length
  }))
}

function headingSections(text, prefix) {
  const candidates = []
  const heading = /^(?:(?:глава|часть|книга|chapter|part|book)(?:\s+[\p{L}\p{N}IVXLCDMivxlcdm._\[\]-]+(?:[.:\]\s—-].*)?|[.:\]]?)|(?:предисловие|введение|пролог|эпилог|preface|foreword|introduction|prologue|epilogue)\s*[.:\]]?)$/gimu
  for (const match of text.matchAll(heading)) {
    candidates.push({ startOffset: match.index, title: match[0] })
  }
  return sectionsFromOffsets(text, candidates, prefix)
}

function pdfSections(text) {
  const candidates = []
  for (const match of text.matchAll(/\f+/g)) {
    const startOffset = match.index + match[0].length
    if (startOffset < text.length) {
      candidates.push({ startOffset, title: `Страница ${candidates.length + 2}` })
    }
  }
  return sectionsFromOffsets(text, candidates, 'pdf-page')
}

function epubStructuredText(bytes) {
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
  const result = joinStructuredSections(orderedNames.map((name) => {
    const markup = strFromU8(entries[name])
    return {
      key: `epub:${name}`,
      title: sectionTitle(markup, path.posix.basename(name, path.posix.extname(name))),
      text: markupToText(markup)
    }
  }))
  if (!result.text) throw generationError('BOOK_PARSE_FAILED', 'EPUB contains no readable text')
  return result
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

export async function extractStructuredBookText({ bytes: rawBytes, format, mimeType, signal }) {
  const bytes = Buffer.from(rawBytes)
  if (!bytes.byteLength) throw generationError('BOOK_PARSE_FAILED', 'book source is empty')
  const normalizedFormat = String(format || '').toLowerCase()
  const normalizedMime = String(mimeType || '').split(';')[0].trim().toLowerCase()
  let result
  if (normalizedFormat === 'epub' || normalizedMime === 'application/epub+zip') {
    result = epubStructuredText(bytes)
  } else if (normalizedFormat === 'pdf' || normalizedMime === 'application/pdf') {
    const text = (await processOutput('pdftotext', ['-enc', 'UTF-8', '-', '-'], bytes, signal)).trim()
    result = { text, sections: pdfSections(text) }
  } else if (normalizedFormat === 'fb2' || /(?:xml|fb2)/.test(normalizedMime)) {
    const markup = bytes.toString('utf8')
    const text = markupToText(markup)
    const sections = headingSections(text, 'fb2-section')
    result = {
      text,
      sections: sections.length > 1
        ? sections
        : wholeDocument(text, 'fb2:document', sectionTitle(markup, '')).sections
    }
  } else if (normalizedFormat === 'txt' || normalizedMime.startsWith('text/')) {
    const text = bytes.toString('utf8').replace(/\r/g, '').trim()
    const sections = headingSections(text, 'text-section')
    result = {
      text,
      sections: sections.length > 1 ? sections : wholeDocument(text, 'text:document').sections
    }
  } else {
    throw generationError('BOOK_FORMAT_UNSUPPORTED', `unsupported book format: ${normalizedFormat || normalizedMime}`)
  }
  if (!result.text) throw generationError('BOOK_PARSE_FAILED', 'book contains no readable text')
  if (Buffer.byteLength(result.text, 'utf8') > MAX_EXTRACTED_BYTES) {
    throw generationError('BOOK_TOO_LARGE', 'extracted text exceeds 64 MiB')
  }
  return {
    text: result.text,
    textLength: result.text.length,
    sections: result.sections
  }
}

export async function extractBookText(input) {
  return (await extractStructuredBookText(input)).text
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
