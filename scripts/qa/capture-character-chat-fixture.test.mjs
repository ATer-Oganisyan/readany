import assert from 'node:assert/strict';
import test from 'node:test';
import { ARTIFACT_PREFIX, captureCharacterChatFixture, parseCharacterChatCapture } from './capture-character-chat-fixture.mjs';

test('captures the actual mounted screen, strips only request_id, and hashes stable mobile bytes', async () => {
  const first = await captureCharacterChatFixture();
  const second = await captureCharacterChatFixture();
  assert.equal(first.mobileRequestSha256, second.mobileRequestSha256);
  assert.equal(first.requestBytes, JSON.stringify(first.request));
  assert.equal(first.request.request_id, undefined);
  assert.equal(first.live, false);
});

test('rejects missing, duplicate, malformed and wrong-scope capture artifacts', async () => {
  const captured = await captureCharacterChatFixture();
  const { requestBytes, mobileRequestSha256, scope, ...artifact } = captured;
  const line = value => `${ARTIFACT_PREFIX}${JSON.stringify(value)}\n`;
  assert.throws(() => parseCharacterChatCapture(''));
  assert.throws(() => parseCharacterChatCapture(line(artifact) + line(artifact)));
  for (const invalid of [null, [], { ...artifact, live: true }, { ...artifact, headers: {} },
    { ...artifact, request: { ...artifact.request, request_id: 'unexpected' } },
    { ...artifact, request: { ...artifact.request, purpose: 'summary' } },
    { ...artifact, request: { ...artifact.request, messages: [] } },
    { ...artifact, parsedReply: '' }]) assert.throws(() => parseCharacterChatCapture(line(invalid)));
  assert.throws(() => parseCharacterChatCapture(`${ARTIFACT_PREFIX}{broken\n`));
});

test('child execution is bounded and does not inherit credentials or auth configuration', async () => {
  await assert.rejects(captureCharacterChatFixture({ executeProcess: async (_command, args, options) => {
    assert.ok(args.includes('serializes the real Anna chat prompt'));
    assert.equal(options.timeout, 20000);
    assert.equal(options.maxBuffer, 1024 * 1024);
    assert.equal(options.env.HOME, undefined);
    assert.equal(options.env.NODE_OPTIONS, undefined);
    assert.equal(options.env.NARRA_CHARACTER_CANARY_CAPTURE, '1');
    throw new Error('synthetic child failure');
  } }), /synthetic child failure/);
});
