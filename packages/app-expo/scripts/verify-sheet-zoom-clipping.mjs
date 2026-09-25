// Run: node scripts/verify-sheet-zoom-clipping.mjs (macOS with Xcode).
// Executes the production Swift dismissal body with UIKit doubles. Checks cleanup;
// the visual spring still needs a recording on iOS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const source = readFileSync(new URL("../modules/native-controls/ios/SystemSheetZoom.swift", import.meta.url), "utf8");
const body = source.match(/          \/\/ UIKit animates[\s\S]*?if !registered \{ restoreClipping\(\) \}/)?.[0];
assert.ok(body, "Swift dismissal cleanup must be present");
const result = spawnSync("xcrun", ["swift", "-"], {
  encoding: "utf8",
  input: `
class UIView {
  var superview: UIView?
  var clipsToBounds: Bool
  init(_ parent: UIView? = nil, _ clips: Bool = true) {
    superview = parent; clipsToBounds = clips
  }
}
class UIWindow: UIView {}
class SystemSheetZoomSourceView: UIView {
  var returns = 0
  func onZoomReturn() { returns += 1 }
}
struct Transition { let isCancelled: Bool }
class Coordinator {
  let accepts: Bool
  var completion: ((Transition) -> Void)?
  init(_ accepts: Bool) { self.accepts = accepts }
  func animate(alongsideTransition: ((Transition) -> Void)?, completion: @escaping (Transition) -> Void) -> Bool {
    if accepts { self.completion = completion }
    return accepts
  }
}
func prepare(_ source: UIView?, _ identifier: String, _ coordinator: Coordinator) {
${body}
}
for identifier in ["reader:book", "catalog:book", "toolbar"] {
  for accepted in [true, false] {
    for cancelled in [true, false] {
      let window = UIWindow()
      let root = UIView(window, false)
      let pager = UIView(root)
      let page = UIView(pager)
      let cover = SystemSheetZoomSourceView(page)
      let coordinator = Coordinator(accepted)
      prepare(cover, identifier, coordinator)
      let shouldClip = !accepted || identifier == "toolbar"
      precondition(pager.clipsToBounds == shouldClip && page.clipsToBounds == shouldClip)
      precondition(window.clipsToBounds && !root.clipsToBounds && cover.clipsToBounds)
      coordinator.completion?(Transition(isCancelled: cancelled))
      precondition(pager.clipsToBounds && page.clipsToBounds, "restore on success AND cancellation")
      precondition(!root.clipsToBounds && window.clipsToBounds && cover.clipsToBounds)
      precondition(cover.returns == (accepted && !cancelled ? 1 : 0))
    }
  }
}
prepare(nil, "reader:missing", Coordinator(false))
print("Zoom clipping: return, cancellation, rejected coordinator and unrelated sources passed")
`,
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
assert.equal(result.status, 0, result.error?.message ?? "Swift cleanup checks failed");
