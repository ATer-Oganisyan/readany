import express from 'express'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MODES = new Set(['lexical', 'semantic', 'hybrid'])
const SPOILER_MODES = new Set(['reader', 'full'])

function validation(message) {
  throw Object.assign(new Error(message), { code: 'VALIDATION', status: 400 })
}

function uuid(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) validation(`${name}: invalid UUID`)
  return value
}

export function parseBookSearchQuery(value) {
  const allowed = new Set(['q', 'mode', 'spoiler_mode', 'limit'])
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) validation(`${key}: unknown query parameter`)
  }
  if (typeof value?.q !== 'string' || value.q.trim().length < 2 || value.q.length > 500) {
    validation('q: expected 2-500 characters')
  }
  const mode = value.mode === undefined ? 'hybrid' : String(value.mode)
  if (!MODES.has(mode)) validation('mode: expected lexical, semantic or hybrid')
  const spoilerMode = value.spoiler_mode === undefined ? 'reader' : String(value.spoiler_mode)
  if (!SPOILER_MODES.has(spoilerMode)) validation('spoiler_mode: expected reader or full')
  const limit = value.limit === undefined ? 10 : Number(value.limit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    validation('limit: expected integer from 1 to 20')
  }
  return { query: value.q.trim(), mode, spoilerMode, limit }
}

export function parseBookGraphQuery(value) {
  for (const key of Object.keys(value || {})) {
    if (key !== 'spoiler_mode') validation(`${key}: unknown query parameter`)
  }
  const spoilerMode = value?.spoiler_mode === undefined ? 'reader' : String(value.spoiler_mode)
  if (!SPOILER_MODES.has(spoilerMode)) validation('spoiler_mode: expected reader or full')
  return { spoilerMode }
}

export function parseBookGraphSearchQuery(value) {
  const { max_hops: rawMaxHops, ...search } = value || {}
  const parsed = parseBookSearchQuery(search)
  const maxHops = rawMaxHops === undefined ? 2 : Number(rawMaxHops)
  if (!Number.isSafeInteger(maxHops) || maxHops < 1 || maxHops > 2) {
    validation('max_hops: expected integer from 1 to 2')
  }
  return { ...parsed, maxHops }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(next)
}

export function createBookSearchRouter({ service }) {
  if (
    !service || typeof service.search !== 'function' ||
    typeof service.graph !== 'function' || typeof service.graphSearch !== 'function'
  ) {
    throw new TypeError('book search service is required')
  }
  const router = express.Router()
  router.get('/:bookEditionId/graph/search', asyncRoute(async (req, res) => {
    const result = await service.graphSearch(
      uuid(req.installation?.sub, 'installation subject'),
      uuid(req.params.bookEditionId, 'bookEditionId'),
      parseBookGraphSearchQuery(req.query)
    )
    res.json({
      contract_version: 'book-graph-search-v1',
      book_edition_id: result.bookEditionId,
      query: result.query,
      requested_mode: result.requestedMode,
      effective_mode: result.effectiveMode,
      spoiler_mode: result.spoilerMode,
      max_text_offset: result.maxTextOffset,
      max_hops: result.maxHops,
      state: result.state,
      content_results: result.contentResults.map((item) => ({
        chunk_id: item.chunkId,
        chapter_key: item.chapterKey,
        score: item.score,
        matched_by: item.matchedBy,
        start_text_offset: item.startOffset,
        end_text_offset: item.endOffset,
        snippet: item.snippet
      })),
      nodes: result.nodes.map((node) => ({
        node_key: node.key,
        node_type: node.type,
        canonical_name: node.name,
        first_evidence_text_offset: node.firstEvidenceOffset,
        last_evidence_text_offset: node.lastEvidenceOffset,
        score: node.score,
        matched_by: node.matchedBy,
        graph_distance: node.graphDistance,
        data: node.data
      })),
      edges: result.edges.map((edge) => ({
        edge_key: edge.key,
        edge_type: edge.type,
        source_node_key: edge.sourceKey,
        target_node_key: edge.targetKey,
        label: edge.label,
        evidence_start_text_offset: edge.startOffset,
        evidence_end_text_offset: edge.endOffset,
        evidence_ids: edge.evidenceIds,
        score: edge.score,
        matched_by: edge.matchedBy,
        data: edge.data
      })),
      story_arcs: result.storyArcs.map((arc) => ({
        arc_key: arc.key,
        title: arc.title,
        summary: arc.summary,
        event_keys: arc.eventKeys,
        participant_character_keys: arc.participantCharacterKeys,
        evidence_start_text_offset: arc.startOffset,
        evidence_end_text_offset: arc.endOffset,
        evidence_ids: arc.evidenceIds,
        score: arc.score,
        matched_by: arc.matchedBy,
        data: arc.data
      })),
      evidence: result.evidence.map((item) => ({
        evidence_id: item.id,
        observation_type: item.type,
        fact: item.fact,
        quote: item.quote,
        start_text_offset: item.startOffset,
        end_text_offset: item.endOffset,
        chunk_id: item.chunkId,
        chapter_key: item.chapterKey
      }))
    })
  }))
  router.get('/:bookEditionId/graph', asyncRoute(async (req, res) => {
    const result = await service.graph(
      uuid(req.installation?.sub, 'installation subject'),
      uuid(req.params.bookEditionId, 'bookEditionId'),
      parseBookGraphQuery(req.query)
    )
    res.json({
      contract_version: 'book-narrative-graph-v1',
      book_edition_id: result.bookEditionId,
      spoiler_mode: result.spoilerMode,
      max_text_offset: result.maxTextOffset,
      state: result.state,
      nodes: result.nodes.map((node) => ({
        node_key: node.key,
        node_type: node.type,
        canonical_name: node.name,
        first_evidence_text_offset: node.firstEvidenceOffset,
        last_evidence_text_offset: node.lastEvidenceOffset,
        data: node.data
      })),
      edges: result.edges.map((edge) => ({
        edge_key: edge.key,
        edge_type: edge.type,
        source_node_key: edge.sourceKey,
        target_node_key: edge.targetKey,
        label: edge.label,
        evidence_start_text_offset: edge.startOffset,
        evidence_end_text_offset: edge.endOffset,
        evidence_ids: edge.evidenceIds,
        data: edge.data
      })),
      story_arcs: result.storyArcs.map((arc) => ({
        arc_key: arc.key,
        title: arc.title,
        summary: arc.summary,
        event_keys: arc.eventKeys,
        participant_character_keys: arc.participantCharacterKeys,
        evidence_start_text_offset: arc.startOffset,
        evidence_end_text_offset: arc.endOffset,
        evidence_ids: arc.evidenceIds,
        data: arc.data
      }))
    })
  }))
  router.get('/:bookEditionId/search', asyncRoute(async (req, res) => {
    const result = await service.search(
      uuid(req.installation?.sub, 'installation subject'),
      uuid(req.params.bookEditionId, 'bookEditionId'),
      parseBookSearchQuery(req.query)
    )
    res.json({
      contract_version: 'book-search-v1',
      book_edition_id: result.bookEditionId,
      query: result.query,
      requested_mode: result.requestedMode,
      effective_mode: result.effectiveMode,
      spoiler_mode: result.spoilerMode,
      max_text_offset: result.maxTextOffset,
      index: {
        state: result.index.state,
        embedding_model: result.index.embeddingModel,
        embedding_dimensions: result.index.embeddingDimensions
      },
      results: result.results.map((item) => ({
        chunk_id: item.chunkId,
        chapter_key: item.chapterKey,
        score: item.score,
        matched_by: item.matchedBy,
        start_text_offset: item.startOffset,
        end_text_offset: item.endOffset,
        snippet: item.snippet
      }))
    })
  }))
  router.use((error, _req, res, next) => {
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600) {
      return res.status(error.status).json({ error: error.message, code: error.code || 'VALIDATION' })
    }
    next(error)
  })
  return router
}
