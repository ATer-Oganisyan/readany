import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createStableBookChunks } from '../../services/narra-gateway/book-analysis-chunking.mjs';
import { MULTICHUNK_FIXTURE, MULTICHUNK_FACTS, assertMultichunkAcceptance } from './multichunk-book-fixture.mjs';
import { runPipelineCanary } from './book-analysis-pipeline-canary.mjs';

function gold() {
  const chunks = createStableBookChunks({ runId: 'gold', text: MULTICHUNK_FIXTURE }).map(item => ({
    core_start_offset: item.coreStartOffset, core_end_offset: item.coreEndOffset,
  }));
  const observations = MULTICHUNK_FACTS.map((item, index) => ({
    id: `fact-${index}`, entity_candidate: item.entityCandidate, observation_type: item.type,
    evidence_quote: item.evidence.quote, evidence_start_offset: MULTICHUNK_FIXTURE.indexOf(item.evidence.quote),
    evidence_end_offset: MULTICHUNK_FIXTURE.indexOf(item.evidence.quote) + item.evidence.quote.length,
  }));
  const characters = ['Анна', 'Борис'].map(name => {
    const ownTraits = observations.filter(item => item.observation_type === 'character_trait' && item.entity_candidate === name);
    const traits = ownTraits.map(item => ({
      value: /любознатель/u.test(item.evidence_quote) ? 'любознательная' : name === 'Анна' ? 'честная' : 'терпеливый',
      evidenceIds: [item.id],
    }));
    return { name, characterKey: name, traits,
      role: name === 'Анна' ? { value: 'хранитель архива', evidenceIds: ['fact-7'] } : null,
      speechExamples: [{ value: MULTICHUNK_FACTS[name === 'Анна' ? 5 : 6].evidence.quote,
        evidenceIds: [name === 'Анна' ? 'fact-5' : 'fact-6'] }],
      personalitySnapshots: [
      { cutoffTextOffset: 100, traits: traits.filter(item => observations.find(row => row.id === item.evidenceIds[0]).evidence_end_offset <= 100) },
      { cutoffTextOffset: MULTICHUNK_FIXTURE.length, traits },
    ] };
  });
  return { chunks, observations, profiles: [{}, {}], markup: { characters, relationships: [{
    sourceCharacterKey: 'Анна', targetCharacterKey: 'Борис', description: MULTICHUNK_FACTS[2].fact, evidenceIds: ['fact-2'],
  }] } };
}

test('authored fixture crosses three default cores with actual duplicated overlap evidence', () => {
  const chunks = createStableBookChunks({ runId: 'geometry', text: MULTICHUNK_FIXTURE });
  assert.equal(chunks.length, 3);
  const contexts = chunks.map(item => MULTICHUNK_FIXTURE.slice(item.contextStartOffset, item.contextEndOffset));
  assert.ok(MULTICHUNK_FACTS.some(item => contexts.filter(context => context.includes(item.evidence.quote)).length > 1));
  assert.doesNotThrow(() => assertMultichunkAcceptance(gold()));
});

test('multi-chunk acceptance rejects dropped/duplicate facts, lost relation, gaps, mixed identities and future leakage', () => {
  const mutations = [
    input => input.observations.pop(),
    input => input.observations.push(input.observations[0]),
    input => { input.observations[0].evidence_start_offset++; },
    input => { input.chunks[1].core_start_offset++; },
    input => { input.markup.relationships = []; },
    input => { input.markup.characters[0].traits[0].evidenceIds = ['fact-1']; },
    input => { input.markup.characters[0].traits[0].value = 'тревожная'; },
    input => { input.markup.characters[0].traits[0].evidenceIds = ['fact-3']; },
    input => { input.markup.characters[0].personalitySnapshots[0].traits = [{ value: 'любознательная', evidenceIds: ['fact-0'] }]; },
    input => { input.markup.characters[0].personalitySnapshots[0].traits = input.markup.characters[0].traits; },
    input => { input.markup.characters[0].personalitySnapshots = input.markup.characters[0].personalitySnapshots.slice(1); },
    input => { input.markup.characters[0].role = null; },
    input => { input.markup.characters[0].role.value = 'врач'; },
    input => { input.markup.characters[0].role.evidenceIds = ['fact-0']; },
    input => { input.markup.characters[1].role = input.markup.characters[0].role; },
    input => { input.markup.characters[0].speechExamples = []; },
    input => { input.markup.characters[0].speechExamples[0].value = 'Я ничего не скажу.'; },
    input => { input.markup.characters[0].speechExamples = input.markup.characters[1].speechExamples; },
    input => { input.markup.relationships[0].description = 'Анна и Борис — супруги'; },
    input => { input.markup.relationships[0].evidenceIds = ['fact-0']; },
  ];
  for (const mutate of mutations) {
    const input = gold(); mutate(input);
    assert.throws(() => assertMultichunkAcceptance(input));
  }
});

test('multi-chunk never enables a live provider implicitly', async () => {
  await assert.rejects(runPipelineCanary({ fixtureId: 'unknown' }), /Unknown own fixture/);
  await assert.rejects(runPipelineCanary({ fixtureId: 'siblings', stagedLive: true }), /mock-only/);
  await assert.rejects(runPipelineCanary({ fixtureId: 'siblings', stagedMock: true }), /Explicit QA_DB_URL/);
});

async function runStagedMock() {
  const captures = [];
  let reviewError;
  const controller = new AbortController();
  // Test-only external actor. No live mode is accepted by this reviewer.
  const onCapture = metadata => {
    void (async () => {
      const manifest = JSON.parse(await readFile(metadata.manifestFile, 'utf8'));
      assert.equal(manifest.mode, 'mock');
      const body = await readFile(manifest.bodyFile);
      assert.equal(createHash('sha256').update(body).digest('hex'), manifest.sha256);
      assert.ok(body.length <= 32768);
      assert.equal(manifest.index, captures.length + 1);
      if (manifest.priorResponseFile) assert.ok(JSON.parse(await readFile(manifest.priorResponseFile, 'utf8')).choices);
      captures.push({ phase: manifest.phase, bytes: body.length });
      await writeFile(manifest.approvalFile, JSON.stringify({ approved: true, index: manifest.index, sha256: manifest.sha256, nonce: manifest.nonce }), { mode: 0o600, flag: 'wx' });
    })().catch(error => { reviewError = error; controller.abort(error); });
  };
  const result = await runPipelineCanary({ fixtureId: 'siblings', stagedMock: true,
    databaseUrl: process.env.QA_MULTI_DB_URL, confirmation: process.env.QA_MULTI_DB_CONFIRM,
    onCapture, signal: controller.signal });
  if (reviewError) throw reviewError;
  assert.equal(result.live, false);
  assert.equal(result.jobsCompleted, 10);
  assert.equal(result.staged.calls, 9);
  assert.equal(result.staged.failed, false);
  assert.equal(captures.length, 9);
  assert.deepEqual(captures.map(item => item.phase), result.calls.map(item => item.operation));
  assert.equal(result.observations, 11);
  assert.equal(result.publications, 1);
  assert.equal(result.idempotent, true);
  console.log(JSON.stringify({ stagedMock: true, requests: captures, approvalDirectory: result.approvalDirectory }));
  return result;
}

test('three default chunks -> actual PostgreSQL workers -> two grounded profiles -> publication, replay idle', {
  skip: !process.env.QA_MULTI_DB_URL ? 'requires fresh dedicated QA_MULTI_DB_URL and QA_MULTI_DB_CONFIRM' : false,
  timeout: 60000,
}, async () => {
  const result = process.env.QA_MULTI_STAGE_MOCK === 'true' ? await runStagedMock()
    : await runPipelineCanary({ fixtureId: 'siblings', databaseUrl: process.env.QA_MULTI_DB_URL, confirmation: process.env.QA_MULTI_DB_CONFIRM });
  assert.equal(result.live, false);
  assert.equal(result.chunkCount, 3);
  assert.equal(result.characterCount, 2);
  assert.equal(result.jobsCompleted, 10);
  assert.equal(result.observations, 11);
  assert.equal(result.calls.length, 9);
  assert.deepEqual(result.traits.sort(), ['любознательная', 'терпеливый', 'честная']);
  assert.equal(result.publications, 1);
  assert.equal(result.idempotent, true);
});
