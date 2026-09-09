/**
 * Pulls the published character roster of a catalog book from a running gateway and
 * writes it in the shape `score-frozen-identity.mjs` / `score-character-cards.mjs` read.
 *
 * The gateway mounts the catalog under `/v2`, behind installation auth, so the script
 * registers a throwaway installation exactly like a fresh app install does and then
 * issues read-only GETs.
 *
 *   node evaluation/fetch-catalog-roster.mjs \
 *     --base-url https://api.narra.disrupt.builders \
 *     --book 3c1ab592-0228-4931-ba74-5003fb463c1b \
 *     --out /tmp/onegin.roster.json
 *
 * Add `--text /tmp/onegin.txt` to also download the normalized text, which the card
 * scorer needs for the spoiler-window checks.
 */
import { randomUUID, randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

function inputError(message) {
  return Object.assign(new TypeError(message), { code: 'CATALOG_ROSTER_INPUT_INVALID' })
}

function parseArguments(argv) {
  const result = { baseUrl: 'https://api.narra.disrupt.builders' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--base-url') result.baseUrl = argv[++index]
    else if (value === '--book') result.bookEditionId = argv[++index]
    else if (value === '--out') result.outPath = argv[++index]
    else if (value === '--text') result.textPath = argv[++index]
    else if (value === '--installation-id') result.installationId = argv[++index]
    else if (value === '--installation-secret') result.installationSecret = argv[++index]
    else throw inputError(`unknown argument: ${value}`)
  }
  if (!result.bookEditionId) throw inputError('--book is required')
  if (!result.outPath) throw inputError('--out is required')
  return result
}

export async function registerInstallation({
  baseUrl,
  installationId = randomUUID(),
  installationSecret = randomBytes(48).toString('base64url'),
  fetchImpl = globalThis.fetch
}) {
  const response = await fetchImpl(`${baseUrl}/v2/installations/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      installation_id: installationId,
      installation_secret: installationSecret,
      app_version: 'character-cards-benchmark',
      platform: process.platform,
      arch: process.arch
    })
  })
  if (!response.ok) {
    throw new Error(`installation register failed: HTTP ${response.status} ${await response.text()}`)
  }
  const body = await response.json()
  return { token: body.token, installationId, installationSecret }
}

async function getJson(baseUrl, token, path, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` }
  })
  if (!response.ok) {
    throw new Error(`GET ${path} failed: HTTP ${response.status} ${await response.text()}`)
  }
  return response.json()
}

/**
 * book-markup-v3 publishes one row per character with no alias list, so the roster the
 * scorer sees carries the canonical name only. That is deliberate: the benchmark must
 * see the same surface the reader sees.
 */
export function rosterFromManifest(manifest) {
  const characters = Array.isArray(manifest?.characters) ? manifest.characters : []
  return {
    contractVersion: 'catalog-roster-v1',
    bookEditionId: manifest?.book?.book_edition_id ?? null,
    title: manifest?.book?.title ?? null,
    runId: manifest?.run_id ?? null,
    publicationId: manifest?.publication_id ?? null,
    contentHash: manifest?.content_hash ?? null,
    markup: manifest?.markup ?? null,
    charactersStatus: manifest?.characters_status ?? null,
    characters: characters.map((character) => ({
      entityKey: character.character_key,
      canonicalName: character.name,
      fullName: character.full_name || null,
      aliases: Array.isArray(character.aliases) ? character.aliases : [],
      firstAppearanceTextOffset: character.first_appearance_text_offset ?? null,
      state: character.state ?? null,
      profile: character.profile ?? null,
      assetTypes: (character.bundle?.assets ?? []).map((asset) => asset.type)
    }))
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const { token } = await registerInstallation(options)
  const manifest = await getJson(
    options.baseUrl, token, `/v2/books/${options.bookEditionId}/manifest`
  )
  const roster = rosterFromManifest(manifest)
  await writeFile(options.outPath, `${JSON.stringify(roster, null, 2)}\n`)
  process.stdout.write(`${roster.characters.length} characters -> ${options.outPath}\n`)

  if (options.textPath) {
    const content = await getJson(
      options.baseUrl, token, `/v2/books/${options.bookEditionId}/content`
    )
    const download = await fetch(content.download_url)
    if (!download.ok) throw new Error(`text download failed: HTTP ${download.status}`)
    const text = await download.text()
    if (text.length !== content.text_length) {
      throw new Error(`text length ${text.length} does not match declared ${content.text_length}`)
    }
    await writeFile(options.textPath, text)
    process.stdout.write(`${text.length} chars -> ${options.textPath}\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
