// Mock-model pipeline canary. No live AI, bridge, production configuration or DB autodetection.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
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

export async function runPipelineCanary({ databaseUrl, confirmation } = {}) {
  const target = validateDedicatedDatabase(databaseUrl, confirmation);
  const { Pool } = requireGateway('pg');
  const pool = new Pool({ connectionString: target.databaseUrl, ssl: false, max: 4, connectionTimeoutMillis: 3000, statement_timeout: 10000 });
  let lock; let server; let seeded = false;
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
    const source = await storage.putBytes({ objectKey: sourceKey, bytes: Buffer.from(FIXTURE), mimeType: 'text/plain' });
    await pool.query("INSERT INTO book_editions(id,scope,owner_subject_id,content_sha256,title,author,format,status,source_storage,expires_at) VALUES($1,'private',$2,$3,'Окно','QA','txt','marking_up','temporary',now() + interval '1 day')", [editionId, randomUUID(), source.contentHash]);
    seeded = true;
    const retention = (await pool.query("SELECT source_storage, expires_at > now() AS unexpired FROM book_editions WHERE id=$1", [editionId])).rows[0];
    assert.deepEqual(retention, { source_storage: 'temporary', unexpired: true });
    await pool.query("INSERT INTO book_files(book_edition_id,object_key,mime_type,byte_size,content_hash,status) VALUES($1,$2,'text/plain',$3,$4,'ready')", [editionId, sourceKey, source.byteSize, source.contentHash]);
    const repository = createPostgresBookAnalysisRepository(pool, { mediaGenerationEnabled: false });
    const ensured = await repository.ensureAnalysisRun({ bookEditionId: editionId, inputHash: source.contentHash, pipelineId: 'narra' });
    const runId = ensured.run.id;
    const calls = [];
    const forbiddenMedia = async () => { throw new Error('Media must never run in pipeline canary'); };
    const service = createInternalGenerationService({ storage, completeChat: createFixtureModel(calls), generatePortrait: forbiddenMedia, synthesizeSpeech: forbiddenMedia, generateIdleAnimation: forbiddenMedia, logger: quiet });
    const token = randomBytes(32).toString('hex');
    const app = requireGateway('express')();
    app.use('/internal', createInternalGenerationRouter({ token, service, logger: quiet }));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const generator = createGenerationServiceClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token, timeoutMs: 5000, production: false });
    const common = { repository, storage, generator, runIds: [runId], workerId: `canary-${runId}`, logger: quiet };
    const workers = createCanaryWorkers(common);
    const lifecycle = [];
    for (const index of [0, 1, 2, 3, 3, 4, 5]) {
      const result = await workers[index].runOnce();
      lifecycle.push(result);
      assert.equal(result.status, 'completed', `worker ${index}: ${JSON.stringify(result)}`);
    }
    const run = (await pool.query('SELECT status, stage, text_length FROM book_analysis_runs WHERE id=$1', [runId])).rows[0];
    assert.equal(run.status, 'ready');
    const observations = (await pool.query('SELECT id, evidence_quote, evidence_start_offset, evidence_end_offset FROM book_analysis_observations WHERE run_id=$1 ORDER BY evidence_start_offset', [runId])).rows;
    assert.equal(observations.length, 2);
    for (const observation of observations) assert.equal(FIXTURE.slice(Number(observation.evidence_start_offset), Number(observation.evidence_end_offset)), observation.evidence_quote);
    const artifacts = (await pool.query('SELECT artifact_kind,status,data FROM book_analysis_artifacts WHERE run_id=$1', [runId])).rows;
    const profile = artifacts.find(row => row.artifact_kind === 'character_profile');
    assert.ok(profile);
    assert.deepEqual(profile.data.profile.traits.map(trait => trait.value), ['честная']);
    assert.ok(profile.data.selectedEvidenceIds.every(id => observations.some(row => row.id === id)));
    assert.equal(artifacts.find(row => row.artifact_kind === 'validation_report')?.data.valid, true);
    assert.equal(artifacts.find(row => row.artifact_kind === 'book_markup')?.status, 'published');
    const publications = (await pool.query('SELECT data FROM book_analysis_publications WHERE run_id=$1', [runId])).rows;
    assert.equal(publications.length, 1);
    assert.equal(publications[0].data.markup.characters.length, 1);
    const replay = await repository.ensureAnalysisRun({ bookEditionId: editionId, inputHash: source.contentHash, pipelineId: 'narra' });
    assert.equal(replay.run.id, runId);
    const beforeReplay = calls.length;
    for (const worker of workers) assert.equal((await worker.runOnce()).status, 'idle');
    assert.equal(calls.length, beforeReplay);
    assert.equal(calls.filter(call => call.operation === 'scan_book_chunk').length, 1);
    for (const operation of ['synthesize_character_profile', 'recall_character_traits', 'audit_character_profile']) assert.equal(calls.filter(call => call.operation === operation).length, 1);
    return { live: false, database: target.database, runId, fixtureHash: source.contentHash, calls,
      jobsCompleted: lifecycle.length, observations: observations.length, publications: publications.length,
      traits: profile.data.profile.traits.map(trait => trait.value), idempotent: true,
      scope: 'actual workers -> PostgreSQL repository -> loopback generator client/router -> actual internal service with mock LLM; not live quality evidence' };
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    try { if (seeded) await pool.query('DELETE FROM book_editions WHERE id=$1', [editionId]); }
    finally { if (lock) { await lock.query('SELECT pg_advisory_unlock(913576421)').catch(() => {}); lock.release(); } await pool.end(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some(flag => !['--run-mock', '--dry-run', '--help'].includes(flag))) throw new Error('Only --run-mock, --dry-run or --help are supported; no live mode');
  console.log(JSON.stringify(flags[0] === '--run-mock'
    ? await runPipelineCanary({ databaseUrl: process.env.QA_DB_URL, confirmation: process.env.QA_DB_CONFIRM })
    : { live: false, dryRun: true, fixture: FIXTURE, fixtureHash: hash(FIXTURE),
      command: 'QA_DB_URL=postgresql://USER@127.0.0.1:PORT/narra_qa_pipeline_SUFFIX QA_DB_CONFIRM=narra_qa_pipeline_SUFFIX node scripts/qa/book-analysis-pipeline-canary.mjs --run-mock',
      requirements: 'Fresh empty dedicated database; schema migrations remain, own edition rows are deleted on exit. No DB auto-discovery. No live model calls. Staged capture-stop not implemented.' }));
}
