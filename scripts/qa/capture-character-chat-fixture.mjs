// Model-free capture of the mounted mobile screen and its real response parser.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const appDirectory = fileURLToPath(new URL('../../packages/app-expo/', import.meta.url));
const require = createRequire(new URL('../../packages/app-expo/package.json', import.meta.url));
export const ARTIFACT_PREFIX = 'NARRA_CHARACTER_CANARY_ARTIFACT:';

export function parseCharacterChatCapture(stdout) {
  assert.equal(typeof stdout, 'string');
  const occurrences = stdout.split(ARTIFACT_PREFIX);
  assert.equal(occurrences.length, 2, 'Expected exactly one character capture artifact');
  const artifact = JSON.parse(occurrences[1].split(/\r?\n/, 1)[0]);
  assert.ok(artifact && !Array.isArray(artifact) && typeof artifact === 'object');
  assert.deepEqual(Object.keys(artifact).sort(), ['fixtureId', 'live', 'method', 'parsedReply', 'path', 'request']);
  assert.equal(artifact.fixtureId, 'anna-boat-character-chat-v1');
  assert.equal(artifact.live, false);
  assert.equal(artifact.path, '/v2/ai/chat/complete');
  assert.equal(artifact.method, 'POST');
  const body = artifact.request;
  assert.ok(body && typeof body === 'object' && !Array.isArray(body));
  assert.deepEqual(Object.keys(body).sort(), ['analytics_tier', 'messages', 'origin', 'purpose', 'temperature']);
  assert.equal(body.temperature, 0.85);
  assert.equal(body.purpose, 'character_chat');
  assert.equal(body.origin, 'user');
  assert.equal(body.analytics_tier, 'essential');
  assert.ok(Array.isArray(body.messages));
  assert.equal(body.messages.length, 3);
  for (const message of body.messages) {
    assert.deepEqual(Object.keys(message).sort(), ['content', 'role']);
    assert.equal(typeof message.content, 'string');
    assert.ok(message.content.length > 0 && message.content.length <= 16000);
  }
  assert.equal(body.messages[0].role, 'system');
  assert.deepEqual(body.messages.slice(1), [
    { role: 'assistant', content: 'Я рядом, Ира.' },
    { role: 'user', content: 'Почему ты позвала Льва?' },
  ]);
  const prompt = body.messages[0].content;
  for (const fragment of ['Ты — Анна', 'Наша лодка', 'спокойная, внимательная', 'лодочница',
    'коротко и тепло', '25%', 'Читателя зовут Ира; она боится глубокой воды.',
    'Анна заметила течь в лодке и спокойно позвала Льва. Лев принёс доску.']) {
    assert.ok(prompt.includes(fragment), `Missing own-fixture prompt component: ${fragment}`);
  }
  assert.ok(!prompt.includes('ЗОЛОТОЙ_МАЯК') && !prompt.includes('СЕВЕРНЫЙ_ОСТРОВ'));
  assert.equal(artifact.parsedReply, 'Я заметила течь и позвала Льва: он принёс доску, чтобы помочь.');
  const requestBytes = JSON.stringify(body);
  return { ...artifact, requestBytes, mobileRequestSha256: createHash('sha256').update(requestBytes).digest('hex'),
    scope: 'Model-free mobile request/parser capture; hash is NOT upstream approval or live quality acceptance' };
}

export async function captureCharacterChatFixture({ executeProcess = execute } = {}) {
  const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  const result = await executeProcess(process.execPath, [vitest, 'run',
    'src/lib/narra/character-chat-recovery.test.tsx', '-t', 'serializes the real Anna chat prompt'], {
    cwd: appDirectory,
    env: { PATH: process.env.PATH || '/usr/bin:/bin', CI: '1', NODE_ENV: 'test',
      EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1', NARRA_CHARACTER_CANARY_CAPTURE: '1', NO_COLOR: '1' },
    timeout: 20000, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL',
  });
  return parseCharacterChatCapture(result.stdout);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 2, 'Usage: capture-character-chat-fixture.mjs (model-free only)');
  console.log(JSON.stringify(await captureCharacterChatFixture()));
}
