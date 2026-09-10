import {
  cosineSimilarity,
  reciprocalRankFusion,
  searchSnippet
} from './book-search-ranking.mjs'
import { retrieveNarrativeSubgraph } from './book-graph-retrieval.mjs'

function serviceError(code, message, status) {
  return Object.assign(new Error(message), { code, status })
}

export function createBookSearchService({ repository, embeddingClient = null }) {
  if (!repository || typeof repository.getSearchContext !== 'function') {
    throw new TypeError('search repository is required')
  }

  const service = {
    async graph(subjectId, bookEditionId, { spoilerMode = 'reader' } = {}) {
      const context = await repository.getSearchContext({ subjectId, bookEditionId })
      if (!context) throw serviceError('NOT_FOUND', 'Книга не найдена', 404)
      if (!context.indexId || !['graph_ready', 'story_arcs_ready'].includes(context.state)) {
        throw serviceError('GRAPH_NOT_READY', 'Граф книги ещё не готов', 409)
      }
      const maxTextOffset = spoilerMode === 'full'
        ? context.textLength
        : Math.min(context.readerTextOffset, context.textLength)
      const snapshot = await repository.graphSnapshot({
        indexId: context.indexId,
        maxTextOffset,
        includeUnbounded: spoilerMode === 'full'
      })
      return {
        bookEditionId,
        spoilerMode,
        maxTextOffset,
        state: context.state,
        ...snapshot
      }
    },

    async graphSearch(subjectId, bookEditionId, {
      query,
      mode = 'hybrid',
      spoilerMode = 'reader',
      limit = 10,
      maxHops = 2
    }) {
      const context = await repository.getSearchContext({ subjectId, bookEditionId })
      if (!context) throw serviceError('NOT_FOUND', 'Книга не найдена', 404)
      if (!context.indexId || !['graph_ready', 'story_arcs_ready'].includes(context.state)) {
        throw serviceError('GRAPH_NOT_READY', 'Граф книги ещё не готов', 409)
      }
      const content = await service.search(subjectId, bookEditionId, {
        query,
        mode,
        spoilerMode,
        limit: Math.min(20, Math.max(10, limit * 2))
      })
      const snapshot = await repository.graphSnapshot({
        indexId: context.indexId,
        maxTextOffset: content.maxTextOffset,
        includeUnbounded: spoilerMode === 'full'
      })
      const subgraph = retrieveNarrativeSubgraph(snapshot, {
        query,
        limit,
        maxHops,
        seedRanges: content.results.map((item) => ({
          startOffset: item.chunkStartOffset,
          endOffset: item.chunkEndOffset
        }))
      })
      const evidence = typeof repository.graphEvidence === 'function'
        ? await repository.graphEvidence({
            indexId: context.indexId,
            evidenceIds: subgraph.evidenceIds,
            maxTextOffset: content.maxTextOffset,
            limit: Math.min(64, Math.max(12, limit * 3))
          })
        : []
      return {
        bookEditionId,
        query,
        requestedMode: mode,
        effectiveMode: content.effectiveMode,
        spoilerMode,
        maxTextOffset: content.maxTextOffset,
        maxHops,
        state: context.state,
        contentResults: content.results.slice(0, limit),
        nodes: subgraph.nodes,
        edges: subgraph.edges,
        storyArcs: subgraph.storyArcs,
        evidence
      }
    },

    async search(subjectId, bookEditionId, {
      query,
      mode = 'hybrid',
      spoilerMode = 'reader',
      limit = 10
    }) {
      const context = await repository.getSearchContext({ subjectId, bookEditionId })
      if (!context) throw serviceError('NOT_FOUND', 'Книга не найдена', 404)
      if (!context.indexId) {
        throw serviceError('SEARCH_NOT_READY', 'Поисковый индекс книги ещё не готов', 409)
      }
      const maxTextOffset = spoilerMode === 'full'
        ? context.textLength
        : Math.min(context.readerTextOffset, context.textLength)
      const candidateLimit = Math.min(100, Math.max(limit * 4, 20))
      const rankings = []
      if (mode !== 'semantic') {
        rankings.push({
          source: 'lexical',
          items: await repository.lexicalSearch({
            indexId: context.indexId,
            query,
            maxTextOffset,
            limit: candidateLimit
          })
        })
      }

      let semanticUsed = false
      const vectorReady = ['vector_partial', 'vector_ready', 'graph_ready', 'story_arcs_ready']
        .includes(context.state)
      if (mode !== 'lexical') {
        if (!vectorReady || !embeddingClient) {
          if (mode === 'semantic') {
            throw serviceError(
              'SEMANTIC_SEARCH_NOT_READY',
              'Семантический индекс книги ещё не готов',
              409
            )
          }
        } else if (
          embeddingClient.model !== context.embeddingModel ||
          embeddingClient.dimensions !== context.embeddingDimensions
        ) {
          if (mode === 'semantic') {
            throw serviceError('EMBEDDING_CONTRACT', 'Модель поиска не совпадает с индексом', 503)
          }
        } else {
          try {
            const candidates = await repository.vectorCandidates({
              indexId: context.indexId,
              maxTextOffset
            })
            if (!candidates.length) {
              rankings.push({ source: 'semantic', items: [] })
              semanticUsed = true
            } else {
              const embedded = await embeddingClient.embedText(query)
              const vectorItems = candidates.map((item) => ({
                ...item,
                score: cosineSimilarity(embedded.embedding, item.embedding)
              })).sort((left, right) => right.score - left.score || left.ordinal - right.ordinal)
                .slice(0, candidateLimit)
              rankings.push({ source: 'semantic', items: vectorItems })
              semanticUsed = true
              await repository.recordQueryUsage({
                bookEditionId,
                indexId: context.indexId,
                provider: embedded.provider,
                model: embedded.model,
                inputUnits: embedded.inputUnits,
                estimatedCostUsd: embedded.estimatedCostUsd
              })
            }
          } catch (error) {
            if (mode === 'semantic') {
              if (Number.isInteger(error?.status)) throw error
              throw serviceError(
                'SEMANTIC_SEARCH_UNAVAILABLE',
                'Семантический поиск временно недоступен',
                503
              )
            }
          }
        }
      }

      const results = reciprocalRankFusion(rankings, { limit }).map((item) => {
        const snippet = searchSnippet(item.text, query)
        return {
          chunkId: item.chunkId,
          chapterKey: item.chapterKey,
          score: item.score,
          matchedBy: item.matchedBy,
          chunkStartOffset: item.startOffset,
          chunkEndOffset: item.endOffset,
          startOffset: item.startOffset + snippet.localStartOffset,
          endOffset: item.startOffset + snippet.localEndOffset,
          snippet: snippet.text
        }
      })
      return {
        bookEditionId,
        query,
        requestedMode: mode,
        effectiveMode: semanticUsed ? (mode === 'hybrid' ? 'hybrid' : 'semantic') : 'lexical',
        spoilerMode,
        maxTextOffset,
        index: {
          state: context.state,
          embeddingModel: context.embeddingModel,
          embeddingDimensions: context.embeddingDimensions
        },
        results
      }
    }
  }
  return service
}
