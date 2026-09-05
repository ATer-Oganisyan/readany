import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateDedicatedDatabase, runPipelineCanary, memoryObjectStorage, createFixtureModel, createCanaryWorkers, FIXTURE } from './book-analysis-pipeline-canary.mjs';
import { createGenerationServiceClient } from '../../services/narra-gateway/generation-service-client.mjs';
import { createInternalGenerationService } from '../../services/narra-gateway/internal-generation-service.mjs';
import { BOOK_ANALYSIS_SYNTHESIS_VERSION } from '../../services/narra-gateway/book-analysis-contracts.mjs';

test('DB guard requires explicit local dedicated name and matching confirmation; no query overrides', async () => {
  const name = 'narra_qa_pipeline_abcdef';
  assert.equal(validateDedicatedDatabase(`postgresql://qa@127.0.0.1:5432/${name}`, name).database, name);
  for (const url of [undefined, '', 'not-a-url', `https://127.0.0.1/${name}`, `postgresql://example.com/${name}`,
    `postgresql://localhost/${name}`, 'postgresql://127.0.0.1/postgres', `postgresql://127.0.0.1/${name}?host=remote`,
    `postgresql://127.0.0.1/${name}#fragment`, 'postgresql://127.0.0.1/narra_qa_pipeline_%61bcdef']) {
    assert.throws(() => validateDedicatedDatabase(url, name));
  }
  assert.throws(() => validateDedicatedDatabase(`postgresql://127.0.0.1/${name}`, 'wrong'));
  await assert.rejects(runPipelineCanary(), /Explicit QA_DB_URL/);
});

test('own fixture passes actual scan and v14 profile gates with mock model, no database or network', async () => {
  const calls = [];
  const unused = async () => { throw new Error('unexpected media'); };
  const service = createInternalGenerationService({ storage: memoryObjectStorage(), completeChat: createFixtureModel(calls),
    generatePortrait: unused, synthesizeSpeech: unused, generateIdleAnimation: unused,
    logger: { info() {}, warn() {}, error() {} } });
  const scan = await service.scanBookChunk({ idempotencyKey: 'canary:scan:chunk:book-scan-v1', runId: 'canary', chunkId: 'chunk', extractorVersion: 'book-scan-v1',
    bookTitle: 'Окно', bookAuthor: 'QA', sectionTitles: [], contextText: FIXTURE, coreLocalStartOffset: 0, coreLocalEndOffset: FIXTURE.length });
  assert.equal(scan.observations.length, 2);
  const evidence = scan.observations.map(observation => ({ id: randomUUID(), type: observation.type, fact: observation.fact,
    quote: observation.evidence.quote, startOffset: observation.evidence.startOffset, endOffset: observation.evidence.endOffset, confidence: observation.confidence }));
  for (const item of evidence) assert.equal(FIXTURE.slice(item.startOffset, item.endOffset), item.quote);
  const request = { idempotencyKey: `canary:synthesize:snapshot:character:anna:${BOOK_ANALYSIS_SYNTHESIS_VERSION}`, runId: 'canary', snapshotId: 'snapshot',
    synthesisVersion: BOOK_ANALYSIS_SYNTHESIS_VERSION, bookTitle: 'Окно', bookAuthor: 'QA', textLength: FIXTURE.length,
    entity: { entityKey: 'character:anna', entityKind: 'character', canonicalName: 'Анна', aliases: [], resolutionStatus: 'confirmed', confidence: 0.98,
      evidenceIds: evidence.map(item => item.id), data: { firstEvidenceStartOffset: 0 } }, evidence };
  const first = await service.synthesizeCharacterProfile(request);
  assert.deepEqual(first.profile.traits.map(trait => trait.value), ['честная']);
  assert.deepEqual(await service.synthesizeCharacterProfile(request), first);
  assert.deepEqual(calls.map(call => call.operation), ['scan_book_chunk', 'synthesize_character_profile', 'recall_character_traits', 'audit_character_profile']);
});

test('all six actual worker factories accept canary dependencies before any DB provisioning', async () => {
  const workers = createCanaryWorkers({
    repository: { async claimAnalysisJob() { return null; } }, storage: memoryObjectStorage(),
    generator: createGenerationServiceClient({ baseUrl: 'http://127.0.0.1:1', token: 'a'.repeat(64), production: false,
      fetchImpl: async () => assert.fail('idle factory preflight must never make HTTP requests') }),
    workerId: 'dependency-preflight', runIds: [randomUUID()], logger: { info() {}, warn() {}, error() {} },
  });
  assert.equal(workers.length, 6);
  for (const worker of workers) assert.equal((await worker.runOnce()).status, 'idle');
});

test('memory object ranges use UTF8 bytes, exact bounds, bounded sizes and defensive copies', async () => {
  const storage = memoryObjectStorage();
  const bytes = Buffer.from('АБВ');
  await storage.putBytes({ objectKey: 'range', bytes, mimeType: 'text/plain' });
  const request = { objectKey: 'range', startByte: 2, endByteExclusive: 4, maxBytes: 2 };
  const selected = await storage.getBytesRange(request);
  assert.equal(selected.bytes.toString('utf8'), 'Б');
  assert.equal(selected.mimeType, 'text/plain');
  selected.bytes.fill(0);
  assert.equal((await storage.getBytesRange(request)).bytes.toString('utf8'), 'Б');
  for (const overrides of [{ startByte: -1 }, { startByte: 0.5 }, { endByteExclusive: 2 }, { maxBytes: 1 }, { maxBytes: NaN }]) {
    await assert.rejects(storage.getBytesRange({ ...request, ...overrides }));
  }
  await assert.rejects(storage.getBytesRange({ ...request, endByteExclusive: 8, maxBytes: 10 }), error => error.code === 'STORAGE_RANGE_INTEGRITY');
  await assert.rejects(storage.getBytesRange({ ...request, objectKey: 'missing' }), error => error.name === 'NoSuchKey');
});

test('actual sequential workers, repository, dedicated PostgreSQL and local generator HTTP lifecycle', {
  skip: !process.env.QA_DB_URL ? 'requires explicitly provisioned empty dedicated QA_DB_URL and QA_DB_CONFIRM' : false,
  timeout: 60000,
}, async () => {
  const result = await runPipelineCanary({ databaseUrl: process.env.QA_DB_URL, confirmation: process.env.QA_DB_CONFIRM });
  assert.equal(result.live, false);
  assert.equal(result.jobsCompleted, 7);
  assert.equal(result.observations, 2);
  assert.equal(result.publications, 1);
  assert.equal(result.idempotent, true);
  assert.deepEqual(result.traits, ['честная']);
});
