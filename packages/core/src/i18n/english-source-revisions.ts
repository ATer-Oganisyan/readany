/**
 * SHA-256 of each Russian source locale after its English counterpart was
 * reviewed. When Russian copy changes, the localization test fails until the
 * matching English file is updated and this revision is refreshed.
 */
export const ENGLISH_SOURCE_REVISIONS = {
  "chat.json": "d7e912b4f69342fc66bd686fd2dc47e9528fdbf6ff5e73224c7f39a633055177",
  "common.json": "624515360d0b7de35ee1c58c6e9aca15929fd9812dc9f265b5442ac78c8983a5",
  "library.json": "495184ecdb53f1f67bdc42531d3f94d548aaf2edd676a240ba800b72b44b48bd",
  "misc.json": "7b47e4fe8a63f11be0ff7b7a82f887bcb7ab65312f8f9ded55a95c6706eec7f7",
  "notes.json": "5ddfa5e0ab9b117eb282456810293b4bebedfaf95338c26c40746c7b2de21604",
  "onboarding.json": "691446f63699c6a6391e3adacc65f2a197943880cdfdf678e1383c8bc298a750",
  "profile.json": "7f64cf3d63d528b5016c75688ba8d8745397e999dc12c31b037355b164a35aed",
  "reader.json": "07b4e5abdf4bc4496285dbda0f63209dae0472338291a271b30aad2fb7ae3814",
  "settings.json": "d6db9cb9ca2637bcac076a153f10050ddbf06c1ee5a4459991cfdb50e9ab72eb",
  "stats.json": "3494f4ea5d32428462edbb41a005811b4614399be8391a31ac50592bba8ea48a",
  "translation.json": "d0808cbaae51cd2cfc017d0c0bec9c6fe482adfed8e23e4150a6c440af63aa49",
  "tts.json": "ba0ee35eb0eab6e51482d5e34732c285d2b0c98caec5b162ed282fe0cb62062b",
} as const;
