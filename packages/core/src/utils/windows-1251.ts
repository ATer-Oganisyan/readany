/**
 * Conservative Windows-1251 detection for Russian prose, not a universal
 * charset detector. Call only after Unicode detection has failed.
 * Keep the mobile/core and standalone gateway implementations in sync.
 */
export function isLikelyWindows1251(bytes: Uint8Array) {
  // An explicit Unicode marker must never be overridden by a language guess.
  if ((bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
      (bytes[0] === 0xff && bytes[1] === 0xfe) ||
      (bytes[0] === 0xfe && bytes[1] === 0xff)) return false;

  const size = 8192;
  const starts = bytes.length <= size * 3
    ? [0]
    : [0, Math.floor((bytes.length - size) / 2), bytes.length - size];
  let sample = "";
  for (const start of starts) {
    const end = starts.length === 1 ? bytes.length : start + size;
    for (const byte of bytes.subarray(start, end)) {
      if (byte < 0x20 && byte !== 9 && byte !== 10 && byte !== 13) return false;
      // Only Russian letters and ASCII are needed for the language evidence.
      sample += byte >= 0xc0 ? String.fromCharCode(0x0410 + byte - 0xc0)
        : byte === 0xa8 ? "Ё" : byte === 0xb8 ? "ё"
        : byte < 0x80 ? String.fromCharCode(byte) : " ";
    }
    sample += " ";
  }

  const cyrillic = sample.match(/[А-Яа-яЁё]/g) || [];
  const latin = sample.match(/[a-z]/gi) || [];
  const lowercase = sample.match(/[а-яё]/g) || [];
  if (cyrillic.length < 24 ||
      cyrillic.length < (cyrillic.length + latin.length) * 0.5 ||
      lowercase.length < cyrillic.length * 0.75) return false;

  // GBK bytes can also look like Cyrillic. Require Russian word boundaries
  // and several distinct function words, rather than just a high-byte ratio.
  const words = sample.toLowerCase().match(/[a-zа-яё]+/g) || [];
  const common = new Set([
    "и", "в", "не", "на", "что", "он", "как", "это", "его", "но", "она",
    "к", "с", "а", "по", "из", "за", "от", "то", "о", "для", "был",
    "так", "все", "когда", "у", "же", "бы", "мы", "они", "до",
  ]);
  const matches = words.filter((word) => common.has(word));
  const vowels = (sample.match(/[аеёиоуыэюя]/gi) || []).length / cyrillic.length;
  return matches.length >= 3 && new Set(matches).size >= 2 &&
    vowels >= 0.2 && vowels <= 0.6;
}
