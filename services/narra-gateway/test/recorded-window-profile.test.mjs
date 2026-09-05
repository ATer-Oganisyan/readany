import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createInternalGenerationService } from '../internal-generation-service.mjs';
import { BOOK_ANALYSIS_SYNTHESIS_VERSION } from '../book-analysis-contracts.mjs';

test('recorded live Anna profile corrects incompatible voice without inventing personality or speech', async () => {
  const captured = JSON.parse(await readFile(new URL('../../../docs/reviews/evidence/subscription-window-live-recheck-2026-09-05.json', import.meta.url), 'utf8'));
  // Exact evidence IDs and normalized spans from the reviewed step-2 request.
  // Replay only: no subscription, network, database, or new model execution.
  const evidence = [
    ['41feeb3d-8563-4f62-a7f6-5a545c372bc0', 'character_mention', 'Анна упомянута в тексте', 0, 24, 'Анна всегда была честной'],
    ['79cf0d50-65b2-4a7b-968e-a0f2ec28d841', 'character_gender', 'female', 0, 24, 'Анна всегда была честной'],
    ['ffb0d3a1-324c-4be0-91a3-6065ed8767eb', 'character_trait', 'Анна честная', 0, 24, 'Анна всегда была честной'],
    ['92ee0f63-d0d5-4992-a75b-f662825fa7e0', 'character_action', 'Анна торопливо закрыла окно', 26, 61, 'Однажды Анна торопливо закрыла окно'],
  ].map(([id, type, fact, startOffset, endOffset, quote]) => ({ id, type, fact, startOffset, endOffset, quote, confidence: 1 }));
  const expected = ['synthesize_character_profile', 'recall_character_traits', 'audit_character_profile'];
  const calls = []; const objects = new Map();
  const unused = async () => assert.fail('profile replay must not generate media');
  const service = createInternalGenerationService({
    storage: {
      async getBytes({ objectKey }) {
        if (!objects.has(objectKey)) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
        return { bytes: objects.get(objectKey) };
      },
      async putBytes({ objectKey, bytes }) { objects.set(objectKey, Buffer.from(bytes)); return { objectKey }; },
    },
    logger: { info() {}, warn() {}, error() {} },
    async completeChat(input) {
      assert.equal(input.costContext.operation, expected[calls.length], 'no extra or reordered model calls');
      calls.push(input.costContext.operation);
      return captured.steps.find(step => step.phase === input.costContext.operation).response.choices[0].message.content;
    },
    generatePortrait: unused, synthesizeSpeech: unused, generateIdleAnimation: unused,
  });
  const raw = JSON.parse(captured.steps[1].response.choices[0].message.content);
  assert.equal(raw.gender.value, 'female');
  assert.equal(raw.creative.voice, 'She', 'retain the actual incompatible model selection');
  const request = {
    idempotencyKey: `recorded-window:synthesize:snapshot:character:anna:${BOOK_ANALYSIS_SYNTHESIS_VERSION}`,
    runId: 'recorded-window', snapshotId: 'snapshot', synthesisVersion: BOOK_ANALYSIS_SYNTHESIS_VERSION,
    bookTitle: 'Окно', bookAuthor: 'QA', textLength: 62,
    entity: { entityKey: 'character:anna', entityKind: 'character', canonicalName: 'Анна', aliases: [],
      resolutionStatus: 'confirmed', confidence: 1, evidenceIds: evidence.map(row => row.id), data: { firstEvidenceStartOffset: 0 } }, evidence,
  };
  const result = await service.synthesizeCharacterProfile(request);
  assert.equal(result.profile.gender.value, 'female');
  assert.equal(result.profile.creative.voice, 'Che');
  assert.deepEqual(result.profile.traits.map(trait => trait.value), ['честность']);
  assert.deepEqual(result.profile.speechExamples, []);
  assert.equal(result.profile.speechStyle, null);
  assert.deepEqual(calls, expected);
  assert.deepEqual(await service.synthesizeCharacterProfile(request), result);
  assert.deepEqual(calls, expected, 'cached replay must not generate again');
});
