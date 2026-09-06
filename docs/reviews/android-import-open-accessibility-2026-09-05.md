# Android file import → Open: accessibility regression

## Reproduction (not accepted)

LOCAL Android `emulator-5556`, native RN0.86.3 dev-client, JS `2ac0d97`.
Own fixture `07-garden-cp1251.txt` selected through the native Files picker.
Maestro selected the filename successfully, then failed to find `Open` after
7.296 seconds. Its failure screenshot still shows the complete success toast,
`Added: 1 · updated: 0 · skipped: 0 · failed: 0`, and the Open button.
The simultaneous hierarchy JSON contains the new book's card but neither Open
nor the notification text. Root independently inspected both artifacts.

Preserved evidence: [screenshot](evidence/android-import-open/before-visible-open-missing-ax.png)
and [native hierarchy](evidence/android-import-open/before-hierarchy.json).

Artifacts (private local QA directory):
`/private/tmp/narra07-open-maestro/2026-09-05_225434/LOCAL Android file import Open CTA/`

- Screenshot: `screenshots/step-005-assertCondition-Open.png`.
- Hierarchy: `screen-hierarchy/step-005-assertCondition-Open.json`.
- Commands: `commands.json`.

Import itself succeeded: 8 → 9 books. No existing books were removed, no data
reset, and no CTA press occurred. This is stronger evidence than the earlier
manual-tool timeout, but does not yet prove a TalkBack-specific failure or an
ordinary touch failure. The same visible button must be retested after a fix.

## Cause under investigation

Installed sonner-native Positioner is absolutely positioned with no height or
opposite edge; its toast children are absolute too. Android elevation makes
the notification visible outside the resulting container bounds. A zero-height
ancestor can explain why native traversal omits the subtree. This remains a
causal hypothesis until the final native reproduction changes its outcome.

Fix requirements: preserve safe-area positioning, leave iOS unchanged, keep
touches outside notifications passing to the library/reader, and remove any
empty blocking layer after dismissal. Mounted JS checks must execute the actual
adapter and cannot substitute for native hierarchy and Open → Reader evidence.

## Implemented candidate and host checks

`ec7fb6c` extends Android top/bottom Positioner to its parent's opposite edge.
Top notifications keep the original safe-area `top`; bottom notifications keep
the original `bottom`. Center and iOS geometry are unchanged. Both shipped
module JS and source TS are changed through the existing pnpm patch, not by
editing node_modules. Lockfile changes are only the three patch-hash references.

Independent review checked toast anchoring, stack offsets, the separate expanded
outside pressable, root/reader parent sizing, and empty-layer pointer handling.
It found no blocker, but native hit-testing remains a gate; oversized stacks
and simultaneous top/bottom stacks are not fully covered.

- Actual installed old adapter: two geometry regressions fail, two other cases pass.
- Frozen offline install of `ec7fb6c` in isolated checkout: 27 related tests pass,
  including actual installed Positioner, host ownership, overlay and gesture tests.
- Full isolated mobile suite: 1738 PASS; TypeScript PASS; dependency checker PASS.
- MAIN dependencies remain untouched (RN0.86.2 for the separate TEST runtime).
- LOCAL Android cold activity launch: 1454 ms; Metro bundle: 3960 ms. Neither
  value is a reader time-to-interactive or a comparable performance improvement.

## Native post-fix result

Same LOCAL emulator/client, `ec7fb6c`, fresh own `09-nested.fb2.zip` selected
through Files. Maestro exited 0: filename selection → Open visible → semantic
tap on Open → Book actions visible / My books absent. Root independently read
the completed commands and inspected the Reader screenshot with real Russian
book text. This accepts the bounded file-picker Open transition, not all import
formats or TalkBack operation.

- [Visible notification](evidence/android-import-open/after-visible-open.png).
- [Reader after Open](evidence/android-import-open/after-open-reader.png).
- [Actual completed commands](evidence/android-import-open/after-commands.json).

The Open assertion completed in 148 ms after file-selection command completion;
before the fix it timed out at 7.296 seconds while Open remained visible. These
are automation command durations on different fresh fixtures, not import latency
or a throughput improvement. The success notification remains visible in the
immediate Reader screenshot; dismissal and subsequent navigation are checked
separately. No repeat model call, backend configuration change, or deployment
was involved.

Follow-up native checks passed: notification disappears, Back → Popular → My
books remains operable, and the imported book reopens at its first text page.
[Settled reopened Reader](evidence/android-import-open/after-reopen-reader.png)
and [final Library](evidence/android-import-open/after-final-library.png).
Root compared the persisted baseline/final library snapshots: all nine original
IDs and progress values remain; seven existing CFI anchors are identical, and
the two unread books still have no CFI. Their checkpoint fields are unchanged.
These are persisted library snapshots, not a direct audit of all SQLite tables.

New book ID: `a8870223-629d-413d-afc3-9722cc184f9d`, progress
`0.031068193886570464`, CFI `epubcfi(/6/2!/4/2[chapter-1],/2,/8/1:74)`.
Final book count is 10. No book was deleted. The agent found no new fatal entry
in the existing crash buffer; this is not a long-running crash-free guarantee.

The executed flow is preserved as
`packages/app-expo/.maestro/android-file-picker-open-bounds.yaml` with a filename
parameter; its YAML parses, and its equivalent fixed-filename commands are the
ones captured above. It requires a fresh reviewed file and an already-open native
picker; it deliberately does not reset data or launch another environment.

Remaining UX detail: Open does not immediately dismiss the result toast, so it
briefly obscures the top of the Reader until its timer finishes. The installed
ToastButton invokes the action without auto-dismissal; this is separate from the
fixed native bounds defect and remains a follow-up improvement.
