import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { validateDedicatedDatabase, runPipelineCanary, memoryObjectStorage, createFixtureModel, createCanaryWorkers, assertFixtureSemanticAcceptance, FIXTURE } from './book-analysis-pipeline-canary.mjs';
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
  await assert.rejects(runPipelineCanary({ stagedLive: true, stagedMock: true }), /one staged mode/);
});

test('own fixture passes actual scan and current profile gates with mock model, no database or network', async () => {
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

test('live gold accepts grounded extra observations and honesty morphology, while mock stays exact', () => {
  const boundary = FIXTURE.indexOf(' Однажды');
  const observations = [
    { id: 'trait', observation_type: 'character_trait', evidence_quote: FIXTURE.slice(0, boundary), evidence_start_offset: 0, evidence_end_offset: boundary },
    { id: 'action', observation_type: 'character_action', evidence_quote: FIXTURE.slice(boundary + 1), evidence_start_offset: boundary + 1, evidence_end_offset: FIXTURE.length },
  ];
  const extra = { id: 'mention', observation_type: 'character_mention', evidence_quote: 'Анна', evidence_start_offset: 0, evidence_end_offset: 4 };
  const traits = value => [{ value, evidenceIds: ['trait'] }];
  for (const value of ['честная', 'ЧЕСТНЫЙ', ' честность ']) {
    assert.doesNotThrow(() => assertFixtureSemanticAcceptance({ observations: [...observations, extra], traits: traits(value), live: true }));
  }
  assert.doesNotThrow(() => assertFixtureSemanticAcceptance({ observations, traits: traits('честная') }));
  assert.throws(() => assertFixtureSemanticAcceptance({ observations: [...observations, extra], traits: traits('честная') }));
  assert.throws(() => assertFixtureSemanticAcceptance({ observations, traits: traits('честность') }));
  for (const invalid of [[], traits('тревожная'), traits('честная и решительная'), [{ value: 'честная', evidenceIds: ['action'] }], [{ value: 'честная', evidenceIds: ['missing'] }]]) {
    assert.throws(() => assertFixtureSemanticAcceptance({ observations, traits: invalid, live: true }));
  }
  assert.throws(() => assertFixtureSemanticAcceptance({ observations: [{ ...observations[0], evidence_quote: 'Анна была тревожной.' }, observations[1]], traits: traits('честная'), live: true }), /unanchored/);
  assert.throws(() => assertFixtureSemanticAcceptance({ observations: [{ ...observations[0], observation_type: 'character_mention' }, observations[1]], traits: traits('честная'), live: true }), /stable-trait evidence/);
  assert.throws(() => assertFixtureSemanticAcceptance({ observations: [observations[0], { ...observations[1], observation_type: 'character_mention' }], traits: traits('честная'), live: true }), /action evidence/);
});

test('actual sequential workers, repository, dedicated PostgreSQL and local generator HTTP lifecycle', {
  skip: !process.env.QA_DB_URL ? 'requires explicitly provisioned empty dedicated QA_DB_URL and QA_DB_CONFIRM' : false,
  timeout: 60000,
}, async () => {
  const stagedMock = process.env.QA_STAGE_MOCK === 'true';
  let approvalError;
  // Explicit separate reviewer actor for MOCK integration only. Never approves live.
  const onCapture = metadata => {
    void (async () => {
      const manifest = JSON.parse(await readFile(metadata.manifestFile, 'utf8'));
      assert.equal(manifest.mode, 'mock');
      const body = await readFile(manifest.bodyFile, 'utf8');
      assert.ok(JSON.parse(body).messages.length > 0);
      if (manifest.priorResponseFile) assert.ok(JSON.parse(await readFile(manifest.priorResponseFile, 'utf8')).choices);
      await writeFile(manifest.approvalFile, JSON.stringify({ approved: true, index: manifest.index, sha256: manifest.sha256, nonce: manifest.nonce }), { mode: 0o600, flag: 'wx' });
    })().catch(error => { approvalError = error; });
  };
  const result = await runPipelineCanary({ databaseUrl: process.env.QA_DB_URL, confirmation: process.env.QA_DB_CONFIRM, stagedMock, ...(stagedMock ? { onCapture } : {}) });
  if (approvalError) throw approvalError;
  assert.equal(result.live, false);
  assert.equal(result.jobsCompleted, 7);
  assert.equal(result.observations, 2);
  assert.equal(result.publications, 1);
  assert.equal(result.idempotent, true);
  assert.deepEqual(result.traits, ['честная']);
  if (stagedMock) {
    assert.ok(result.qualityEvidenceFile, 'every staged fixture must retain the final published profile after DB cleanup');
    assert.equal((await stat(result.qualityEvidenceFile)).mode & 0o777, 0o600);
    const evidence = JSON.parse(await readFile(result.qualityEvidenceFile, 'utf8'));
    assert.equal(evidence.live, false);
    assert.equal(evidence.fixtureId, 'window');
    assert.equal(evidence.fixtureHash, result.fixtureHash);
    assert.equal(evidence.runId, result.runId);
    assert.equal(evidence.run.status, 'ready');
    assert.equal(evidence.profiles.length, 1);
    assert.deepEqual(evidence.profiles[0].data.profile.traits.map(trait => trait.value), result.traits);
    assert.equal(evidence.publications.length, 1);
    assert.deepEqual(evidence.markup, evidence.publications[0].data.markup);
    assert.equal(evidence.markup.characters.length, 1);
    assert.equal(evidence.calls.length, 4);
  }
});
