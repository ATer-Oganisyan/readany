const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const OLD_COLD_START = '    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)';
const COLD_START = `    // Let dev-launcher suppress most-recent before the explicit cold URL arrives.
    // Ordinary application links keep their existing launch/forward behavior.
    var launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    if let context = connectionOptions.urlContexts.first(where: { $0.url.host == "expo-development-client" }) {
      launchOptions = [.url: context.url]
    }
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)`;
const OLD_FORWARD_URL = '      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])';
const FORWARD_URL = `      var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
      if let sourceApplication = context.options.sourceApplication { options[.sourceApplication] = sourceApplication }
      if let annotation = context.options.annotation { options[.annotation] = annotation }
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: options)`;

function migrateSceneDelegate(contents) {
  const start = contents.indexOf("class SceneDelegate: UIResponder, UIWindowSceneDelegate");
  if (start < 0) throw new Error("Generated SceneDelegate was not found");
  // Skip strings and comments while finding this class's closing brace. Do not
  // rewrite matching snippets in user-owned sibling classes or AppDelegate.
  const tokens = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|[{}]/g;
  tokens.lastIndex = start;
  let depth = 0;
  for (let token; (token = tokens.exec(contents)); ) {
    if (token[0] === "{") depth++;
    if (token[0] === "}" && --depth === 0) {
      const end = tokens.lastIndex;
      const scene = contents.slice(start, end).replace(OLD_COLD_START, COLD_START).split(OLD_FORWARD_URL).join(FORWARD_URL);
      return contents.slice(0, start) + scene + contents.slice(end);
    }
  }
  throw new Error("Generated SceneDelegate boundary was not found");
}

const SCENE_CONFIGURATION_METHOD = `
  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(
      name: "Default Configuration",
      sessionRole: connectingSceneSession.role
    )
    configuration.delegateClass = SceneDelegate.self
    return configuration
  }

`;

const SCENE_DELEGATE = `
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? {
    UIApplication.shared.delegate as? AppDelegate
  }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
${COLD_START}

    for context in connectionOptions.urlContexts {
${FORWARD_URL}
    }
    for userActivity in connectionOptions.userActivities {
      _ = appDelegate.application(
        UIApplication.shared,
        continue: userActivity,
        restorationHandler: { _ in }
      )
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate else { return }
    for context in URLContexts {
${FORWARD_URL}
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate else { return }
    _ = appDelegate.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }
}

`;

const STATUS_BAR_ROOT_CONTROLLER_FACTORY = `
  override func createRootViewController() -> UIViewController {
    NarraRootViewController()
  }

`;

const STATUS_BAR_ROOT_CONTROLLER = `
private final class NarraRootViewController: UIViewController {
  override var childForStatusBarHidden: UIViewController? {
    children.last
  }

  override var childForStatusBarStyle: UIViewController? {
    children.last
  }

  override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation {
    children.last?.preferredStatusBarUpdateAnimation ?? .fade
  }
}
`;

module.exports = function withIosSceneLifecycle(config) {
  const withSceneManifest = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return mod;
  });

  return withAppDelegate(withSceneManifest, (mod) => {
    if (mod.modResults.language !== "swift") {
      throw new Error("withIosSceneLifecycle supports only a Swift AppDelegate");
    }

    let contents = mod.modResults.contents;
    contents = contents.replace(
      /#if os\(iOS\) \|\| os\(tvOS\)\n {4}window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif\n\n/,
      "",
    );

    if (!contents.includes("configurationForConnecting connectingSceneSession")) {
      contents = contents.replace(
        "  // Linking API\n",
        `${SCENE_CONFIGURATION_METHOD}  // Linking API\n`,
      );
    }
    if (!contents.includes("class SceneDelegate: UIResponder, UIWindowSceneDelegate")) {
      contents = contents.replace(
        "class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {",
        `${SCENE_DELEGATE}class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {`,
      );
    }
    // Migrate the prior generated delegate in place; retain unrelated overrides.
    contents = migrateSceneDelegate(contents);
    if (!contents.includes("NarraRootViewController()")) {
      contents = contents.replace(
        "class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {\n  // Extension point for config-plugins\n",
        `class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {\n  // Extension point for config-plugins\n${STATUS_BAR_ROOT_CONTROLLER_FACTORY}`,
      );
    }
    if (!contents.includes("private final class NarraRootViewController")) {
      contents = `${contents.trimEnd()}\n${STATUS_BAR_ROOT_CONTROLLER}\n`;
    }

    mod.modResults.contents = contents;
    return mod;
  });
};
