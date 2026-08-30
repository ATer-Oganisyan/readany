import { createHash } from 'node:crypto'

export const BOOK_TTS_MARKUP_SCHEMA_VERSION = 1
export const BOOK_TTS_MARKUP_VERSION = 'book-tts-script-v1'

const HASH = /^[0-9a-f]{64}$/
const CHARACTER_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const DASH = '[—–―]'
const MAX_ATOM_CHARS = 5_000

function invalid(message) {
  throw Object.assign(new Error(message), { code: 'VALIDATION', status: 400 })
}

function exactText(value, name, max = 2_000_000) {
  if (typeof value !== 'string' || value.length > max) invalid(`${name}: invalid text`)
  return value
}

function safeOffset(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${name}: invalid offset`)
  return value
}

function normalizedSections(sections, textLength) {
  if (!Array.isArray(sections) || !sections.length) {
    return [{ key: 'document', title: '', index: 0, startOffset: 0, endOffset: textLength }]
  }
  let expected = 0
  return sections.map((section, index) => {
    const startOffset = safeOffset(section?.startOffset, `sections[${index}].startOffset`)
    const endOffset = safeOffset(section?.endOffset, `sections[${index}].endOffset`)
    if (startOffset !== expected || endOffset <= startOffset || endOffset > textLength) {
      invalid(`sections[${index}]: sections must cover source contiguously`)
    }
    expected = endOffset
    if (index === sections.length - 1 && endOffset !== textLength) {
      invalid('sections: final section must end at source length')
    }
    const key = String(section.key || '').trim()
    if (!key || key.length > 500) invalid(`sections[${index}].key: invalid value`)
    return {
      key,
      title: String(section.title || '').trim().slice(0, 500),
      index: Number.isSafeInteger(section.index) ? section.index : index,
      startOffset,
      endOffset
    }
  })
}

function paragraphRanges(text, startOffset, endOffset) {
  const ranges = []
  const source = text.slice(startOffset, endOffset)
  let localStart = 0
  for (const match of source.matchAll(/\n{2,}/g)) {
    const localEnd = match.index
    if (localEnd > localStart) ranges.push([startOffset + localStart, startOffset + localEnd])
    localStart = match.index + match[0].length
  }
  if (localStart < source.length) ranges.push([startOffset + localStart, endOffset])
  return ranges
}

function dashDialogueRanges(paragraph, baseOffset) {
  const first = new RegExp(`^\\s*${DASH}\\s*`, 'u').exec(paragraph)
  if (!first) return []
  const ranges = []
  let speechStart = first.index
  let cursor = first[0].length
  const remarkStart = new RegExp(`,\\s*${DASH}\\s*(?=\\p{Ll})`, 'gu')
  const nextSpeech = new RegExp(`[.!?…]\\s*${DASH}\\s*(?=\\p{Lu}|[«"“])`, 'gu')
  while (cursor < paragraph.length) {
    remarkStart.lastIndex = cursor
    const remark = remarkStart.exec(paragraph)
    if (!remark) {
      ranges.push([baseOffset + speechStart, baseOffset + paragraph.length])
      break
    }
    ranges.push([baseOffset + speechStart, baseOffset + remark.index + 1])
    nextSpeech.lastIndex = remark.index + remark[0].length
    const continuation = nextSpeech.exec(paragraph)
    if (!continuation) break
    speechStart = continuation.index + 1
    cursor = nextSpeech.lastIndex
  }
  return ranges
}

function quotedSpeechRanges(paragraph, baseOffset) {
  const ranges = []
  for (const pattern of [/«[^»]+»/gu, /“[^”]+”/gu, /"[^"\n]+"/gu]) {
    for (const match of paragraph.matchAll(pattern)) {
      ranges.push([baseOffset + match.index, baseOffset + match.index + match[0].length])
    }
  }
  return ranges
}

function nonOverlappingRanges(ranges) {
  const result = []
  for (const [start, end] of ranges.sort((left, right) => left[0] - right[0] || right[1] - left[1])) {
    if (end <= start) continue
    const previous = result.at(-1)
    if (!previous || start >= previous[1]) result.push([start, end])
  }
  return result
}

function sectionAtoms(text, section) {
  const speechRanges = []
  for (const [start, end] of paragraphRanges(text, section.startOffset, section.endOffset)) {
    const paragraph = text.slice(start, end)
    const dash = dashDialogueRanges(paragraph, start)
    speechRanges.push(...dash)
    if (!dash.length) speechRanges.push(...quotedSpeechRanges(paragraph, start))
  }
  const ranges = nonOverlappingRanges(speechRanges)
  const atoms = []
  let cursor = section.startOffset
  const push = (startOffset, endOffset, kind) => {
    let start = startOffset
    while (endOffset > start) {
      let end = Math.min(endOffset, start + MAX_ATOM_CHARS)
      if (
        end < endOffset &&
        /[\uD800-\uDBFF]/u.test(text[end - 1]) &&
        /[\uDC00-\uDFFF]/u.test(text[end])
      ) {
        end -= 1
      }
      const index = atoms.length
      atoms.push({
        id: `tts:${section.index}:${index}`,
        kind,
        startOffset: start,
        endOffset: end,
        text: text.slice(start, end)
      })
      start = end
    }
  }
  for (const [start, end] of ranges) {
    push(cursor, start, 'narration')
    push(start, end, 'speech')
    cursor = end
  }
  push(cursor, section.endOffset, 'narration')
  return atoms
}

export function createBookTtsSectionDrafts({ text, sections }) {
  if (typeof text !== 'string' || !text.length) invalid('text: expected non-empty text')
  return normalizedSections(sections, text.length).map((section) => ({
    ...section,
    atoms: sectionAtoms(text, section)
  }))
}

function publicCharacter(character, index) {
  const characterKey = String(character?.characterKey || '').trim()
  if (!CHARACTER_KEY.test(characterKey)) invalid(`characters[${index}].characterKey: invalid value`)
  return {
    characterKey,
    name: String(character.name || '').trim().slice(0, 512),
    fullName: String(character.fullName || character.name || '').trim().slice(0, 512),
    aliases: Array.isArray(character.aliases)
      ? [...new Set(character.aliases.map((value) => String(value).trim()).filter(Boolean))].slice(0, 128)
      : []
  }
}

export function createBookTtsMarkupRequests({
  bookEditionId,
  sourcePublicationId,
  normalizedTextHash,
  drafts,
  characters,
  maxCoreChars = 5_000,
  contextChars = 500
}) {
  if (!HASH.test(normalizedTextHash)) invalid('normalizedTextHash: invalid SHA-256')
  if (!Number.isSafeInteger(maxCoreChars) || maxCoreChars < 100) invalid('maxCoreChars: invalid value')
  if (!Number.isSafeInteger(contextChars) || contextChars < 0) invalid('contextChars: invalid value')
  const roster = (characters ?? []).map(publicCharacter)
  const requests = []
  for (const draft of drafts) {
    const sectionIdentity = createHash('sha256').update(JSON.stringify({
      key: draft.key,
      title: draft.title,
      index: draft.index,
      startOffset: draft.startOffset,
      endOffset: draft.endOffset
    })).digest('hex').slice(0, 16)
    const speech = draft.atoms.filter(({ kind, text }) => kind === 'speech' && text.trim())
    let cursor = 0
    while (cursor < speech.length) {
      const core = []
      let coreChars = 0
      while (cursor < speech.length && (!core.length || coreChars + speech[cursor].text.length <= maxCoreChars)) {
        core.push(speech[cursor])
        coreChars += speech[cursor].text.length
        cursor += 1
      }
      const coreStart = core[0].startOffset
      const coreEnd = core.at(-1).endOffset
      const contextStart = Math.max(draft.startOffset, coreStart - contextChars)
      const contextEnd = Math.min(draft.endOffset, coreEnd + contextChars)
      const contextAtoms = draft.atoms.flatMap((atom) => {
        const startOffset = Math.max(atom.startOffset, contextStart)
        const endOffset = Math.min(atom.endOffset, contextEnd)
        if (endOffset <= startOffset) return []
        const text = atom.text.slice(startOffset - atom.startOffset, endOffset - atom.startOffset)
        if (!text.trim()) return []
        return [{
          atomId: atom.id,
          kind: atom.kind,
          text
        }]
      })
      requests.push({
        bookEditionId,
        sourcePublicationId,
        normalizedTextHash,
        markupVersion: BOOK_TTS_MARKUP_VERSION,
        requestId: `${sourcePublicationId}:${sectionIdentity}:${requests.length}`,
        section: {
          key: draft.key, title: draft.title, index: draft.index,
          startOffset: draft.startOffset, endOffset: draft.endOffset
        },
        characters: roster,
        coreAtoms: core.map(({ id: atomId, kind, text, startOffset, endOffset }) => ({
          atomId, kind, text, startOffset, endOffset
        })),
        contextAtoms
      })
    }
  }
  return requests
}

export function normalizeBookTtsProviderAssignments(raw, { coreAtoms, characters }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.assignments)) {
    invalid('assignments: expected an array')
  }
  const atoms = coreAtoms.filter(({ kind }) => kind === 'speech')
  const atomIds = new Set(atoms.map((atom) => atom.atomId ?? atom.id))
  const characterKeys = new Set((characters ?? []).map(({ characterKey }) => characterKey))
  const byAtom = new Map()
  for (const assignment of raw.assignments) {
    const atomId = String(assignment?.atomId || '').trim()
    if (!atomIds.has(atomId) || byAtom.has(atomId)) continue
    const candidate = assignment.characterKey == null || assignment.characterKey === ''
      ? null
      : String(assignment.characterKey).trim()
    const confidence = Number(assignment.confidence)
    const characterKey = candidate && characterKeys.has(candidate) ? candidate : null
    byAtom.set(atomId, {
      atomId,
      characterKey,
      confidence: characterKey && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
        ? confidence
        : 0
    })
  }
  return atoms.map((atom) => {
    const atomId = atom.atomId ?? atom.id
    return byAtom.get(atomId) ?? { atomId, characterKey: null, confidence: 0 }
  })
}

export function normalizeBookTtsAssignments(raw, { coreAtoms, characters }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.assignments)) {
    invalid('assignments: expected an array')
  }
  const atoms = new Map(coreAtoms
    .filter(({ kind }) => kind === 'speech')
    .map((atom) => [atom.atomId ?? atom.id, atom]))
  const characterKeys = new Set((characters ?? []).map(({ characterKey }) => characterKey))
  const seen = new Set()
  return raw.assignments.map((assignment, index) => {
    const atomId = String(assignment?.atomId || '').trim()
    if (!atoms.has(atomId)) invalid(`assignments[${index}]: unknown atom`)
    if (seen.has(atomId)) invalid(`assignments[${index}]: duplicate atom`)
    seen.add(atomId)
    const characterKey = assignment.characterKey == null || assignment.characterKey === ''
      ? null
      : String(assignment.characterKey).trim()
    if (characterKey && !characterKeys.has(characterKey)) {
      invalid(`assignments[${index}]: unknown character`)
    }
    const confidence = Number(assignment.confidence)
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      invalid(`assignments[${index}].confidence: invalid value`)
    }
    return { atomId, characterKey, confidence }
  })
}

export function assembleBookTtsScript({
  sourceText,
  sourcePublicationId,
  sourceMarkupContentHash,
  normalizedTextHash,
  drafts,
  assignments
}) {
  const byAtom = new Map(assignments.map((assignment) => [assignment.atomId, assignment]))
  return {
    schemaVersion: BOOK_TTS_MARKUP_SCHEMA_VERSION,
    analysisVersion: BOOK_TTS_MARKUP_VERSION,
    sourcePublicationId,
    sourceMarkupContentHash,
    normalizedTextHash,
    textLength: sourceText.length,
    sections: drafts.map((draft) => ({
      key: draft.key,
      title: draft.title,
      index: draft.index,
      startOffset: draft.startOffset,
      endOffset: draft.endOffset,
      segments: draft.atoms.map((atom) => {
        const assignment = atom.kind === 'speech' ? byAtom.get(atom.id) : null
        return {
          id: atom.id,
          startOffset: atom.startOffset,
          endOffset: atom.endOffset,
          text: atom.text,
          kind: atom.kind,
          characterKey: atom.kind === 'speech' ? assignment?.characterKey ?? null : null,
          confidence: atom.kind === 'speech' ? assignment?.confidence ?? 0 : 1
        }
      })
    }))
  }
}

export function normalizeBookTtsScript(input, sourceText) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('script: expected object')
  if (input.schemaVersion !== BOOK_TTS_MARKUP_SCHEMA_VERSION) invalid('script.schemaVersion: unsupported')
  if (input.analysisVersion !== BOOK_TTS_MARKUP_VERSION) invalid('script.analysisVersion: unsupported')
  if (!HASH.test(String(input.sourceMarkupContentHash || ''))) invalid('sourceMarkupContentHash: invalid')
  if (!HASH.test(String(input.normalizedTextHash || ''))) invalid('normalizedTextHash: invalid')
  exactText(sourceText, 'sourceText', 512 * 1024 * 1024)
  if (input.textLength !== sourceText.length) invalid('script.textLength: source mismatch')
  const sections = normalizedSections(input.sections, sourceText.length).map((section, sectionIndex) => {
    const raw = input.sections[sectionIndex]
    if (!Array.isArray(raw.segments) || !raw.segments.length) {
      invalid(`sections[${sectionIndex}].segments: expected non-empty array`)
    }
    let expected = section.startOffset
    const segments = raw.segments.map((segment, segmentIndex) => {
      const startOffset = safeOffset(segment.startOffset, `segments[${segmentIndex}].startOffset`)
      const endOffset = safeOffset(segment.endOffset, `segments[${segmentIndex}].endOffset`)
      if (startOffset !== expected || endOffset <= startOffset || endOffset > section.endOffset) {
        invalid(`sections[${sectionIndex}].segments: non-contiguous coverage`)
      }
      expected = endOffset
      const text = exactText(segment.text, `segments[${segmentIndex}].text`)
      if (sourceText.slice(startOffset, endOffset) !== text) {
        invalid(`sections[${sectionIndex}].segments[${segmentIndex}]: source mismatch`)
      }
      const kind = segment.kind === 'speech' ? 'speech' : segment.kind === 'narration' ? 'narration' : null
      if (!kind) invalid(`segments[${segmentIndex}].kind: invalid value`)
      const characterKey = segment.characterKey == null ? null : String(segment.characterKey)
      if (kind === 'narration' && characterKey) invalid('narration cannot have a character')
      if (characterKey && !CHARACTER_KEY.test(characterKey)) invalid('segment characterKey: invalid')
      const confidence = Number(segment.confidence)
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        invalid('segment confidence: invalid')
      }
      return {
        id: String(segment.id || `tts:${section.index}:${segmentIndex}`),
        startOffset, endOffset, text, kind, characterKey, confidence
      }
    })
    if (expected !== section.endOffset) invalid(`sections[${sectionIndex}]: incomplete coverage`)
    return { ...section, segments }
  })
  return {
    schemaVersion: BOOK_TTS_MARKUP_SCHEMA_VERSION,
    analysisVersion: BOOK_TTS_MARKUP_VERSION,
    sourcePublicationId: String(input.sourcePublicationId || ''),
    sourceMarkupContentHash: input.sourceMarkupContentHash,
    normalizedTextHash: input.normalizedTextHash,
    textLength: input.textLength,
    sections
  }
}

export function bookTtsScriptContentHash(script) {
  return createHash('sha256').update(JSON.stringify(script)).digest('hex')
}
