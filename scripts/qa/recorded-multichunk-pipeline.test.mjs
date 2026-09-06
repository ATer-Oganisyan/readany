import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipelineCanary } from './book-analysis-pipeline-canary.mjs';
import { evaluateMultichunkLiveAcceptance } from './multichunk-live-acceptance.mjs';

test('recorded own responses cannot combine replay with live or another fixture', async () => {
  for (const options of [{ stagedLive: true }, { stagedMock: true }, { fixtureId: 'window' }]) {
    await assert.rejects(runPipelineCanary({ fixtureId: 'siblings', replayCapturedLive: true, ...options }), /Recorded replay requires/);
  }
  await assert.rejects(runPipelineCanary({ replayRecording: '2026-09-06' }), /requires offline replay/);
  await assert.rejects(runPipelineCanary({ fixtureId: 'siblings', replayCapturedLive: true, replayRecording: '../../other' }), /requires offline replay/);
});

test('latest recorded publication passes real workers and repeated ready-run lookup without regeneration', {
  skip: !process.env.QA_REPLAY_LATEST_DB_URL ? 'requires fresh dedicated QA_REPLAY_LATEST_DB_URL and QA_REPLAY_LATEST_DB_CONFIRM' : false,
  timeout: 60000,
}, async () => {
  const result = await runPipelineCanary({ fixtureId: 'siblings', replayCapturedLive: true, replayRecording: '2026-09-06',
    databaseUrl: process.env.QA_REPLAY_LATEST_DB_URL, confirmation: process.env.QA_REPLAY_LATEST_DB_CONFIRM });
  assert.equal(result.live, false);
  assert.equal(result.replayRecording, '2026-09-06');
  assert.equal(result.calls.length, 9);
  assert.equal(result.jobsCompleted, 10);
  assert.equal(result.observations, 24);
  assert.equal(result.publications, 1);
  assert.equal(result.idempotent, true);
  assert.equal(result.qualityAssessment.machinePassed, true);
  assert.equal(result.qualityAssessment.qualityComplete, false);
});

test('captured live omission -> actual PostgreSQL workers -> grounded speech restored without a model retry', {
  skip: !process.env.QA_REPLAY_DB_URL ? 'requires fresh dedicated QA_REPLAY_DB_URL and QA_REPLAY_DB_CONFIRM' : false,
  timeout: 60000,
}, async () => {
  const result = await runPipelineCanary({ fixtureId: 'siblings', replayCapturedLive: true,
    databaseUrl: process.env.QA_REPLAY_DB_URL, confirmation: process.env.QA_REPLAY_DB_CONFIRM });
  assert.equal(result.live, false);
  assert.equal(result.replayCapturedLive, true);
  assert.equal(result.calls.length, 9);
  assert.equal(result.jobsCompleted, 10);
  assert.equal(result.observations, 22);
  assert.equal(result.publications, 1);
  assert.equal(result.idempotent, true);
  assert.equal(result.qualityAssessment.qualityComplete, false, 'machine checks never stand in for manual quality review');
  assert.equal(evaluateMultichunkLiveAcceptance(result.qualityEvidence).machinePassed, true);
  const boris = result.qualityEvidence.markup.characters.find(item => item.name === 'Борис');
  assert.equal(boris.speechExamples.length, 1);
  assert.equal(boris.speechExamples[0].value, 'Борис ответил: «Хорошо, Анна».');
  assert.equal(boris.speechStyle, null, 'one retained utterance must not invent a stable speaking style');
});
