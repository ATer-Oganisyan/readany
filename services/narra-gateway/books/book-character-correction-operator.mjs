import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const COMMANDS = new Set(['inspect', 'preview', 'stage', 'enable', 'disable'])

function usage() {
  return `Usage:
  node book-character-correction-operator.mjs inspect --book <uuid>
  node book-character-correction-operator.mjs preview --book <uuid> --file <correction.json>
  node book-character-correction-operator.mjs stage   --book <uuid> --file <correction.json>
  node book-character-correction-operator.mjs enable  --book <uuid> --hash <sha256>
  node book-character-correction-operator.mjs disable --book <uuid> --hash <sha256>

Required environment:
  BOOK_OPERATOR_URL       Example: https://api.example.com/operator
  BOOK_OPERATOR_USERNAME  Defaults to narra
  BOOK_OPERATOR_PASSWORD  Never pass the password as a command-line flag

Safety model:
  preview is read-only; stage only saves a draft; only enable changes reader output.`
}

function argumentError(message) {
  return Object.assign(new Error(`${message}\n\n${usage()}`), { code: 'ARGUMENT' })
}

function valueAfter(args, index, flag) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw argumentError(`${flag}: value is required`)
  return value
}

export function parseBookCharacterCorrectionCommand(argv) {
  const [command, ...args] = argv
  if (!COMMANDS.has(command)) throw argumentError('command: expected inspect, preview, stage, enable or disable')
  const input = { command, bookEditionId: null, file: null, documentHash: null }
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--book') input.bookEditionId = valueAfter(args, index++, flag)
    else if (flag === '--file') input.file = valueAfter(args, index++, flag)
    else if (flag === '--hash') input.documentHash = valueAfter(args, index++, flag)
    else throw argumentError(`${flag}: unsupported argument`)
  }
  if (!UUID.test(input.bookEditionId || '')) throw argumentError('--book: invalid UUID')
  input.bookEditionId = input.bookEditionId.toLowerCase()
  if (['preview', 'stage'].includes(command)) {
    if (!input.file) throw argumentError(`--file is required for ${command}`)
    if (input.documentHash) throw argumentError(`--hash is not allowed for ${command}`)
  } else if (['enable', 'disable'].includes(command)) {
    if (!SHA256.test(input.documentHash || '')) throw argumentError(`--hash: invalid SHA-256 for ${command}`)
    input.documentHash = input.documentHash.toLowerCase()
    if (input.file) throw argumentError(`--file is not allowed for ${command}`)
  } else if (input.file || input.documentHash) {
    throw argumentError('--file and --hash are not allowed for inspect')
  }
  return input
}

function operatorBaseUrl(env) {
  const raw = String(env.BOOK_OPERATOR_URL || '').trim()
  if (!raw) throw argumentError('BOOK_OPERATOR_URL is required')
  const url = new URL(raw.endsWith('/') ? raw : `${raw}/`)
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw argumentError('BOOK_OPERATOR_URL must use HTTPS (HTTP is allowed only on localhost)')
  }
  return url
}

async function correctionDocument(file) {
  const bytes = await readFile(file)
  if (bytes.byteLength < 2 || bytes.byteLength > 256 * 1024) {
    throw argumentError('--file: correction JSON must contain 2–262144 bytes')
  }
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw argumentError('--file: invalid JSON')
  }
}

export async function runBookCharacterCorrectionCommand(
  input,
  { env = process.env, fetchImpl = fetch } = {}
) {
  const baseUrl = operatorBaseUrl(env)
  const username = String(env.BOOK_OPERATOR_USERNAME || 'narra').trim()
  const password = String(env.BOOK_OPERATOR_PASSWORD || '')
  if (!username || !password) throw argumentError('BOOK_OPERATOR_PASSWORD is required')
  const route = new URL(
    `api/books/${input.bookEditionId}/correction${
      input.command === 'preview' ? '/preview' :
      input.command === 'enable' ? '/enable' :
      input.command === 'disable' ? '/disable' : ''
    }`,
    baseUrl
  )
  const headers = {
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    accept: 'application/json'
  }
  const options = { method: 'GET', headers, signal: AbortSignal.timeout(30_000) }
  if (input.command === 'preview' || input.command === 'stage') {
    options.method = input.command === 'preview' ? 'POST' : 'PUT'
    options.headers['content-type'] = 'application/json'
    options.body = JSON.stringify(await correctionDocument(input.file))
  } else if (input.command === 'enable' || input.command === 'disable') {
    options.method = 'POST'
    options.headers['content-type'] = 'application/json'
    options.body = JSON.stringify({ documentHash: input.documentHash })
  }
  const response = await fetchImpl(route, options)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body?.error || `operator request failed with HTTP ${response.status}`
    throw Object.assign(new Error(message), {
      code: body?.code || 'HTTP_ERROR',
      status: response.status
    })
  }
  return body
}

async function main() {
  try {
    const input = parseBookCharacterCorrectionCommand(process.argv.slice(2))
    const result = await runBookCharacterCorrectionCommand(input)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ''}${error.message}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
