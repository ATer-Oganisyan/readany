/** Allow the reader shell and its local book frames, never an external page. */
export function allowReaderNavigation(
  request: { url: string; isTopFrame?: boolean },
  readerUri: string,
): boolean {
  try {
    const target = new URL(request.url);
    const shell = new URL(readerUri);
    // Only the original shell may occupy the top-level WebView.
    if (target.href.split("#")[0] === shell.href.split("#")[0]) return true;
    if (request.isTopFrame === true) return false;
    // WKWebView reports Foliate chapter iframe.srcdoc as about:srcdoc.
    if (target.href === "about:blank" || target.href === "about:srcdoc" || target.protocol === "blob:") return true;
    // Chapter frames and converted books are served beside the reader shell.
    if (shell.protocol === "file:") {
      const directory = shell.pathname.slice(0, shell.pathname.lastIndexOf("/") + 1);
      return target.protocol === "file:" && target.pathname.startsWith(directory);
    }
    return (
      (shell.protocol === "http:" || shell.protocol === "https:") && target.origin === shell.origin
    );
  } catch {
    return false;
  }
}
