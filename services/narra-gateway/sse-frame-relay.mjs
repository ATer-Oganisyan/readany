// Relay complete SSE frames only. Byte-level framing preserves split UTF-8 and
// CRLF without retaining the response or forwarding an unvalidated JSON prefix.
export function createSseFrameRelay({ validateFrame, writeFrame, maxBufferedBytes = 512 * 1024 }) {
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes < 1) throw new Error('Invalid SSE frame limit')
  let buffer
  let size = 0
  let previous = -1
  let beforePrevious = -1
  let terminal = false
  const fail = message => {
    terminal = true
    buffer = undefined
    return Object.assign(new Error(message), { code: 'PARSE', status: 502 })
  }
  const forward = () => {
    const frame = Buffer.from(buffer.subarray(0, size))
    size = 0
    previous = beforePrevious = -1
    try { validateFrame(frame); writeFrame(frame) }
    catch (error) { terminal = true; buffer = undefined; throw error }
  }
  return {
    push(chunk) {
      if (terminal) throw fail('LLM stream relay was already closed')
      if (!buffer) buffer = Buffer.allocUnsafe(maxBufferedBytes)
      for (const byte of chunk) {
        if (size === maxBufferedBytes) throw fail('LLM stream event exceeded the parser limit')
        buffer[size++] = byte
        const boundary = byte === 10 && (previous === 10 || (previous === 13 && beforePrevious === 10))
        if (boundary) forward()
        else { beforePrevious = previous; previous = byte }
      }
    },
    finish() {
      if (terminal) throw fail('LLM stream relay was already closed')
      // An extra blank separator at EOF is harmless; an unfinished data/event
      // line must never be forwarded or joined to the route's error event.
      if (size > 0) {
        if (!buffer.subarray(0, size).every(byte => byte === 10 || byte === 13)) {
          throw fail('LLM stream ended with an incomplete SSE event')
        }
        forward()
      }
      terminal = true
      buffer = undefined
    }
  }
}
