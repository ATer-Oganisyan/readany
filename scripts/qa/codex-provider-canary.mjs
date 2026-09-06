// Own synthetic text only. No device, production, database or API-key configuration.
import assert from 'node:assert/strict';
import { requestChat } from '../../services/narra-gateway/providers.mjs';
import { createFixtureBridge, digest, MODEL } from './codex-fixture-bridge.mjs';

const messages = [
  { role: 'system', content: 'Ответь только JSON без Markdown: {"characters":[{"name":"...","trait":"..."}],"summary":"..."}. Используй только факты отрывка, не выдумывай биографии.' },
  { role: 'user', content: 'Наш тестовый рассказ: Анна заметила течь в лодке и спокойно позвала Льва. Лев принёс доску и помог Анне починить лодку. Вместе они вернулись на берег. Назови двух персонажей, по одной подтверждённой черте каждого и кратко перескажи события.' },
];
const env = {
  LLM_ROUTE_DEFAULT: 'litellm', LITELLM_MODEL: MODEL,
  LITELLM_BASE_URL: 'http://127.0.0.1:1', LITELLM_API_KEY: 'unused-capture',
  LLM_MAX_TOKENS_COMPLETE: '512',
};
// Obtain the exact production-provider request serialization without a network call.
let approvedBody;
const captured = await requestChat({ messages, purpose: 'structured_task', stream: false, env,
  fetchImpl: async (_url, init) => {
    approvedBody = init.body;
    return new Response('{"choices":[{"message":{"content":"capture-only"}}]}');
  },
});
await captured.response.text();
await captured.finalizeAttempt();
assert.equal(typeof approvedBody, 'string');
const sha256 = digest(approvedBody);
if (process.argv.includes('--live')) {
  const bridge = await createFixtureBridge({ approvedHashes: [sha256], maxCalls: 1 });
  const started = Date.now();
  try {
    const result = await requestChat({ messages, purpose: 'structured_task', stream: false,
      env: { ...env, LITELLM_BASE_URL: bridge.url, LITELLM_API_KEY: bridge.token },
    });
    const completion = await result.response.json();
    const content = completion.choices?.[0]?.message?.content;
    assert.equal(typeof content, 'string');
    const parsed = JSON.parse(content);
    assert.deepEqual(parsed.characters.map(c => c.name).sort(), ['Анна', 'Лев']);
    assert.ok(parsed.characters.every(c => typeof c.trait === 'string' && c.trait.length > 0));
    assert.ok(typeof parsed.summary === 'string' && parsed.summary.length > 0);
    await result.finalizeAttempt();
    console.log(JSON.stringify({ live: true, model: MODEL, sha256, elapsedMs: Date.now() - started,
      checks: 'JSON schema and exact two names', result: parsed,
      scope: 'actual gateway provider module -> loopback bridge -> subscription; not mobile or full analysis pipeline' }));
  } finally { await bridge.close(); }
} else {
  console.log(JSON.stringify({ live: false, sha256, request: JSON.parse(approvedBody) }));
}
