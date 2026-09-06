import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertStagedCampaignComplete } from './staged-campaign-acceptance.mjs';
import { createInternalGenerationService } from '../../services/narra-gateway/internal-generation-service.mjs';
import { BOOK_ANALYSIS_SYNTHESIS_VERSION } from '../../services/narra-gateway/book-analysis-contracts.mjs';
import { createFixtureModel, memoryObjectStorage, FIXTURE } from './book-analysis-pipeline-canary.mjs';

function completed(fixtureId = 'window') {
  const triplet = ['synthesize_character_profile', 'recall_character_traits', 'audit_character_profile'];
  const operations = fixtureId === 'siblings' ? ['scan_book_chunk', 'scan_book_chunk', 'scan_book_chunk', ...triplet, ...triplet] : ['scan_book_chunk', ...triplet];
  return { fixtureId, staged: { failed: false, active: false, calls: operations.length, manifests: operations.map((_, i) => `step-${i + 1}.manifest.json`) }, calls: operations.map(operation => ({ operation })) };
}
test('only exact completed fixed window and siblings campaigns pass', () => {
  for (const id of ['window', 'siblings']) assert.doesNotThrow(() => assertStagedCampaignComplete(completed(id)));
  for (const mutate of [
    x => { x.staged.failed = true; }, x => { x.staged.active = true; },
    x => { x.staged.calls--; }, x => { x.staged.calls++; },
    x => { x.staged.manifests.pop(); }, x => { x.staged.manifests[1] = x.staged.manifests[0]; },
    x => { x.calls.push({ operation: 'synthesize_personality_checkpoint' }); },
    x => { x.calls[1].operation = 'scan_book_chunk'; }, x => { x.calls.pop(); },
    x => { x.fixtureId = 'arbitrary'; },
  ]) {
    const value = completed(); mutate(value); assert.throws(() => assertStagedCampaignComplete(value));
  }
  const siblings = completed('siblings');
  [siblings.calls[3], siblings.calls[4]] = [siblings.calls[4], siblings.calls[3]];
  assert.throws(() => assertStagedCampaignComplete(siblings));
});

test('actual service swallows rejected final timeline fallback; campaign gate still fails', async () => {
  const requests = []; const mock = createFixtureModel([]);
  const staged = completed().staged;
  const unused = async () => { throw new Error('Unexpected media'); };
  const service = createInternalGenerationService({ storage: memoryObjectStorage(),
    completeChat: async input => {
      requests.push({ operation: input.costContext.operation });
      if (input.costContext.operation === 'synthesize_personality_checkpoint') {
        staged.failed = true;
        throw new Error('Staged campaign stopped or extra request');
      }
      const result = await mock(input);
      if (input.costContext.operation === 'synthesize_character_profile') {
        const malformed = JSON.parse(result); delete malformed.personalitySnapshots;
        return JSON.stringify(malformed);
      }
      return result;
    }, generatePortrait: unused, synthesizeSpeech: unused, generateIdleAnimation: unused,
    logger: { info() {}, warn() {}, error() {} },
  });
  const scan = await service.scanBookChunk({ idempotencyKey: 'guard:scan:chunk:book-scan-v1', runId: 'guard', chunkId: 'chunk', extractorVersion: 'book-scan-v1', bookTitle: 'Окно', bookAuthor: 'QA', sectionTitles: [], contextText: FIXTURE, coreLocalStartOffset: 0, coreLocalEndOffset: FIXTURE.length });
  const evidence = scan.observations.map(observation => ({ id: randomUUID(), type: observation.type, fact: observation.fact, quote: observation.evidence.quote, startOffset: observation.evidence.startOffset, endOffset: observation.evidence.endOffset, confidence: observation.confidence }));
  const result = await service.synthesizeCharacterProfile({ idempotencyKey: `guard:synthesize:snapshot:character:anna:${BOOK_ANALYSIS_SYNTHESIS_VERSION}`, runId: 'guard', snapshotId: 'snapshot', synthesisVersion: BOOK_ANALYSIS_SYNTHESIS_VERSION, bookTitle: 'Окно', bookAuthor: 'QA', textLength: FIXTURE.length,
    entity: { entityKey: 'character:anna', entityKind: 'character', canonicalName: 'Анна', aliases: [], resolutionStatus: 'confirmed', confidence: 0.98, evidenceIds: evidence.map(item => item.id), data: { firstEvidenceStartOffset: 0 } }, evidence });
  assert.ok(result.profile.personalitySnapshots.length > 0, 'service still returns a profile after rejecting fallback');
  assert.ok(requests.some(row => row.operation === 'synthesize_personality_checkpoint'));
  assert.throws(() => assertStagedCampaignComplete({ staged, calls: requests }), /campaign failed/);
  assert.throws(() => assertStagedCampaignComplete({ staged: { ...staged, failed: false }, calls: requests }), /Unexpected actual phase/);
});
