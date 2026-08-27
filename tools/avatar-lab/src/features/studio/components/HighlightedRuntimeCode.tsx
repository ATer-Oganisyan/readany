const codeTokenPattern =
  /(\/\/.*|'.*?'|".*?"|@[a-z0-9-/]+|<\/?[A-Z][A-Za-z]*|\b(?:npm|install|import|from|const|if|throw|new|export|function|return|onClick|ref|useRef)\b)/g

export function HighlightedRuntimeCode({ children }: { children: string }) {
  return children.split(codeTokenPattern).map((token, index) => {
    if (!token) return null
    const kind = token.startsWith('//')
      ? 'comment'
      : token.startsWith("'") || token.startsWith('"') || token.startsWith('@')
        ? 'string'
        : token.startsWith('<')
          ? 'tag'
          : /^(?:npm|install|import|from|const|if|throw|new|export|function|return|onClick|ref|useRef)$/.test(
                token
              )
            ? 'keyword'
            : 'plain'
    return (
      <span className={`runtime-token runtime-token-${kind}`} key={`${index}-${token}`}>
        {token}
      </span>
    )
  })
}
