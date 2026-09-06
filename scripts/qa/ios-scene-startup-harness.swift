import Foundation
class UIResponder: NSObject {}
protocol UIWindowSceneDelegate {}
protocol UIUserActivityRestoring {}
class UIScene: NSObject {
  struct ConnectionOptions {
    var urlContexts = Set<UIOpenURLContext>()
    var userActivities = Set<NSUserActivity>()
  }
}
class UIWindowScene: UIScene {}
class UISceneSession: NSObject {}
class UIWindow: NSObject { init(windowScene: UIWindowScene) {} }
class UIURLOptions {
  var sourceApplication: String? = "fixture.sender"
  var annotation: Any? = "fixture.annotation"
  var openInPlace = true
}
class UIOpenURLContext: NSObject {
  let url: URL
  let options = UIURLOptions()
  init(_ value: String) { url = URL(string: value)! }
}
class UIApplication {
  static let shared = UIApplication()
  var delegate: AnyObject?
  enum LaunchOptionsKey: String { case url = "UIApplicationLaunchOptionsURLKey" }
  enum OpenURLOptionsKey { case sourceApplication, annotation, openInPlace }
}
class Factory {
  var loads = 0
  var starts = 0
  func startReactNative(withModuleName: String, in window: UIWindow, launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
    starts += 1
    let dictionary = Dictionary(uniqueKeysWithValues: (launchOptions ?? [:]).map { ($0.key.rawValue, $0.value) })
    // Calls the actual installed ObjC dev-launcher admission condition.
    loads += Int(NarraAutoLaunch(dictionary))
  }
}
class AppDelegate {
  var window: UIWindow?
  var reactNativeFactory: Factory? = Factory()
  var forwards = 0
  var activities = 0
  var lastOptions: [UIApplication.OpenURLOptionsKey: Any] = [:]
  func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any]) -> Bool {
    forwards += 1; lastOptions = options
    if url.host == "expo-development-client" { reactNativeFactory!.loads += 1 }
    return true
  }
  func application(_ app: UIApplication, continue activity: NSUserActivity, restorationHandler: ([UIUserActivityRestoring]?) -> Void) -> Bool { activities += 1; return true }
  func applicationDidBecomeActive(_ app: UIApplication) {}
  func applicationWillResignActive(_ app: UIApplication) {}
  func applicationDidEnterBackground(_ app: UIApplication) {}
  func applicationWillEnterForeground(_ app: UIApplication) {}
}
// ACTUAL_SCENE_DELEGATE
let mode = CommandLine.arguments[1]
let app = AppDelegate()
UIApplication.shared.delegate = app
let scene = SceneDelegate()
let dev = UIOpenURLContext("readany-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8082")
let custom = UIOpenURLContext("readany://book/fixture")
var connection = UIScene.ConnectionOptions()
if mode == "cold" { connection.urlContexts = [dev] }
if mode == "custom" { connection.urlContexts = [custom] }
if mode == "universal" { connection.userActivities = [NSUserActivity(activityType: "fixture")] }
scene.scene(UIWindowScene(), willConnectTo: UISceneSession(), options: connection)
if mode == "warm" { scene.scene(UIWindowScene(), openURLContexts: [dev]) }
if mode != "no-url" && mode != "universal" {
  precondition(app.forwards == 1)
  precondition(app.lastOptions[.sourceApplication] as? String == "fixture.sender")
  precondition(app.lastOptions[.annotation] as? String == "fixture.annotation")
  precondition(app.lastOptions[.openInPlace] as? Bool == true)
}
precondition(app.reactNativeFactory!.starts == 1)
if mode == "universal" { precondition(app.activities == 1) }
print(app.reactNativeFactory!.loads)
