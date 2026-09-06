import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'

// GHSA-px8p-9vwx-vf98: never run an untrusted ZIP64 parse in this test process.
// Upstream bounds fix: https://github.com/101arrowz/fflate/commit/e6d5e6e1076892f72770ac732d83c81da9f3316e
const TEXT = 'Лев открыл книгу. Anna continued reading. 阅读继续。'
const COVER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ordinaryEpub = Buffer.from(zipSync({
  'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
  'book.opf': strToU8('<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/></manifest><spine><itemref idref="chapter"/></spine></package>'),
  'chapter.xhtml': strToU8(`<html><body><p>${TEXT}</p></body></html>`),
  'cover.png': COVER
}, { level: 0 }))

function zip64Archive(extraKind) {
  const end = ordinaryEpub.length - 22
  const centralOffset = ordinaryEpub.readUInt32LE(end + 16)
  const centralSize = ordinaryEpub.readUInt32LE(end + 12)
  const entries = ordinaryEpub.readUInt16LE(end + 10)
  const nameLength = ordinaryEpub.readUInt16LE(centralOffset + 28)
  assert.equal(ordinaryEpub.readUInt16LE(centralOffset + 30), 0)
  const extraOffset = centralOffset + 46 + nameLength
  const extra = Buffer.alloc(extraKind === 'valid' ? 28 : extraKind === 'wrong-tag' ? 4 : 0)
  if (extraKind === 'valid') {
    extra.writeUInt16LE(0x0001, 0)
    extra.writeUInt16LE(24, 2)
    extra.writeBigUInt64LE(BigInt(ordinaryEpub.readUInt32LE(centralOffset + 24)), 4)
    extra.writeBigUInt64LE(BigInt(ordinaryEpub.readUInt32LE(centralOffset + 20)), 12)
    extra.writeBigUInt64LE(BigInt(ordinaryEpub.readUInt32LE(centralOffset + 42)), 20)
  } else if (extraKind === 'wrong-tag') extra.writeUInt16LE(0x1234, 0)

  const prefix = Buffer.concat([
    ordinaryEpub.subarray(0, extraOffset), extra, ordinaryEpub.subarray(extraOffset, end)
  ])
  prefix.writeUInt32LE(0xffffffff, centralOffset + 20)
  prefix.writeUInt32LE(0xffffffff, centralOffset + 24)
  prefix.writeUInt32LE(0xffffffff, centralOffset + 42)
  prefix.writeUInt16LE(extra.length, centralOffset + 30)

  const zip64End = Buffer.alloc(56)
  zip64End.writeUInt32LE(0x06064b50, 0)
  zip64End.writeBigUInt64LE(44n, 4)
  zip64End.writeUInt16LE(45, 12)
  zip64End.writeUInt16LE(45, 14)
  zip64End.writeBigUInt64LE(BigInt(entries), 24)
  zip64End.writeBigUInt64LE(BigInt(entries), 32)
  zip64End.writeBigUInt64LE(BigInt(centralSize + extra.length), 40)
  zip64End.writeBigUInt64LE(BigInt(centralOffset), 48)
  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  locator.writeBigUInt64LE(BigInt(prefix.length), 8)
  locator.writeUInt32LE(1, 16)
  const legacyEnd = Buffer.from(ordinaryEpub.subarray(end))
  legacyEnd.writeUInt16LE(0xffff, 8)
  legacyEnd.writeUInt16LE(0xffff, 10)
  legacyEnd.writeUInt32LE(0xffffffff, 12)
  legacyEnd.writeUInt32LE(0xffffffff, 16)
  return Buffer.concat([prefix, zip64End, locator, legacyEnd])
}

function parseInChild(kind, bytes) {
  const moduleUrl = new URL(`../book-source-${kind}.mjs`, import.meta.url).href
  const script = `
    import { readFileSync } from 'node:fs';
    const source = await import(${JSON.stringify(moduleUrl)});
    const bytes = Buffer.from(readFileSync(0, 'utf8'), 'base64');
    try {
      const result = ${kind === 'text'
        ? "await source.extractBookText({ bytes, format: 'epub' })"
        : "source.extractEmbeddedBookCover({ bytes, format: 'epub' })"};
      console.log(JSON.stringify({ outcome: 'returned', result }));
    } catch (error) {
      console.log(JSON.stringify({ outcome: 'rejected', code: error.code, message: error.message }));
    }
  `
  const child = spawnSync(process.execPath, ['--max-old-space-size=96', '--input-type=module', '--eval', script], {
    input: bytes.toString('base64'), encoding: 'utf8', timeout: 2_000,
    killSignal: 'SIGKILL', maxBuffer: 64 * 1024
  })
  assert.equal(child.error?.code, undefined, `${kind} parse exceeded the hard child-process deadline: ${child.error?.message}`)
  assert.equal(child.signal, null, `${kind} parser required forced termination`)
  assert.equal(child.status, 0, child.stderr)
  return JSON.parse(child.stdout)
}

for (const kind of ['text', 'cover']) {
  for (const extra of ['missing', 'wrong-tag']) {
    test(`${kind} extraction terminates for tiny ZIP64 with ${extra} required extra field`, () => {
      const archive = zip64Archive(extra)
      assert.ok(archive.length < 2_000, 'fixture must demonstrate a tiny input, not an expansion bomb')
      const result = parseInChild(kind, archive)
      if (kind === 'text') assert.equal(result.code, 'BOOK_PARSE_FAILED')
      else assert.deepEqual(result, { outcome: 'returned', result: null })
    })
  }

  for (const format of ['zip32', 'zip64']) {
    test(`${kind} extraction still accepts a valid ${format} EPUB`, () => {
      const result = parseInChild(kind, format === 'zip64' ? zip64Archive('valid') : ordinaryEpub)
      assert.equal(result.outcome, 'returned')
      if (kind === 'text') assert.equal(result.result, TEXT)
      else {
        assert.equal(result.result.mimeType, 'image/png')
        assert.deepEqual(result.result.bytes.data, Array.from(COVER))
      }
    })
  }
}
