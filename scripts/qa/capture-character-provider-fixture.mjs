// Model-free: actual mobile serialization -> gateway contract/policy/provider.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { captureCharacterChatFixture } from './capture-character-chat-fixture.mjs';
import { parseChatBody } from '../../services/narra-gateway/contracts.mjs';
import { withChatCompliance } from '../../services/narra-gateway/rf-compliance.mjs';
import { requestChat } from '../../services/narra-gateway/providers.mjs';

export async function captureCharacterProviderFixture() {
  const mobile = await captureCharacterChatFixture();
  const input = parseChatBody(mobile.request);
  const messages = withChatCompliance(input.messages, input.purpose);
  let requestBytes;
  let calls = 0;
  const events = [];
  const result = await requestChat({
    ...input, messages, stream: false,
    env: {
      LLM_ROUTE_DEFAULT: 'litellm', LLM_FALLBACK_DEFAULT: '',
      LLM_ROUTE_CHARACTER_CHAT: 'litellm', LLM_FALLBACK_CHARACTER_CHAT: '',
      LITELLM_MODEL: 'gpt-5.6-luna', LITELLM_BASE_URL: 'http://127.0.0.1:1',
      LITELLM_API_KEY: 'unused-model-free-capture', LLM_MAX_TOKENS_COMPLETE: '512',
    },
    onAttempt: async event => { events.push(event); },
    fetchImpl: async (url, init) => {
      assert.equal(++calls, 1, 'Capture must not retry');
      assert.equal(url, 'http://127.0.0.1:1/v1/chat/completions');
      assert.equal(init.method, 'POST');
      requestBytes = init.body;
      return new Response(JSON.stringify({ choices: [{ message: { content: mobile.parsedReply } }] }));
    },
  });
  const response = await result.response.json();
  await result.finalizeAttempt();
  assert.equal(response.choices[0].message.content, mobile.parsedReply);
  assert.deepEqual(events.map(event => event.status), ['started', 'completed']);
  assert.equal(typeof requestBytes, 'string');
  const request = JSON.parse(requestBytes);
  assert.deepEqual(Object.keys(request).sort(), ['max_tokens', 'messages', 'model', 'stream']);
  assert.equal(request.model, 'gpt-5.6-luna');
  assert.equal(request.stream, false);
  assert.equal(request.max_tokens, 512);
  assert.deepEqual(request.messages, messages);
  return {
    live: false, fixtureId: mobile.fixtureId, mobileRequestSha256: mobile.mobileRequestSha256,
    upstreamSha256: createHash('sha256').update(requestBytes).digest('hex'),
    mobileRequest: mobile.request, request, requestBytes,
    scope: 'Model-free contract/policy/provider capture; no HTTP server, subscription call or native UI acceptance',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 2, 'Model-free capture accepts no flags');
  console.log(JSON.stringify(await captureCharacterProviderFixture()));
}
