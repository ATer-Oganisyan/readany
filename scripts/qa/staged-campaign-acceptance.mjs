import assert from 'node:assert/strict';

/** Admission can fail inside a service's best-effort fallback. A published
 * profile alone therefore cannot establish that the approved campaign passed. */
export function assertStagedCampaignComplete({ fixtureId = 'window', staged, calls }) {
  assert.ok(['window', 'siblings'].includes(fixtureId), 'Unknown fixed staged fixture');
  const profile = ['synthesize_character_profile', 'recall_character_traits', 'audit_character_profile'];
  const expected = fixtureId === 'siblings'
    ? ['scan_book_chunk', 'scan_book_chunk', 'scan_book_chunk', ...profile, ...profile]
    : ['scan_book_chunk', ...profile];
  assert.equal(staged?.failed, false, 'Staged campaign failed, including any swallowed fallback rejection');
  assert.equal(staged.active, false, 'Staged campaign still active');
  assert.equal(staged.calls, expected.length, 'Approved call budget did not complete exactly');
  assert.ok(Array.isArray(staged.manifests), 'Missing staged manifests');
  assert.equal(staged.manifests.length, expected.length, 'Captured step count mismatch');
  assert.ok(staged.manifests.every(path => typeof path === 'string' && path.length > 0), 'Invalid manifest path');
  assert.equal(new Set(staged.manifests).size, expected.length, 'Duplicate staged manifest');
  assert.ok(Array.isArray(calls), 'Missing actual pipeline calls');
  assert.deepEqual(calls.map(call => call.operation), expected, 'Unexpected actual phase, fallback, retry or missing call');
}
