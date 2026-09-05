# Import feedback: native findings and bounded corrections

## Reproduced before changes

- iOS bulk selection: 25 files, 8 failures, 17 successful import/refresh operations. The first report inferred 5 new + 12 existing books from database state; **12 duplicates was not an observed toast counter**. Mobile reimport refreshes same-hash books. A later repeat showed 17 “imported”, 0 skipped with Library 17 → 17, exposing a separate Added/Updated accounting bug. The summary title appeared, but global `Toaster.descriptionStyle.display = "none"` hid all counts. Evidence: `evidence/ios-2026-09-05/import-summary-before-counts.png`.
- The English Details alert exposed Russian validation messages and the raw UMD parser message. Expected malformed files also triggered the development LogBox through `console.error` with the full provider URI. Evidence: `evidence/ios-2026-09-05/import-details-before-localization.png`.
- Android stalled URL download: notification occupied approximately y=150–421 on the 1080×2400 display, overlapping Library tabs at y=295–422. The device agent confirmed coordinate Cancel stopped loading and another URL prompt opened. UIAutomator reported a non-idle window during the spinner; this is not evidence of an accessibility defect.

## Corrections

- Only import summaries opt into visible descriptions, exposing imported/duplicate/failure counts. The global Toaster setting is unchanged.
- Optional `ImportBooksResult.failures[].code` preserves existing importer compatibility. Local format validation, container admission, conversion and persistence distinguish unsupported, empty, corrupt, too-large, unreadable-source, storage, content-restricted and unknown failures. Raw `error` remains diagnostic, not UI copy.
- Details translate categories through real English/Russian resources. Unknown/legacy errors receive a safe generic message. Provider directories, markup and raw exception text are not displayed; filenames remain bounded, with at most ten entries plus a remaining-count message.
- Expected source rejection logs an informational category and filename instead of a crash-like LogBox error. Unexpected storage/I/O failures remain error-level diagnostics. Import rejection, artifact cleanup and publication ordering are unchanged.
- URL download, chapter progress, commit and result use Sonner's existing bottom-center placement with native-tab clearance (Android 80 dp, iOS 49 dp); Sonner supplies the safe-area inset. Visible chapter progress retains Cancel. The commit phase still removes Cancel; there is no promise of rollback after commit starts.

## Verification

- Counts/localized Details/store categories: 13 behavioral failures reproduced before the change, followed by 63/63 passing tests.
- Bottom placement and visible chapter progress: 2 behavioral failures before the change, then 31/31 passing mounted hook tests.
- Original handoff: **8 suites, 140 passing tests** (`import-actions`, `library-import`, `import-source-validation`, `fbz-import-admission`, `import-format`, `fbz-metadata`, `import-ficbook`, `local-import-toast-contract`). After Added/Updated accounting and further regressions, the same eight suites plus `cloud-transfer-deadline` passed **165 tests in 9 suites** on the 11:22:31 follow-up (Node 26.8.1). This includes four cloud-deadline tests, not 165 import-only tests. Existing source-contract checks supplement, but do not replace, behavioral tests.
- App TypeScript check: exit 0. Biome check: exit 0. `git diff --check`: exit 0.
- Core localization checks are included in the passing full core suite. The reviewed English strings match Russian source keys; the current `english-source-revisions.ts` SHA-256 matches **Russian** `library.json`: `3b149cb33f09cd75825b11c0ff4fa7c12f683d2248e9c235b4a46cc93e8c2e35` (verified after Added/Updated strings).
- Independent root review accepted scoped visible counts and structured safe error categories. Subsequent Added/Updated accounting is a separate change and must retain inclusive `result.imported` compatibility for catalog callers.
- Android native after-check passed: [bottom URL loading](evidence/android-2026-09-05/url-loading-bottom.png) leaves Library header/Popular/My books and native tabs visible. The agent measured toast approximately y=1838–2105 versus native tabs y=2180–2338 (1080×2400); Library scroll worked during a stalled download. Physical Cancel removed loading within the next 700 ms screenshot; another URL prompt opened. This is an observed upper bound at screenshot cadence, not a performance benchmark.
- Android native truncated URL [summary](evidence/android-2026-09-05/import-error-summary.png) and [Details](evidence/android-2026-09-05/import-error-details.png) passed: one failure count visible, filename and safe localized reason visible, no private path/raw HTML. iOS final screenshots and latest refreshed-count native checks belong to the root/platform reports.
- Additional import-channel coverage, copy-on-write cloud fixes and remaining gates are recorded in [import-release-gates](import-release-gates-2026-09-05.md).

No new network service, native UI system, parser-size relaxation or deployment was introduced. Direct URL timeout remains 135 seconds; Ficbook retains its per-request 30-second timeout without an overall book-length deadline.
