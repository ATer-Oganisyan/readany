import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { captureCharacterProviderFixture } from './capture-character-provider-fixture.mjs';

test('actual mobile request survives contract, policy and provider serialization without live generation', async () => {
  const first = await captureCharacterProviderFixture();
  const second = await captureCharacterProviderFixture();
  assert.equal(first.live, false);
  assert.equal(first.upstreamSha256, second.upstreamSha256);
  assert.equal(first.upstreamSha256, createHash('sha256').update(first.requestBytes).digest('hex'));
  assert.notEqual(first.upstreamSha256, first.mobileRequestSha256);
  // This current client already includes the policy; the server must not duplicate it.
  assert.deepEqual(first.request.messages, first.mobileRequest.messages);
  assert.equal(first.request.messages.length, 3);
  assert.equal(first.mobileRequest.temperature, 0.85);
  assert.equal(first.request.temperature, undefined);
  assert.equal(first.request.request_id, undefined);
  assert.equal(first.request.purpose, undefined);
});
