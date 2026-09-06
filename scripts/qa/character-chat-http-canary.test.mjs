import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { captureCharacterProviderFixture } from './capture-character-provider-fixture.mjs';
import { CHARACTER_APPROVED_SHA256, MOCK_REPLY, characterGatewayEnvironment, mockCharacterChild,
  runCharacterChatHttpCanary, validateApprovedCharacterFixture } from './character-chat-http-canary.mjs';

test('real isolated gateway accepts exact captured mobile payload and executes one approved mock child', async () => {
  let calls = 0;
  let bridgeDirectory;
  let closed = false;
  const result = await runCharacterChatHttpCanary({ spawnFixtureChild: (_command, _args, options) => {
    calls++; bridgeDirectory = options.cwd;
    const child = mockCharacterChild(); child.once('close', () => { closed = true; }); return child;
  } });
  assert.equal(calls, 1);
  assert.equal(result.live, false);
  assert.equal(result.transportPassed, true);
  assert.equal(result.qualityAccepted, false);
  assert.equal(result.completion.text, MOCK_REPLY);
  assert.equal(result.completion.attempts, 1);
  assert.equal(result.upstreamSha256, CHARACTER_APPROVED_SHA256);
  assert.equal(closed, true);
  await assert.rejects(access(bridgeDirectory), { code: 'ENOENT' });
});

test('pinned approval rejects changed provider bytes or mobile metadata', async () => {
  const fixture = await captureCharacterProviderFixture();
  assert.equal(validateApprovedCharacterFixture(fixture), fixture);
  assert.throws(() => validateApprovedCharacterFixture({ ...fixture, upstreamSha256: 'a'.repeat(64) }));
  assert.throws(() => validateApprovedCharacterFixture({ ...fixture, requestBytes: `${fixture.requestBytes} ` }));
  assert.throws(() => validateApprovedCharacterFixture({ ...fixture, mobileRequest: { ...fixture.mobileRequest, origin: 'background' } }));
});

test('mock/live modes are exclusive and environment has only isolated purpose-pinned provider configuration', async () => {
  await assert.rejects(runCharacterChatHttpCanary(), /explicit fake child/);
  await assert.rejects(runCharacterChatHttpCanary({ live: true, spawnFixtureChild: mockCharacterChild }), /cannot use fake/);
  const env = characterGatewayEnvironment({ port: 1, dataDir: '/own-fixture', bridge: { url: 'http://127.0.0.1:2', token: 'fake' } });
  assert.equal(env.LLM_FALLBACK_CHARACTER_CHAT, '');
  assert.equal(env.LLM_ROUTE_CHARACTER_CHAT, 'litellm');
  assert.equal(env.LLM_MAX_TOKENS_CHARACTER_CHAT, '512');
  for (const key of ['HOME', 'NODE_OPTIONS', 'DATABASE_URL', 'OPENAI_API_KEY']) assert.equal(env[key], undefined);
});

test('default CLI is model-free dry-run; invalid combined modes are rejected', async () => {
  const script = fileURLToPath(new URL('./character-chat-http-canary.mjs', import.meta.url));
  const execute = promisify(execFile);
  const options = { timeout: 20000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH } };
  const { stdout } = await execute(process.execPath, [script], options);
  const artifacts = stdout.trim().split('\n').map(line => JSON.parse(line)).filter(item => item.fixtureId);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].live, false);
  assert.match(artifacts[0].mode, /^dry-run/);
  await assert.rejects(execute(process.execPath, [script, '--mock', '--live'], options));
});

test('failed mock child does not retry and fails the transport gate', async () => {
  let calls = 0;
  let bridgeDirectory;
  let closed = false;
  await assert.rejects(runCharacterChatHttpCanary({ spawnFixtureChild: (_command, _args, options) => {
    calls++; bridgeDirectory = options.cwd;
    const child = mockCharacterChild({ reply: '' }); child.once('close', () => { closed = true; }); return child;
  } }));
  assert.equal(calls, 1);
  assert.equal(closed, true);
  await assert.rejects(access(bridgeDirectory), { code: 'ENOENT' });
});
