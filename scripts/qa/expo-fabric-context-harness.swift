import Foundation
import ObjectiveC

// Actual injected initializer below; controlled Foundation view/module fixtures.
// Replace the terminal trap with a deterministic subprocess exit (no OS crash UI).
func fatalError(_ message: @autoclosure () -> String) -> Never {
  print("TERMINAL: \(message())")
  exit(86)
}
struct Logger { func error(_ message: String) { print("SAFE FALLBACK") } }
let log = Logger()
enum Exceptions { struct AppContextLost { let reason = "The app context has been lost" } }
var contextDeaths = 0
var viewDeaths = 0
class AppContext {
  let moduleRegistry = Registry()
  deinit { contextDeaths += 1 }
}
class Registry {
  var holder: Holder? = Holder()
  func get(moduleHolderForName: String) -> Holder? { holder }
}
class Holder { let definition = Definition() }
class Definition { var views: [String: ViewDefinition] = ["view": ViewDefinition()] }
enum CreatedView { case uikit(ExpoFabricView), swiftui(AnyObject) }
class ViewDefinition {
  var failsCreation = false
  func createView(appContext: AppContext) -> CreatedView? {
    if failsCreation { return nil }
    let view = LiveView(appContext: appContext)
    view.eventsInstalled = true
    return .uikit(view)
  }
}
@objc class ExpoFabricView: NSObject {
  weak var appContext: AppContext?
  var eventsInstalled = false
  required init(appContext: AppContext?) { self.appContext = appContext; super.init() }
  deinit { viewDeaths += 1 }
  // ACTUAL_INITIALIZER
}
class LiveView: ExpoFabricView {}

func makeView(_ cls: AnyClass) -> AnyObject {
  let selector = NSSelectorFromString("new")
  let method = class_getClassMethod(cls, selector)!
  typealias New = @convention(c) (AnyClass, Selector) -> Unmanaged<AnyObject>
  return unsafeBitCast(method_getImplementation(method), to: New.self)(cls, selector).takeRetainedValue()
}
let mode = CommandLine.arguments[1]
let cls: AnyClass = objc_allocateClassPair(ExpoFabricView.self, "NarraFabricFixture", 0)!
if mode != "unregistered" { objc_registerClassPair(cls) }
var context: AppContext? = AppContext()
weak var oldContext = context
ExpoFabricView.injectInitializer(appContext: context!, moduleName: "module", viewName: "view", toViewClass: cls)
if mode == "missing-module" { context!.moduleRegistry.holder = nil; _ = makeView(cls); exit(2) }
if mode == "missing-view" { context!.moduleRegistry.holder!.definition.views = [:]; _ = makeView(cls); exit(3) }
if mode == "create-failed" { context!.moduleRegistry.holder!.definition.views["view"]!.failsCreation = true; _ = makeView(cls); exit(4) }
if mode == "live" {
  autoreleasepool {
    let view = makeView(cls) as! LiveView
    precondition(view.appContext === context && view.eventsInstalled)
  }
  context = nil
  precondition(oldContext == nil && contextDeaths == 1 && viewDeaths == 1)
  print("Live initializer/events/ownership PASS")
  exit(0)
}
// Runtime teardown leaves its cached class/initializer available to Fabric.
context = nil
precondition(oldContext == nil && contextDeaths == 1)
autoreleasepool {
  let view = makeView(cls) as! ExpoFabricView
  let expectedClass: AnyClass = ProcessInfo.processInfo.environment["NARRA_BASE_FALLBACK"] == "1" ? ExpoFabricView.self : cls
  precondition(object_getClass(view) === expectedClass && view.appContext == nil && !view.eventsInstalled)
  if mode == "unregistered" {
    // macOS Foundation may tolerate this, while iOS AX asks additional class
    // metadata questions. Inspect raw ObjC class before Swift type metadata or
    // Bundle(for:) can realize/register it implicitly on this host runtime.
    let instanceClass: AnyClass = object_getClass(view)!
    let className = String(cString: class_getName(instanceClass))
    if objc_lookUpClass(className) !== instanceClass {
      print("UNREGISTERED_INSTANCE_CLASS")
      exit(87)
    }
    _ = Bundle(for: type(of: view))
    _ = view.responds(to: NSSelectorFromString("narraMissingAccessibilitySelector"))
  }
}
precondition(viewDeaths == 1)
// Re-registration must restore actual module-backed view construction.
context = AppContext()
weak var newContext = context
ExpoFabricView.injectInitializer(appContext: context!, moduleName: "module", viewName: "view", toViewClass: cls)
autoreleasepool {
  let view = makeView(cls) as! LiveView
  precondition(view.appContext === context && view.eventsInstalled)
}
context = nil
precondition(newContext == nil && contextDeaths == 2 && viewDeaths == 2)
print("Dead-context fallback, reinjection/events, no retained contexts or views PASS")
