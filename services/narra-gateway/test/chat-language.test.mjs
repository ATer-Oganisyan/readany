import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_LANGUAGE_POLICY, withChatLanguage } from '../providers/chat-language.mjs'
import { withChatCompliance } from '../providers/rf-compliance.mjs'
import { parseChatBody } from '../platform/contracts.mjs'

for (const stream of [true, false]) {
  for (const purpose of ['assistant', 'character_chat']) {
    test(`${purpose}, stream=${stream}: old English client and Russian reader`, () => {
      const messages = [
        { role: 'system', content: purpose === 'assistant'
          ? "Book language: ru\n- **IMPORTANT: You MUST respond in en. This is non-negotiable regardless of the book's language.**\nDo not reveal spoilers."
          : 'Reply in English, in the first person, naturally, usually in 1–3 sentences. Do not reveal spoilers.' },
        { role: 'user', content: 'Привет' },
        { role: 'assistant', content: 'Hello! How can I help?' },
        { role: 'user', content: 'Как дела?' },
      ]
      const before = structuredClone(messages)
      const input = parseChatBody({ messages, purpose }, { stream })
      const result = withChatLanguage(withChatCompliance(input.messages, input.purpose), input.purpose, input.origin)
      const system = result.filter(m => m.role === 'system').map(m => m.content).join('\n')
      assert.ok(system.includes(CHAT_LANGUAGE_POLICY))
      assert.ok(system.includes('Do not reveal spoilers.'))
      assert.ok(!system.includes('You MUST respond in en'))
      assert.ok(!system.includes('Reply in English,'))
      assert.deepEqual(result.filter(m => m.role !== 'system'), messages.slice(1))
      assert.deepEqual(messages, before)
      assert.deepEqual(withChatLanguage(result, purpose), result)
    })
  }
}

test('Russian interface, language requests, ambiguous turns and tool results stay intact', () => {
  const messages = [
    { role: 'system', content: '- **IMPORTANT: You MUST respond in ru. This is non-negotiable regardless of the book\'s language.**' },
    { role: 'user', content: 'Answer in English from now on. Объясни эту главу.' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'ragSearch', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call-1', content: 'Русский текст книги' },
    { role: 'assistant', content: 'Here is the explanation.' },
    { role: 'user', content: '👍' },
  ]
  const result = withChatLanguage(messages, 'assistant')
  assert.deepEqual(result.slice(2), messages.slice(1))
  assert.ok(!result[0].content.includes('MUST respond'))
  assert.equal(result[1].content, CHAT_LANGUAGE_POLICY)
})

test('background and non-dialog requests retain their task-specific language', () => {
  const messages = [{ role: 'system', content: 'Reply in English, in the first person, naturally, usually in 1–3 sentences.' }, { role: 'user', content: 'Привет' }]
  for (const purpose of ['assistant', 'character_chat']) {
    assert.equal(withChatLanguage(messages, purpose, 'background'), messages)
  }
  for (const purpose of ['structured_task', 'summary', 'memory']) {
    assert.equal(withChatLanguage(messages, purpose), messages)
  }
})

test('a chat without a system message receives the policy without rewriting reader text', () => {
  const messages = [{ role: 'user', content: 'Reply in English, in the first person, naturally, usually in 1–3 sentences.' }]
  assert.deepEqual(withChatLanguage(messages, 'assistant'), [{ role: 'system', content: CHAT_LANGUAGE_POLICY }, ...messages])
})
