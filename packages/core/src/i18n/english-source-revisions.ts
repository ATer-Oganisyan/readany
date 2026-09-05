/**
 * SHA-256 of each Russian source locale after its English counterpart was
 * reviewed. When Russian copy changes, the localization test fails until the
 * matching English file is updated and this revision is refreshed.
 */
export const ENGLISH_SOURCE_REVISIONS = {
  "chat.json": "d7e912b4f69342fc66bd686fd2dc47e9528fdbf6ff5e73224c7f39a633055177",
  "common.json": "b417028d4f32dcfc2474eb95262347be40809ef44e97963430b1eaf13ef59472",
  "library.json": "f255a6ed1423c5a351aadf5ff1191bbc64fce0f7b9ddab23967ac27e147ebf10",
  "misc.json": "7b47e4fe8a63f11be0ff7b7a82f887bcb7ab65312f8f9ded55a95c6706eec7f7",
  "notes.json": "683f3787f0623036bdf9274313888ad778b25338ddbb103026dfdbc5e56a87af",
  "onboarding.json": "691446f63699c6a6391e3adacc65f2a197943880cdfdf678e1383c8bc298a750",
  "profile.json": "7f64cf3d63d528b5016c75688ba8d8745397e999dc12c31b037355b164a35aed",
  "reader.json": "a38d52fa5b3a29a5a2861ff3ff44c9d701f062b914c389aee522111af1e27fbf",
  "settings.json": "d7ea3526cf6c5750d0d330dcfbb02396445175f6e1eabfc1ed96854383088d46",
  "stats.json": "3494f4ea5d32428462edbb41a005811b4614399be8391a31ac50592bba8ea48a",
  "translation.json": "d0808cbaae51cd2cfc017d0c0bec9c6fe482adfed8e23e4150a6c440af63aa49",
  "tts.json": "65d2e931451e14c341289cb6950e1fcd314b70853da5e0711fa512f75d8d350a",
} as const;
