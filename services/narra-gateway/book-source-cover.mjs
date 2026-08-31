import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'

const MAX_COVER_BYTES = 24 * 1024 * 1024
const MAX_EPUB_METADATA_BYTES = 2 * 1024 * 1024

function decodeEntities(value) {
  const named = new Map([
    ['amp', '&'], ['apos', "'"], ['gt', '>'], ['lt', '<'], ['quot', '"']
  ])
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
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

function parseAttributes(fragment) {
  const result = {}
  for (const match of String(fragment || '').matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    result[match[1].toLowerCase()] = decodeEntities(match[3])
  }
  return result
}

function safeZipPath(base, relative) {
  const decoded = (() => {
    try { return decodeURIComponent(relative) } catch { return relative }
  })()
  const resolved = path.posix.normalize(path.posix.join(base, decoded)).replace(/^\.\//, '')
  if (!resolved || resolved.startsWith('../') || path.posix.isAbsolute(resolved)) return null
  return resolved
}

function imageMimeType(bytes, declaredMimeType = '') {
  const value = Buffer.from(bytes)
  if (
    value.byteLength >= 8 &&
    value[0] === 0x89 && value[1] === 0x50 && value[2] === 0x4e && value[3] === 0x47 &&
    value[4] === 0x0d && value[5] === 0x0a && value[6] === 0x1a && value[7] === 0x0a
  ) return 'image/png'
  if (value.byteLength >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    value.byteLength >= 12 && value.subarray(0, 4).toString('ascii') === 'RIFF' &&
    value.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp'
  const declared = String(declaredMimeType || '').toLowerCase()
  if (declared === 'image/jpg') return 'image/jpeg'
  return null
}

function boundedZipEntry(file, maxBytes) {
  const size = Number(file.originalSize ?? file.size)
  return Number.isFinite(size) && size >= 0 && size <= maxBytes
}

function unzipMetadata(bytes) {
  const entries = unzipSync(new Uint8Array(bytes), {
    filter(file) {
      return (
        /(?:^|\/)container\.xml$/i.test(file.name) || /\.opf$/i.test(file.name)
      ) && boundedZipEntry(file, MAX_EPUB_METADATA_BYTES)
    }
  })
  const total = Object.values(entries).reduce((sum, value) => sum + value.byteLength, 0)
  if (total > MAX_EPUB_METADATA_BYTES) return null
  return entries
}

function findEpubCover(opf) {
  const manifest = []
  for (const match of opf.matchAll(/<item\b([^>]*)\/?\s*>/gi)) {
    const attributes = parseAttributes(match[1])
    if (!attributes.href) continue
    manifest.push({
      id: attributes.id || '',
      href: attributes.href,
      mimeType: attributes['media-type'] || '',
      properties: attributes.properties || ''
    })
  }
  const explicit = manifest.find(({ properties }) => /(?:^|\s)cover-image(?:\s|$)/i.test(properties))
  if (explicit) return explicit

  let coverId = ''
  for (const match of opf.matchAll(/<meta\b([^>]*)\/?\s*>/gi)) {
    const attributes = parseAttributes(match[1])
    if (String(attributes.name || '').toLowerCase() === 'cover') {
      coverId = attributes.content || ''
      break
    }
  }
  if (coverId) {
    const referenced = manifest.find(({ id }) => id === coverId)
    if (referenced) return referenced
  }

  return manifest.find(({ id, href, mimeType }) =>
    /^image\/(?:jpeg|png|webp)$/i.test(mimeType) && (
      /cover/i.test(id) || /(?:^|[/_.-])cover(?:[/_.-]|$)/i.test(href)
    )
  ) ?? null
}

function extractEpubCover(bytes) {
  let metadata
  try {
    metadata = unzipMetadata(bytes)
  } catch {
    return null
  }
  if (!metadata) return null
  const names = Object.keys(metadata)
  const byLowerName = new Map(names.map((name) => [name.toLowerCase(), name]))
  const readText = (name) => {
    const actual = byLowerName.get(String(name).toLowerCase())
    return actual ? strFromU8(metadata[actual]) : ''
  }
  const container = readText('META-INF/container.xml')
  const rootfile = parseAttributes(container.match(/<rootfile\b([^>]*)>/i)?.[1])['full-path']
  const opfName = rootfile
    ? byLowerName.get(rootfile.toLowerCase())
    : names.find((name) => /\.opf$/i.test(name))
  if (!opfName) return null
  const cover = findEpubCover(strFromU8(metadata[opfName]))
  if (!cover) return null
  const coverPath = safeZipPath(path.posix.dirname(opfName), cover.href.split('#')[0])
  if (!coverPath) return null

  let imageEntries
  try {
    imageEntries = unzipSync(new Uint8Array(bytes), {
      filter(file) {
        return file.name.toLowerCase() === coverPath.toLowerCase() && boundedZipEntry(file, MAX_COVER_BYTES)
      }
    })
  } catch {
    return null
  }
  const imageName = Object.keys(imageEntries).find((name) => name.toLowerCase() === coverPath.toLowerCase())
  if (!imageName) return null
  const image = Buffer.from(imageEntries[imageName])
  if (!image.byteLength || image.byteLength > MAX_COVER_BYTES) return null
  const mimeType = imageMimeType(image, cover.mimeType)
  return mimeType ? { bytes: image, mimeType } : null
}

function fb2Text(bytes) {
  const value = Buffer.from(bytes)
  if (value[0] === 0xff && value[1] === 0xfe) return value.subarray(2).toString('utf16le')
  if (value[0] === 0xfe && value[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(value.byteLength - 2)
    for (let index = 2; index + 1 < value.byteLength; index += 2) {
      swapped[index - 2] = value[index + 1]
      swapped[index - 1] = value[index]
    }
    return swapped.toString('utf16le')
  }
  return value.toString('utf8')
}

function extractFb2Cover(bytes) {
  const xml = fb2Text(bytes)
  const coverAttributes = xml.match(/<coverpage\b[\s\S]*?<image\b([^>]*)\/?\s*>/i)?.[1]
  if (!coverAttributes) return null
  const image = parseAttributes(coverAttributes)
  const reference = image['xlink:href'] || image['l:href'] || image.href || ''
  const binaryId = reference.replace(/^#/, '')
  if (!binaryId) return null

  for (const match of xml.matchAll(/<binary\b([^>]*)>([\s\S]*?)<\/binary\s*>/gi)) {
    const attributes = parseAttributes(match[1])
    if (attributes.id !== binaryId) continue
    const encoded = match[2].replace(/\s+/g, '')
    if (!encoded || encoded.length > Math.ceil(MAX_COVER_BYTES * 4 / 3) + 4) return null
    let decoded
    try {
      decoded = Buffer.from(encoded, 'base64')
    } catch {
      return null
    }
    if (!decoded.byteLength || decoded.byteLength > MAX_COVER_BYTES) return null
    const mimeType = imageMimeType(decoded, attributes['content-type'])
    return mimeType ? { bytes: decoded, mimeType } : null
  }
  return null
}

/** Returns a validated embedded raster cover without rendering pages or generating new art. */
export function extractEmbeddedBookCover({ bytes, format, mimeType }) {
  const normalizedFormat = String(format || '').toLowerCase()
  const normalizedMime = String(mimeType || '').split(';')[0].trim().toLowerCase()
  if (normalizedFormat === 'epub' || normalizedMime === 'application/epub+zip') {
    return extractEpubCover(bytes)
  }
  if (normalizedFormat === 'fb2' || /(?:xml|fb2)/.test(normalizedMime)) {
    return extractFb2Cover(bytes)
  }
  return null
}
