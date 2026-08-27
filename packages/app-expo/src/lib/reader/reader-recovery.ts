/** Only retry transport failures automatically; malformed books need a real error. */
export function isReaderTransportError(message: string): boolean {
  return /load failed|failed to fetch|network request failed|networkerror|reader file server is unavailable|reader operation timed out/i.test(
    message,
  );
}
