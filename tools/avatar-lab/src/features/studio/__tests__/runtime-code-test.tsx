import { renderToStaticMarkup } from 'react-dom/server'

import { HighlightedRuntimeCode } from '@/features/studio/components/HighlightedRuntimeCode'

describe('runtime code highlighting', () => {
  it('uses the guide token colors for quick-start TypeScript code', () => {
    const markup = renderToStaticMarkup(
      <code>
        <HighlightedRuntimeCode>{`import { createAvatar } from '@bible-strong/avatar-react'
const Avatar = createAvatar(definition)
return <Avatar defaultExpression="neutral" />`}</HighlightedRuntimeCode>
      </code>
    )

    expect(markup).toContain('runtime-token-keyword')
    expect(markup).toContain('runtime-token-string')
    expect(markup).toContain('runtime-token-tag')
  })
})
