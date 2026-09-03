import { isLikelyWindows1251 } from "@readany/core/utils/windows-1251";

// The injected legacy decoder is the existing text-encoding polyfill on
// Hermes; keep native UTF-8 decoding for the common path.
export function ensureTxtUtf8Bytes(
  bytes: Uint8Array,
  LegacyTextDecoder: typeof TextDecoder,
): Uint8Array {
  // Check BOM markers
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes; // UTF-8 with BOM
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    const text = new LegacyTextDecoder("utf-16le").decode(bytes);
    return new TextEncoder().encode(text);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const text = new LegacyTextDecoder("utf-16be").decode(bytes);
    return new TextEncoder().encode(text);
  }

  // Try strict UTF-8 validation on a sample.
  // IMPORTANT: must align the sample end to a UTF-8 character boundary,
  // otherwise a multi-byte char split at the boundary causes a false failure.
  let sampleEnd = Math.min(bytes.length, 64 * 1024);
  // Back up past any UTF-8 continuation bytes (10xxxxxx = 0x80-0xBF) at the end
  while (sampleEnd > 0 && sampleEnd < bytes.length && ((bytes[sampleEnd] ?? 0) & 0xc0) === 0x80) {
    sampleEnd--;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, sampleEnd));
    if (bytes.length > sampleEnd * 2) {
      let midStart = Math.floor(bytes.length / 2);
      // Align mid-sample start to a UTF-8 character boundary
      while (midStart < bytes.length && ((bytes[midStart] ?? 0) & 0xc0) === 0x80) {
        midStart++;
      }
      let midEnd = Math.min(midStart + 8192, bytes.length);
      while (midEnd > midStart && midEnd < bytes.length && ((bytes[midEnd] ?? 0) & 0xc0) === 0x80) {
        midEnd--;
      }
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(midStart, midEnd));
    }
    console.log("[ensureUtf8Bytes] passed UTF-8 validation");
    return bytes; // Valid UTF-8
  } catch {
    // Not valid UTF-8 — detect which encoding it is
  }

  // Disambiguate GBK/GB18030 vs Shift-JIS by counting distinctive byte patterns.
  // GBK double-byte: lead 0xA1-0xFE, trail 0xA1-0xFE (dominant in Chinese text)
  // Shift-JIS distinctive: lead 0x81-0x9F (below GBK lead range)
  const sample = bytes.subarray(0, Math.min(4096, bytes.length));
  let highBytes = 0;
  for (let i = 0; i < sample.length; i++) {
    if ((sample[i] ?? 0) >= 0x80) highBytes++;
  }
  const highRatio = sample.length > 0 ? highBytes / sample.length : 0;

  let gbkPairs = 0;
  let sjisDistinctPairs = 0;
  for (let i = 0; i < sample.length - 1; i++) {
    const b1 = sample[i] ?? 0;
    const b2 = sample[i + 1] ?? 0;
    if (b1 >= 0xa1 && b1 <= 0xfe && b2 >= 0xa1 && b2 <= 0xfe) {
      gbkPairs++;
      i++;
    } else if (
      b1 >= 0x81 &&
      b1 <= 0x9f &&
      ((b2 >= 0x40 && b2 <= 0x7e) || (b2 >= 0x80 && b2 <= 0xfc))
    ) {
      sjisDistinctPairs++;
      i++;
    }
  }

  const isShiftJIS = sjisDistinctPairs > 0 && sjisDistinctPairs > gbkPairs;
  const encoding = isLikelyWindows1251(bytes) ? "windows-1251"
    : isShiftJIS ? "shift_jis" : highRatio > 0.1 ? "gb18030" : "gbk";
  console.log(`[ensureUtf8Bytes] Detected non-UTF-8 encoding: ${encoding}, converting to UTF-8`);

  try {
    const text = new LegacyTextDecoder(encoding).decode(bytes);
    return new TextEncoder().encode(text);
  } catch (err) {
    console.warn("[ensureUtf8Bytes] Polyfill decode failed, returning raw bytes:", err);
    return bytes;
  }
}
