import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

function normalizeInput(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('ru-RU').trim()
}

function features(value) {
  const normalized = normalizeInput(value)
  if (!normalized) return []
  const words = normalized.match(/[\p{L}\p{N}]+/gu) || [normalized]
  const result = words.map((word) => `w:${word}`)
  for (const word of words) {
    const padded = `^${word}$`
    for (let index = 0; index + 2 < padded.length; index += 1) {
      result.push(`c:${padded.slice(index, index + 3)}`)
    }
  }
  return result
}

export function localHashEmbedding(value, dimensions = 256) {
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 4096) {
    throw new RangeError('dimensions must be an integer from 1 to 4096')
  }
  const vector = Array.from({ length: dimensions }, () => 0)
  for (const feature of features(value)) {
    const digest = createHash('sha256').update(feature).digest()
    const index = digest.readUInt32BE(0) % dimensions
    const sign = (digest[4] & 1) === 0 ? 1 : -1
    vector[index] += sign
  }
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0))
  if (norm === 0) return vector
  return vector.map((item) => item / norm)
}

function json(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength)
  })
  response.end(body)
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > 1024 * 1024) throw Object.assign(new Error('request too large'), { status: 413 })
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 })
  }
}

export function createLocalEmbeddingServer({
  model = 'local-hash-v1',
  dimensions = 256
} = {}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, 200, { ok: true, model, dimensions })
      }
      if (request.method !== 'POST' || url.pathname !== '/v1/embeddings') {
        return json(response, 404, { error: { message: 'not found' } })
      }
      const payload = await readJson(request)
      const requestedModel = String(payload?.model || '')
      const requestedDimensions = Number(payload?.dimensions ?? dimensions)
      if (requestedModel !== model || requestedDimensions !== dimensions) {
        return json(response, 400, { error: { message: 'embedding contract mismatch' } })
      }
      const inputs = Array.isArray(payload?.input) ? payload.input : [payload?.input]
      if (!inputs.length || inputs.some((item) => typeof item !== 'string' || !item.trim())) {
        return json(response, 400, { error: { message: 'input must contain non-empty text' } })
      }
      const promptTokens = inputs.reduce(
        (total, item) => total + (normalizeInput(item).match(/[\p{L}\p{N}]+/gu)?.length || 0),
        0
      )
      return json(response, 200, {
        object: 'list',
        model,
        data: inputs.map((item, index) => ({
          object: 'embedding',
          index,
          embedding: localHashEmbedding(item, dimensions)
        })),
        usage: { prompt_tokens: promptTokens, total_tokens: promptTokens }
      })
    } catch (error) {
      return json(response, Number(error?.status) || 500, {
        error: { message: error?.message || 'embedding service failed' }
      })
    }
  })
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false
if (entrypoint) {
  const port = Number(process.env.PORT || 8080)
  const model = String(process.env.LOCAL_EMBEDDING_MODEL || 'local-hash-v1')
  const dimensions = Number(process.env.LOCAL_EMBEDDING_DIMENSIONS || 256)
  createLocalEmbeddingServer({ model, dimensions }).listen(port, '0.0.0.0', () => {
    console.info(`[local-book-embedding] listening :${port}; model=${model}; dimensions=${dimensions}`)
  })
}
