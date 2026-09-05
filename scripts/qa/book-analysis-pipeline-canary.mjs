// Bounded own-fixture pipeline canary. Live requires explicit --stage-live and
// external approval for every exact request. No production config/DB autodetection.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { once, EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { runBookMarkupMigrations } from '../../services/narra-gateway/postgres-runtime.mjs';
import { createPostgresBookAnalysisRepository } from '../../services/narra-gateway/book-analysis-repository.mjs';
import { createBookAnalysisPrepareWorker } from '../../services/narra-gateway/book-analysis-prepare-worker.mjs';
import { createBookAnalysisScanWorker } from '../../services/narra-gateway/book-analysis-scan-worker.mjs';
import { createBookAnalysisResolveWorker } from '../../services/narra-gateway/book-analysis-resolve-worker.mjs';
import { createBookAnalysisSynthesizeWorker } from '../../services/narra-gateway/book-analysis-synthesize-worker.mjs';
import { createBookAnalysisValidateWorker } from '../../services/narra-gateway/book-analysis-validate-worker.mjs';
import { createBookAnalysisPublishWorker } from '../../services/narra-gateway/book-analysis-publish-worker.mjs';
import { createInternalGenerationService, createInternalGenerationRouter } from '../../services/narra-gateway/internal-generation-service.mjs';
import { createGenerationServiceClient } from '../../services/narra-gateway/generation-service-client.mjs';
import { MULTICHUNK_FIXTURE, createMultichunkFixtureModel, assertMultichunkAcceptance } from './multichunk-book-fixture.mjs';

const requireGateway = createRequire(new URL('../../services/narra-gateway/package.json', import.meta.url));
const quiet = { info() {}, warn() {}, error() {} };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const FIXTURE = 'Анна всегда была честной. Однажды Анна торопливо закрыла окно.';
const TRAIT_QUOTE = 'Анна всегда была честной.';
const ACTION_QUOTE = 'Однажды Анна торопливо закрыла окно.';

export function validateDedicatedDatabase(databaseUrl, confirmation) {
  if (!databaseUrl) throw new Error('Explicit QA_DB_URL is required; no DATABASE_URL fallback');
  let url;
  try { url = new URL(databaseUrl); } catch { throw new Error('Invalid QA_DB_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash) {
    throw new Error('QA_DB_URL must use literal loopback PostgreSQL, without query overrides');
  }
  const database = url.pathname.slice(1);
  if (!/^narra_qa_pipeline_[a-z0-9_]{6,40}$/.test(database) || confirmation !== database) {
    throw new Error('Dedicated narra_qa_pipeline_<suffix> database and exact QA_DB_CONFIRM are required');
  }
  return { databaseUrl, database };
}

export function memoryObjectStorage() {
  const objects = new Map();
  return {
    async getBytesRange({ objectKey, startByte, endByteExclusive, maxBytes = 64 * 1024 * 1024 }) {
      if (!Number.isSafeInteger(startByte) || startByte < 0 || !Number.isSafeInteger(endByteExclusive) || endByteExclusive <= startByte) {
        throw new Error('byte range is invalid');
      }
      const expectedBytes = endByteExclusive - startByte;
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 512 * 1024 * 1024 || expectedBytes > maxBytes) {
        throw new Error('object range exceeds the allowed read size');
      }
      const object = objects.get(objectKey);
      if (!object) throw Object.assign(new Error('Missing fixture object'), { name: 'NoSuchKey' });
      const bytes = Buffer.from(object.bytes.subarray(startByte, endByteExclusive));
      if (bytes.length !== expectedBytes) throw Object.assign(new Error('object storage returned an unexpected byte range'), { code: 'STORAGE_RANGE_INTEGRITY' });
      return { bytes, mimeType: object.mimeType, metadata: { ...object.metadata } };
    },
    async getBytes({ objectKey, maxBytes = Infinity }) {
      const object = objects.get(objectKey);
      if (!object) throw Object.assign(new Error('Missing fixture object'), { name: 'NoSuchKey' });
      if (object.bytes.length > maxBytes) throw new Error('Fixture object exceeds read bound');
      return { ...object, bytes: Buffer.from(object.bytes) };
    },
    async putBytes({ objectKey, bytes, mimeType }) {
      const copied = Buffer.from(bytes);
      objects.set(objectKey, { bytes: copied, mimeType, metadata: {} });
      return { objectKey, contentHash: hash(copied), byteSize: copied.length, mimeType };
    },
  };
}

function field(input, name, fallback) {
  const line = input.messages[1].content.split('\n').find(value => value.startsWith(`${name}: `));
  return line ? JSON.parse(line.slice(name.length + 2)) : fallback;
}

export function createFixtureModel(calls = []) {
  return async input => {
    const operation = input.costContext?.operation;
    calls.push({ operation, messagesBytes: Buffer.byteLength(JSON.stringify(input.messages)) });
    if (calls.length > 8) throw new Error('Fixture exceeded bounded mock call budget');
    if (operation === 'scan_book_chunk') return JSON.stringify({ observations: [
      { type: 'character_trait', entityKind: 'character', entityCandidate: 'Анна', relatedEntityCandidates: [], fact: 'Анна честная', evidence: { quote: TRAIT_QUOTE }, confidence: 0.98 },
      { type: 'character_action', entityKind: 'character', entityCandidate: 'Анна', relatedEntityCandidates: [], fact: 'Анна торопливо закрыла окно', evidence: { quote: ACTION_QUOTE }, confidence: 0.98 },
    ] });
    if (operation === 'reconcile_character_identities') return '{"merges":[]}';
    const evidence = field(input, 'EVIDENCE', []);
    if (operation === 'synthesize_character_profile') {
      const trait = evidence.find(item => item.type === 'character_trait');
      const action = evidence.find(item => item.type === 'character_action');
      assert.ok(trait && action, 'worker must deliver both actual scan observations');
      return JSON.stringify({
        traits: [
          { value: 'честная', evidenceIds: [trait.id], confidence: 0.98 },
          // Deliberately wrong candidate: the actual strict audit/filter must remove it.
          { value: 'тревожная', evidenceIds: [action.id], confidence: 0.9 },
        ],
        description: { value: 'Анна честная. Однажды она торопливо закрыла окно.', evidenceIds: [trait.id, action.id], confidence: 0.95 },
        personalitySnapshots: field(input, 'PERSONALITY_CHECKPOINTS', []).map(checkpoint => ({
          cutoffTextOffset: checkpoint.cutoffTextOffset,
          traits: [{ value: 'честная', evidenceIds: [trait.id], confidence: 0.6 }],
        })),
        creative: { greeting: 'Здравствуйте. Я Анна.', appearancePrompt: '', voice: '' },
      });
    }
    if (operation === 'recall_character_traits') return '{"traits":[]}';
    if (operation === 'audit_character_profile') {
      const candidate = field(input, 'CANDIDATE_PROFILE', {});
      return JSON.stringify({
        traits: candidate.traits.flatMap((trait, index) => trait.value === 'честная' ? [{ index, evidenceIds: trait.evidenceIds }] : []),
        description: candidate.description ? { value: candidate.description.value, evidenceIds: candidate.description.evidenceIds } : null,
      });
    }
    throw new Error(`Unexpected mock operation: ${operation}`);
  };
}

export function createCanaryWorkers(common) {
  return [
    createBookAnalysisPrepareWorker(common), createBookAnalysisScanWorker(common), createBookAnalysisResolveWorker(common),
    createBookAnalysisSynthesizeWorker(common), createBookAnalysisValidateWorker(common), createBookAnalysisPublishWorker(common),
  ];
}

export function assertFixtureSemanticAcceptance({ observations, traits, live = false }) {
  if (!live) assert.equal(observations.length, 2);
  for (const observation of observations) {
    const start = Number(observation.evidence_start_offset);
    const end = Number(observation.evidence_end_offset);
    assert.ok(Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(end) && end > start && end <= FIXTURE.length,
      'observation must have valid exact-source offsets');
    assert.equal(FIXTURE.slice(start, end), observation.evidence_quote, 'unanchored observation');
  }
  if (!live) {
    assert.deepEqual(traits.map(trait => trait.value), ['честная']);
    return;
  }
  // Additional grounded scan observations are legal. The fixed story supports
  // one stable trait, not a new personality inferred from closing one window.
  const stableEvidence = observations.filter(observation => observation.observation_type === 'character_trait'
    && Number(observation.evidence_start_offset) < TRAIT_QUOTE.length && /честн/iu.test(observation.evidence_quote));
  assert.ok(stableEvidence.length > 0, 'live scan must retain grounded stable-trait evidence');
  assert.ok(observations.some(observation => observation.observation_type === 'character_action'
    && /закрыла окно/iu.test(observation.evidence_quote)), 'live scan must retain grounded action evidence');
  assert.ok(Array.isArray(traits) && traits.length > 0, 'live profile must retain honesty');
  const accepted = new Set(['честная', 'честный', 'честность']);
  for (const trait of traits) {
    assert.ok(typeof trait.value === 'string' && accepted.has(trait.value.trim().toLocaleLowerCase('ru-RU')),
      'unsupported personality trait for this fixture');
    assert.ok(Array.isArray(trait.evidenceIds) && trait.evidenceIds.length > 0
      && trait.evidenceIds.every(id => observations.some(observation => observation.id === id))
      && trait.evidenceIds.some(id => stableEvidence.some(observation => observation.id === id)),
    'personality trait must cite the grounded stable assertion, not only an action');
  }
}

export async function runPipelineCanary({ databaseUrl, confirmation, stagedMock = false, stagedLive = false, onCapture, signal, fixtureId = 'window' } = {}) {
  if (typeof stagedMock !== 'boolean' || typeof stagedLive !== 'boolean' || (stagedMock && stagedLive)) throw new Error('Choose exactly one staged mode');
  if (!['window', 'siblings'].includes(fixtureId)) throw new Error('Unknown own fixture');
  if (fixtureId === 'siblings' && stagedLive) throw new Error('Multi-chunk fixture is mock-only until its separate staged plan and live quality gate are reviewed');
  const multichunk = fixtureId === 'siblings';
  const fixture = multichunk ? MULTICHUNK_FIXTURE : FIXTURE;
  const target = validateDedicatedDatabase(databaseUrl, confirmation);
  const { Pool } = requireGateway('pg');
  const pool = new Pool({ connectionString: target.databaseUrl, ssl: false, max: 4, connectionTimeoutMillis: 3000, statement_timeout: 10000 });
  let lock; let server; let staged; let seeded = false;
  const editionId = randomUUID();
  try {
    lock = await pool.connect();
    const guard = await lock.query('SELECT current_database() AS name, pg_try_advisory_lock(913576421) AS acquired');
    assert.equal(guard.rows[0].name, target.database);
    assert.equal(guard.rows[0].acquired, true, 'another pipeline canary owns this database');
    const existing = await lock.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')");
    assert.equal(existing.rows[0].count, 0, 'Refusing nonempty database; create a fresh dedicated canary DB');
    await runBookMarkupMigrations(pool, { logger: quiet });
    const storage = memoryObjectStorage();
    const sourceKey = `canary/${editionId}/source.txt`;
    const source = await storage.putBytes({ objectKey: sourceKey, bytes: Buffer.from(fixture), mimeType: 'text/plain' });
    await pool.query("INSERT INTO book_editions(id,scope,owner_subject_id,content_sha256,title,author,format,status,source_storage,expires_at) VALUES($1,'private',$2,$3,'Окно','QA','txt','marking_up','temporary',now() + interval '1 day')", [editionId, randomUUID(), source.contentHash]);
    seeded = true;
    const retention = (await pool.query("SELECT source_storage, expires_at > now() AS unexpired FROM book_editions WHERE id=$1", [editionId])).rows[0];
    assert.deepEqual(retention, { source_storage: 'temporary', unexpired: true });
    await pool.query("INSERT INTO book_files(book_edition_id,object_key,mime_type,byte_size,content_hash,status) VALUES($1,$2,'text/plain',$3,$4,'ready')", [editionId, sourceKey, source.byteSize, source.contentHash]);
    const repository = createPostgresBookAnalysisRepository(pool, { mediaGenerationEnabled: false });
    const ensured = await repository.ensureAnalysisRun({ bookEditionId: editionId, inputHash: source.contentHash, pipelineId: 'narra' });
    const runId = ensured.run.id;
    const calls = [];
    const mock = multichunk ? createMultichunkFixtureModel(calls) : createFixtureModel(calls);
    let completeChat = mock;
    if (stagedMock || stagedLive) {
      // Ordinary mock CI must not load machine-specific subscription tooling.
      const { createStagedFixtureProvider } = await import('./staged-fixture-provider.mjs');
      let pendingInput;
      staged = await createStagedFixtureProvider({ fixtureId, mode: stagedLive ? 'live' : 'mock', signal, approvalTimeoutMs: 90000, onCapture,
        ...(stagedMock ? {
        spawnFixtureChild() {
          const child = new EventEmitter();
          child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
          let closed = false;
          const close = code => { if (!closed) { closed = true; child.emit('close', code); } };
          child.kill = () => { setImmediate(() => close(null)); return true; };
          child.stdin.on('finish', () => setImmediate(async () => {
            if (closed) return;
            try {
              const text = await mock(pendingInput);
              child.stdout.end(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } })}\n${JSON.stringify({ type: 'turn.completed' })}\n`);
              close(0);
            } catch { close(1); }
          }));
          return child;
        }, } : {}),
      });
      completeChat = input => {
        pendingInput = input;
        if (stagedLive) calls.push({ operation: input.costContext?.operation, messagesBytes: Buffer.byteLength(JSON.stringify(input.messages)) });
        return staged.completeChat(input);
      };
    }
    const forbiddenMedia = async () => { throw new Error('Media must never run in pipeline canary'); };
    const service = createInternalGenerationService({ storage, completeChat, generatePortrait: forbiddenMedia, synthesizeSpeech: forbiddenMedia, generateIdleAnimation: forbiddenMedia, logger: quiet });
    const token = randomBytes(32).toString('hex');
    const app = requireGateway('express')();
    app.use('/internal', createInternalGenerationRouter({ token, service, logger: quiet }));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    // Up to three profile phases × (90s review + 50s bridge) = 420s.
    // QA-only 450s client / 480s lease remain under the router's 600s deadline.
    const generator = createGenerationServiceClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token, timeoutMs: staged ? 450000 : 5000, production: false });
    const common = { repository, storage, generator, runIds: [runId], workerId: `canary-${runId}`, logger: quiet,
      ...(staged ? { leaseSeconds: 480, leaseRenewMs: 30000 } : {}) };
    const workers = createCanaryWorkers(common);
    const lifecycle = [];
    const sequence = multichunk ? [0, 1, 1, 1, 2, 3, 3, 3, 4, 5] : [0, 1, 2, 3, 3, 4, 5];
    for (const index of sequence) {
      signal?.throwIfAborted();
      const result = await workers[index].runOnce();
      lifecycle.push(result);
      assert.equal(result.status, 'completed', `worker ${index}: ${JSON.stringify(result)}`);
    }
    const run = (await pool.query('SELECT status, stage, text_length FROM book_analysis_runs WHERE id=$1', [runId])).rows[0];
    assert.equal(run.status, 'ready');
    const observations = (await pool.query('SELECT id, observation_type, entity_candidate, evidence_quote, evidence_start_offset, evidence_end_offset FROM book_analysis_observations WHERE run_id=$1 ORDER BY evidence_start_offset', [runId])).rows;
    const artifacts = (await pool.query('SELECT artifact_kind,status,data FROM book_analysis_artifacts WHERE run_id=$1', [runId])).rows;
    const profile = artifacts.find(row => row.artifact_kind === 'character_profile');
    assert.ok(profile);
    if (!multichunk) assertFixtureSemanticAcceptance({ observations, traits: profile.data.profile.traits, live: stagedLive });
    const profiles = artifacts.filter(row => row.artifact_kind === 'character_profile');
    for (const item of profiles) assert.ok(item.data.selectedEvidenceIds.every(id => observations.some(row => row.id === id)));
    assert.equal(artifacts.find(row => row.artifact_kind === 'validation_report')?.data.valid, true);
    assert.equal(artifacts.find(row => row.artifact_kind === 'book_markup')?.status, 'published');
    const publications = (await pool.query('SELECT data FROM book_analysis_publications WHERE run_id=$1', [runId])).rows;
    assert.equal(publications.length, 1);
    assert.equal(publications[0].data.markup.characters.length, multichunk ? 2 : 1);
    const chunks = (await pool.query('SELECT core_start_offset,core_end_offset,context_start_offset,context_end_offset FROM book_analysis_chunks WHERE run_id=$1 ORDER BY ordinal', [runId])).rows;
    if (multichunk) assertMultichunkAcceptance({ observations, profiles, markup: publications[0].data.markup, chunks });
    const replay = await repository.ensureAnalysisRun({ bookEditionId: editionId, inputHash: source.contentHash, pipelineId: 'narra' });
    assert.equal(replay.run.id, runId);
    const beforeReplay = calls.length;
    for (const worker of workers) assert.equal((await worker.runOnce()).status, 'idle');
    assert.equal(calls.length, beforeReplay);
    assert.equal(calls.filter(call => call.operation === 'scan_book_chunk').length, multichunk ? 3 : 1);
    for (const operation of ['synthesize_character_profile', 'recall_character_traits', 'audit_character_profile']) assert.equal(calls.filter(call => call.operation === operation).length, multichunk ? 2 : 1);
    return { live: stagedLive, fixtureId, chunkCount: chunks.length, characterCount: profiles.length, database: target.database, runId, fixtureHash: source.contentHash, calls,
      ...(staged ? { approvalDirectory: staged.directory, staged: staged.status() } : {}),
      jobsCompleted: lifecycle.length, observations: observations.length, publications: publications.length,
      traits: profiles.flatMap(item => item.data.profile.traits.map(trait => trait.value)), idempotent: true,
      scope: `actual workers -> PostgreSQL repository -> loopback generator client/router -> actual internal service with ${stagedLive ? 'separately approved live fixture calls; only this short fixture is tested' : 'mock LLM; not live quality evidence'}` };
  } finally {
    try { await staged?.close(); }
    finally {
      if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
      try { if (seeded) await pool.query('DELETE FROM book_editions WHERE id=$1', [editionId]); }
      finally { if (lock) { await lock.query('SELECT pg_advisory_unlock(913576421)').catch(() => {}); lock.release(); } await pool.end(); }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some(flag => !['--run-mock', '--run-multichunk-mock', '--stage-mock', '--stage-live', '--dry-run', '--help'].includes(flag))) throw new Error('Use one of --run-mock, --run-multichunk-mock, --stage-mock, --stage-live, --dry-run or --help');
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Canary interrupted'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { console.log(JSON.stringify(['--run-mock', '--run-multichunk-mock', '--stage-mock', '--stage-live'].includes(flags[0])
    ? await runPipelineCanary({ databaseUrl: process.env.QA_DB_URL, confirmation: process.env.QA_DB_CONFIRM,
      fixtureId: flags[0] === '--run-multichunk-mock' ? 'siblings' : 'window',
      stagedMock: flags[0] === '--stage-mock', stagedLive: flags[0] === '--stage-live', signal: controller.signal,
      onCapture: metadata => console.log(JSON.stringify(metadata)) })
    : { live: false, dryRun: true, fixture: FIXTURE, fixtureHash: hash(FIXTURE),
      command: 'QA_DB_URL=postgresql://USER@127.0.0.1:PORT/narra_qa_pipeline_SUFFIX QA_DB_CONFIRM=narra_qa_pipeline_SUFFIX node scripts/qa/book-analysis-pipeline-canary.mjs --run-mock',
      requirements: 'Fresh empty dedicated database; schema migrations remain, own edition rows deleted on exit. Default/dry/mock never execute live models. Only --stage-live enables live execution after externally written step approval (90s deadline). Inspect manifest, exact body and prior response, then create private approval JSON {approved:true,index,sha256,nonce}. Controller never writes approval. Maximum4 calls, pinned own fixture/model.' })); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
