type ReaderFileInfo = { exists: boolean; md5?: string };

interface ReaderAssetIO {
  download: (uri: string, md5: string) => Promise<string>;
  inspect: (uri: string) => Promise<ReaderFileInfo>;
}

/** Local/embedded assets remain offline; version only HTTP asset URLs. */
export function versionReaderAssetUri(uri: string, md5: string): string {
  if (!/^https?:\/\//i.test(uri)) return uri;
  const url = new URL(uri);
  url.searchParams.set("hash", md5);
  url.searchParams.set("readerVersion", md5);
  return url.toString();
}

/** Share concurrent preparation, but recheck disk on the next book open. */
export function createReaderAssetLoader(io: ReaderAssetIO) {
  const pending = new Map<string, Promise<string>>();
  return (uri: string, md5: string): Promise<string> => {
    if (!/^[a-f\d]{32}$/i.test(md5)) return Promise.reject(new Error("Invalid reader build ID"));
    const source = versionReaderAssetUri(uri, md5);
    const key = `${md5}:${source}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const preparation = Promise.resolve()
      .then(async () => {
        const localUri = await io.download(source, md5);
        const file = await io.inspect(localUri);
        if (!file.exists || file.md5 !== md5) {
          throw new Error("Reader asset does not match the current build");
        }
        return localUri;
      })
      .finally(() => pending.delete(key));
    pending.set(key, preparation);
    return preparation;
  };
}
