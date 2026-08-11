#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const manifestPath = path.resolve(
  process.env.CATALOG_MANIFEST || path.join(scriptDirectory, 'book-catalog-seed.json')
)
const baseUrl = String(process.env.CATALOG_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '')
const token = String(process.env.CATALOG_INGEST_TOKEN || '').trim()
if (token.length < 32) throw new Error('CATALOG_INGEST_TOKEN must contain at least 32 characters')

async function request(pathname, init) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(120_000)
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status}: ${body.slice(0, 500)}`)
  return body ? JSON.parse(body) : {}
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (!Array.isArray(manifest.books) || !manifest.books.length) {
  throw new Error('catalog manifest must contain a non-empty books array')
}

for (const book of manifest.books) {
  const filename = path.resolve(path.dirname(manifestPath), book.file)
  const bytes = await readFile(filename)
  const contentSha256 = createHash('sha256').update(bytes).digest('hex')
  const prepared = await request('/v2/admin/catalog/books/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      catalog_key: book.catalog_key,
      content_sha256: contentSha256,
      title: book.title,
      author: book.author || '',
      format: book.format,
      byte_size: bytes.byteLength
    })
  })
  if (!prepared.upload_required) {
    console.log(`[catalog] ${book.catalog_key}: already uploaded (${prepared.generation_status})`)
    continue
  }
  await request(prepared.upload_path, {
    method: 'POST',
    headers: { 'content-type': book.mime_type },
    body: bytes
  })
  const completed = await request(prepared.complete_path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  })
  console.log(`[catalog] ${book.catalog_key}: queued (${completed.job_id})`)
}
