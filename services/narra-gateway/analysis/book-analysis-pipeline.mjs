import {
  BOOK_ANALYSIS_IDENTITY_RECONCILIATION_VERSION,
  BOOK_ANALYSIS_MARKUP_VERSION,
  BOOK_ANALYSIS_PIPELINE_VERSION,
  BOOK_ANALYSIS_PROMPT_VERSION,
  BOOK_ANALYSIS_SCHEMA_VERSION,
  BOOK_ANALYSIS_SYNTHESIS_VERSION
} from './book-analysis-contracts.mjs'
import {
  buildBookIdentityReconciliationRequest,
  validateBookIdentityMerges
} from './book-analysis-identity-reconciliation.mjs'
import { selectCharacterSynthesisEvidence } from './book-analysis-synthesis.mjs'

export const BOOK_ANALYSIS_PIPELINE_NARRA = 'narra'
export const BOOK_ANALYSIS_PIPELINE_EXTERNAL = 'external'
export const BOOK_ANALYSIS_PIPELINE_CARDS = 'cards'
export const BOOK_ANALYSIS_PIPELINE_IDS = Object.freeze([
  BOOK_ANALYSIS_PIPELINE_NARRA,
  BOOK_ANALYSIS_PIPELINE_EXTERNAL,
  BOOK_ANALYSIS_PIPELINE_CARDS
])

export const BOOK_ANALYSIS_NORMALIZATION_VERSION = 'normalized-text-v2'
export const EXTERNAL_ADAPTER_CONTRACT_VERSION = 'autiobook-adapter-v1'
export const EXTERNAL_UPSTREAM_REVISION = 'd532bdd0a15f2948fd0c99f5e11b92677cb5c3eb'
export const EXTERNAL_PIPELINE_IMPLEMENTATION_VERSION =
  'external-autiobook-v1.d532bdd0'
export const EXTERNAL_EVIDENCE_PROFILE_VERSION = 'external-evidence-profile-v1'
// Версия меняется всякий раз, когда меняется поведение конвейера: по ней
// считается ключ прогона, и прогоны разных версий не переиспользуются.
//
// v2: `mentioned` отделяет названное лицо от действующего, карточка требует
//     утверждений вместо строк.
// v3: полное русское имя, названное однажды, связывает фамилию с отчеством.
// v4: запрет по со-упоминанию снова абсолютен — снятый по соседству, он дал
//     склейку тридцати трёх кандидатов «Обломова» в одного человека.
// v5: со-упоминание стало уликой для модели, у стадии своя модель и потолок
//     размера склейки.
// v6: абзац принадлежит окну, в котором начинается, — одинаково при постановке
//     задания и при сборке карточки.
// v7: имя на «э» и трёхбуквенное имя больше не пропадают из инвентаря. Разбор
//     даёт другой набор фрагментов, поэтому прогоны v6 переиспользовать нельзя:
//     у книги, разобранной до правки, «Аомамэ» так и осталась бы без цитат.
// v8: у книги от первого лица есть рассказчик, и подтверждают его собственные
//     слова, а не первое называние по имени.
export const CARDS_PIPELINE_IMPLEMENTATION_VERSION = 'cards-v8'
export const CARDS_PIPELINE_INVENTORY_VERSION = 'name-inventory-v1'
export const CARDS_PIPELINE_CARD_VERSION = 'character-card-v1'
export const CARDS_PIPELINE_CONFIRMATION_VERSION = 'roster-confirm-v1'

const PIPELINE_IDS = new Set(BOOK_ANALYSIS_PIPELINE_IDS)

function pipelineInputError(message) {
  return Object.assign(new TypeError(message), { code: 'INVALID_ARGUMENT' })
}

export function normalizeBookAnalysisPipelineId(value, name = 'pipeline') {
  const normalized = String(value || '').trim().toLowerCase()
  if (!PIPELINE_IDS.has(normalized)) {
    throw pipelineInputError(`${name} must be one of: ${BOOK_ANALYSIS_PIPELINE_IDS.join(', ')}`)
  }
  return normalized
}

export function bookAnalysisPipelineFromEnv(env = process.env) {
  return normalizeBookAnalysisPipelineId(
    env.BOOK_ANALYSIS_PIPELINE || BOOK_ANALYSIS_PIPELINE_NARRA,
    'BOOK_ANALYSIS_PIPELINE'
  )
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Издания, которым назначен конвейер карточек поимённо.
 *
 * Раскатка идёт канарейкой на нескольких каталожных книгах, а не флагом «всем
 * новым импортам»: конвейер меняет то, что видит читатель, и откат стоит
 * восстановления данных. Список поимённый именно поэтому — включить книгу можно
 * только назвав её, а не задев целый класс книг настройкой по умолчанию.
 *
 * Мусор в списке — ошибка конфигурации, а не повод молча взять меньше книг:
 * оператор, опечатавшийся в идентификаторе, должен узнать об этом при старте, а
 * не по отсутствию эффекта.
 */
export function bookAnalysisCardsEditionsFromEnv(env = process.env) {
  const raw = String(env.BOOK_ANALYSIS_CARDS_EDITIONS || '').trim()
  if (!raw) return new Set()
  const values = raw.split(/[,\s]+/).filter(Boolean)
  const invalid = values.filter((value) => !UUID.test(value))
  if (invalid.length) {
    throw Object.assign(
      new TypeError(
        `BOOK_ANALYSIS_CARDS_EDITIONS contains values that are not book edition ids: ${invalid.join(', ')}`
      ),
      { code: 'BOOK_ANALYSIS_CARDS_EDITIONS_INVALID' }
    )
  }
  return new Set(values.map((value) => value.toLowerCase()))
}

/**
 * Конвейер, назначенный изданию поимённо, или null, если издания в списке нет.
 *
 * Отдельная функция от `bookAnalysisPipelineForEdition` нужна репозиторию:
 * при перезапуске прогона он наследует конвейер предыдущего, и «карточки
 * назначены этой книге» обязано быть сильнее наследования, иначе канареечная
 * книга, уже разобранная старым конвейером, останется на нём навсегда.
 * Настройка по умолчанию, наоборот, слабее наследования — поэтому её тут нет.
 */
export function bookAnalysisAssignedPipelineForEdition(
  bookEditionId,
  env = process.env,
  scope = null
) {
  const editions = bookAnalysisCardsEditionsFromEnv(env)
  if (bookEditionId && editions.has(String(bookEditionId).toLowerCase())) {
    return BOOK_ANALYSIS_PIPELINE_CARDS
  }
  return bookAnalysisPipelineForScope(scope, env)
}

/**
 * Конвейер по области видимости книги.
 *
 * Приватная книга — это загрузка живого человека, и ей нужен разбор, который
 * доходит до читателя быстро и стоит ровно столько, сколько человек прочитал:
 * окна карточек открываются за ним, а разметка публикуется по мере их
 * готовности. Каталог живёт по другим правилам — книга там разбирается один раз
 * на всех и целиком, — поэтому правило именно про область видимости, а не про
 * «новые книги».
 *
 * `BOOK_ANALYSIS_PIPELINE_PRIVATE=none` возвращает приватные книги к общей
 * настройке по умолчанию. Это путь отката, и он не требует выкладки кода.
 */
export function bookAnalysisPipelineForScope(scope, env = process.env) {
  if (scope !== 'private') return null
  const raw = String(env.BOOK_ANALYSIS_PIPELINE_PRIVATE || '').trim().toLowerCase()
  if (raw === 'none') return null
  if (!raw) return BOOK_ANALYSIS_PIPELINE_CARDS
  return normalizeBookAnalysisPipelineId(raw, 'BOOK_ANALYSIS_PIPELINE_PRIVATE')
}

/**
 * Конвейер конкретного издания: поимённый список сильнее настройки по
 * умолчанию, но только в одну сторону — назначить карточки. Снять конвейер,
 * заданный глобально, список не может: это делается той же настройкой, которой
 * он задан.
 */
export function bookAnalysisPipelineForEdition(bookEditionId, env = process.env) {
  return bookAnalysisAssignedPipelineForEdition(bookEditionId, env)
    ?? bookAnalysisPipelineFromEnv(env)
}

function narraScanJobs(chunks) {
  return chunks.map((chunk) => ({
    shardKey: `chunk:${chunk.ordinal}`,
    chunkId: chunk.id,
    payload: { chunkOrdinal: chunk.ordinal }
  }))
}

function externalScanJobs(chunks) {
  return [{
    shardKey: 'pipeline:external',
    chunkId: chunks[0].id,
    payload: { scope: 'book' }
  }]
}

async function reconcileNarraIdentities({
  input,
  entities,
  generator,
  reconciliationVersion,
  resolveEntities,
  log
}) {
  if (!generator) return { entities, acceptedIdentityMerges: [] }
  const characters = entities.filter(({ entityKind }) => entityKind === 'character')
  const recovery = characters.length >= 3
  const request = buildBookIdentityReconciliationRequest({
    ...input,
    entities,
    pipelineVersion: input.pipelineVersion,
    reconciliationVersion,
    recovery
  })
  if (!request) {
    log?.warn('resolve.identity_skipped', 'Глобальная сверка имён пропущена из-за лимитов', {
      run: input.runId,
      pipeline_id: input.pipelineId,
      character_count: entities.filter(({ entityKind }) => entityKind === 'character').length
    })
    return { entities, acceptedIdentityMerges: [] }
  }
  const proposed = await generator.reconcileBookCharacterIdentities(request)
  const acceptedIdentityMerges = validateBookIdentityMerges({
    request,
    proposedMerges: proposed.merges
  })
  const reconciled = acceptedIdentityMerges.length
    ? await resolveEntities({
        observations: input.observations,
        identityMerges: acceptedIdentityMerges
      })
    : entities
  log?.info('resolve.identity_reconciled', 'Имена персонажей сверены по всей книге', {
    run: input.runId,
    pipeline_id: input.pipelineId,
    proposed_merge_count: proposed.merges.length,
    accepted_merge_count: acceptedIdentityMerges.length,
    recovery
  })
  return { entities: reconciled, acceptedIdentityMerges }
}

async function reconcileExternalIdentities({ input, entities }) {
  const dialogueEvidenceIds = new Set((input?.observations ?? [])
    .filter(({ type }) => type === 'character_dialogue')
    .map(({ id }) => id))
  return {
    entities: entities.map((entity) =>
      entity.entityKind === 'character' &&
      entity.resolutionStatus !== 'rejected' &&
      entity.evidenceIds.some((id) => dialogueEvidenceIds.has(id))
        ? { ...entity, resolutionStatus: 'confirmed' }
        : entity
    ),
    acceptedIdentityMerges: []
  }
}

function narraProfileRequest(input) {
  const selectedEvidence = selectCharacterSynthesisEvidence(input.observations).map((observation) => ({
    id: observation.id,
    type: observation.type,
    fact: observation.fact,
    quote: observation.evidence.quote,
    startOffset: observation.evidence.startOffset,
    endOffset: observation.evidence.endOffset,
    confidence: observation.confidence
  }))
  return {
    selectedEvidence,
    entity: {
      entityKey: input.entity.entityKey,
      entityKind: input.entity.entityKind,
      canonicalName: input.entity.canonicalName,
      aliases: input.entity.aliases.slice(0, 16),
      resolutionStatus: input.entity.resolutionStatus,
      confidence: input.entity.confidence,
      evidenceIds: selectedEvidence.map(({ id }) => id),
      data: {
        observationCount: input.entity.data.observationCount,
        firstEvidenceStartOffset: input.entity.data.firstEvidenceStartOffset,
        lastEvidenceEndOffset: input.entity.data.lastEvidenceEndOffset
      }
    }
  }
}

async function synthesizeNarraCharacter({ input, generator, synthesisVersion }) {
  const request = narraProfileRequest(input)
  const generated = await generator.synthesizeCharacterProfile({
    runId: input.runId,
    snapshotId: input.snapshot.id,
    synthesisVersion,
    bookTitle: input.title,
    bookAuthor: input.author,
    textLength: input.textLength,
    entity: request.entity,
    evidence: request.selectedEvidence
  })
  return {
    synthesisVersion,
    selectedEvidenceIds: request.selectedEvidence.map(({ id }) => id),
    profile: generated.profile
  }
}

export function createExternalEvidenceOnlyCharacterProfile(observations) {
  if (!Array.isArray(observations)) throw new TypeError('observations must be an array')
  const dialogue = observations
    .filter((observation) =>
      observation?.type === 'character_dialogue' &&
      typeof observation?.evidence?.quote === 'string' &&
      observation.evidence.quote.length <= 4_000
    )
    .slice(0, 3)
  if (!dialogue.length) {
    throw Object.assign(new Error('external character has no exact dialogue evidence'), {
      code: 'SYNTHESIS_EVIDENCE_MISSING'
    })
  }
  return {
    synthesisVersion: EXTERNAL_EVIDENCE_PROFILE_VERSION,
    selectedEvidenceIds: dialogue.map(({ id }) => id),
    profile: {
      role: null,
      age: null,
      gender: null,
      description: null,
      traits: [],
      appearance: [],
      speechStyle: null,
      speechExamples: dialogue.map((observation) => ({
        value: observation.evidence.quote,
        evidenceIds: [observation.id],
        confidence: observation.confidence
      })),
      creative: { greeting: '', appearancePrompt: '', voice: '' }
    }
  }
}

async function synthesizeExternalCharacter({ input }) {
  return createExternalEvidenceOnlyCharacterProfile(input.observations)
}

const STRATEGIES = new Map([
  [BOOK_ANALYSIS_PIPELINE_NARRA, Object.freeze({
    id: BOOK_ANALYSIS_PIPELINE_NARRA,
    implementationVersion: BOOK_ANALYSIS_PIPELINE_VERSION,
    orchestrationVersion: BOOK_ANALYSIS_PIPELINE_VERSION,
    extractorVersion: BOOK_ANALYSIS_PROMPT_VERSION,
    synthesisVersion: BOOK_ANALYSIS_SYNTHESIS_VERSION,
    reconciliationVersion: BOOK_ANALYSIS_IDENTITY_RECONCILIATION_VERSION,
    normalizationVersion: BOOK_ANALYSIS_NORMALIZATION_VERSION,
    outputSchemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
    analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION,
    scanScope: 'chunk',
    createScanJobs: narraScanJobs,
    reconcileIdentities: reconcileNarraIdentities,
    synthesizeCharacter: synthesizeNarraCharacter,
    quality: Object.freeze({ requireTextCoverage: true })
  })],
  [BOOK_ANALYSIS_PIPELINE_EXTERNAL, Object.freeze({
    id: BOOK_ANALYSIS_PIPELINE_EXTERNAL,
    implementationVersion: EXTERNAL_PIPELINE_IMPLEMENTATION_VERSION,
    orchestrationVersion: BOOK_ANALYSIS_PIPELINE_VERSION,
    extractorVersion: EXTERNAL_ADAPTER_CONTRACT_VERSION,
    synthesisVersion: EXTERNAL_EVIDENCE_PROFILE_VERSION,
    reconciliationVersion: 'none',
    normalizationVersion: BOOK_ANALYSIS_NORMALIZATION_VERSION,
    outputSchemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
    analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION,
    scanScope: 'book',
    createScanJobs: externalScanJobs,
    reconcileIdentities: reconcileExternalIdentities,
    synthesizeCharacter: synthesizeExternalCharacter,
    quality: Object.freeze({ requireTextCoverage: false })
  })]
  ,[BOOK_ANALYSIS_PIPELINE_CARDS, Object.freeze({
    id: BOOK_ANALYSIS_PIPELINE_CARDS,
    implementationVersion: CARDS_PIPELINE_IMPLEMENTATION_VERSION,
    orchestrationVersion: BOOK_ANALYSIS_PIPELINE_VERSION,
    extractorVersion: CARDS_PIPELINE_INVENTORY_VERSION,
    synthesisVersion: CARDS_PIPELINE_CARD_VERSION,
    reconciliationVersion: CARDS_PIPELINE_CONFIRMATION_VERSION,
    normalizationVersion: BOOK_ANALYSIS_NORMALIZATION_VERSION,
    outputSchemaVersion: BOOK_ANALYSIS_SCHEMA_VERSION,
    analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION,
    scanScope: 'none',
    /**
     * Сканирующей стадии у этого конвейера нет: персонажей находит
     * детерминированный инвентарь в Prepare, а работа идёт заданиями
     * `generation_jobs`. Пока переход стадий прогона под это не подведён,
     * попытка создать scan-задания отказывает громко. Тихо вернуть пустой
     * список было бы хуже: прогон встал бы навсегда без единой строки в логе.
     */
    createScanJobs() {
      throw Object.assign(
        new Error('cards pipeline does not use scan jobs; stage flow is not wired yet'),
        { code: 'PIPELINE_STAGE_FLOW_UNWIRED' }
      )
    },
    reconcileIdentities() {
      throw Object.assign(
        new Error('cards pipeline reconciles identities in roster confirmation'),
        { code: 'PIPELINE_STAGE_FLOW_UNWIRED' }
      )
    },
    synthesizeCharacter() {
      throw Object.assign(
        new Error('cards pipeline synthesizes characters as character_card jobs'),
        { code: 'PIPELINE_STAGE_FLOW_UNWIRED' }
      )
    },
    quality: Object.freeze({ requireTextCoverage: true })
  })]
])

export function getBookAnalysisPipeline(value) {
  return STRATEGIES.get(normalizeBookAnalysisPipelineId(value))
}

export function bookAnalysisPipelineForRun(run) {
  const strategy = getBookAnalysisPipeline(run?.pipelineId ?? BOOK_ANALYSIS_PIPELINE_NARRA)
  const mismatches = [
    ['implementation', run?.pipelineImplementationVersion, strategy.implementationVersion],
    ['normalization', run?.normalizationVersion, strategy.normalizationVersion],
    ['schema', run?.outputSchemaVersion, strategy.outputSchemaVersion]
  ].filter(([, actual, expected]) => actual != null && actual !== expected)
  if (mismatches.length) {
    const error = new Error(
      `analysis run requires unsupported ${mismatches.map(([name]) => name).join(', ')} version`
    )
    error.code = 'PIPELINE_VERSION_UNSUPPORTED'
    throw error
  }
  return strategy
}

export function bookAnalysisPipelineCacheKey({
  pipelineId,
  contentHash,
  orchestrationVersion,
  extractorVersion,
  implementationVersion,
  normalizationVersion = BOOK_ANALYSIS_NORMALIZATION_VERSION,
  outputSchemaVersion = BOOK_ANALYSIS_SCHEMA_VERSION
}) {
  const strategy = getBookAnalysisPipeline(pipelineId)
  return [
    'book-analysis-cache',
    strategy.id,
    implementationVersion ?? strategy.implementationVersion,
    contentHash,
    orchestrationVersion ?? strategy.orchestrationVersion,
    extractorVersion ?? strategy.extractorVersion,
    normalizationVersion,
    `schema-${outputSchemaVersion}`,
    BOOK_ANALYSIS_MARKUP_VERSION
  ].join(':')
}

export function bookAnalysisPublicationProvenance(run) {
  const strategy = getBookAnalysisPipeline(run.pipelineId)
  return {
    pipelineId: strategy.id,
    pipelineImplementationVersion: run.pipelineImplementationVersion,
    orchestrationVersion: run.pipelineVersion,
    extractorVersion: run.promptVersion,
    normalizationVersion: run.normalizationVersion,
    schemaVersion: run.outputSchemaVersion,
    analysisVersion: BOOK_ANALYSIS_MARKUP_VERSION,
    sourceContentHash: run.inputHash,
    normalizedTextHash: run.normalizedTextHash
  }
}
