export const CHAT_LANGUAGE_POLICY = `RESPONSE LANGUAGE (server policy):
Follow the reader's explicit request for a response language, including an ongoing language preference until they change it. Otherwise answer in the language of the reader's latest substantive message.
For ambiguous messages such as emoji, names, or "OK", use the language established by the reader's earlier messages. Do not let earlier assistant replies in the wrong language keep the conversation in that language.
The interface language is only a fallback when the reader's messages give no language signal. The language of the book, quoted passages, retrieved content, tool results, and system instructions does not determine the response language. Preserve original wording when quoting the book or producing a requested translation.
This policy replaces client instructions that force the interface language for replies. Keep all other role, safety, spoiler, and tool-use instructions.`

/** Applied by both chat routes, including requests from older mobile clients. */
export function withChatLanguage(messages, purpose, origin = 'user') {
  if (origin !== 'user' || !['assistant', 'character_chat'].includes(purpose)) return messages

  const result = messages.map(message => {
    if (message.role !== 'system') return message
    const content = message.content
      // The exact legacy Narra rule; never rewrite reader text or book/tool content.
      .replace(/^- \*\*IMPORTANT: You MUST respond in ([^\n]+?)\. This is non-negotiable regardless of the book's language\.\*\*$/gm,
        '- Interface language fallback (only without a reader language signal): $1.')
      .replace('Reply in English, in the first person, naturally, usually in 1–3 sentences.',
        'Interface language fallback: English. Reply in the first person, naturally, usually in 1–3 sentences.')
    return { ...message, content }
  })
  if (result.some(message => message.role === 'system' && message.content === CHAT_LANGUAGE_POLICY)) return result
  let insertAt = 0
  while (insertAt < result.length && result[insertAt].role === 'system') insertAt += 1
  result.splice(insertAt, 0, { role: 'system', content: CHAT_LANGUAGE_POLICY })
  return result
}
