import UIKit

func ts() -> String {
  String(format: "%.4f", CACurrentMediaTime())
}

func log(_ msg: String) {
  NSLog("PROBE %@ %@", ts(), msg)
}

final class ChildObserverVC: UIViewController {
  override func viewWillTransition(
    to size: CGSize,
    with coordinator: any UIViewControllerTransitionCoordinator
  ) {
    super.viewWillTransition(to: size, with: coordinator)
    log("CHILD viewWillTransition size=\(size) insideAnimateChanges=\(SheetVC.insideAnimateChanges) sinceReturn=\(SheetVC.animateChangesReturned)")
    let registered = coordinator.animate(alongsideTransition: nil) { _ in
      log("CHILD coordinator completion fired")
    }
    log("CHILD coordinator.animate registered=\(registered)")
  }
}

final class SheetVC: UIViewController {
  static var insideAnimateChanges = false
  static var animateChangesReturned = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemTeal
    let child = ChildObserverVC()
    addChild(child)
    child.view.frame = view.bounds
    child.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    child.view.isHidden = true
    child.view.isUserInteractionEnabled = false
    view.addSubview(child.view)
    child.didMove(toParent: self)
  }

  override func viewWillTransition(
    to size: CGSize,
    with coordinator: any UIViewControllerTransitionCoordinator
  ) {
    super.viewWillTransition(to: size, with: coordinator)
    log("SHEET viewWillTransition size=\(size) insideAnimateChanges=\(SheetVC.insideAnimateChanges) sinceReturn=\(SheetVC.animateChangesReturned)")
  }

  override func viewWillLayoutSubviews() {
    super.viewWillLayoutSubviews()
    log("SHEET viewWillLayoutSubviews bounds=\(view.bounds.size)")
  }
}

final class RootVC: UIViewController {
  private var presented = false
  private let sheetVC = SheetVC()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !presented else { return }
    presented = true

    sheetVC.modalPresentationStyle = .formSheet
    if let sheet = sheetVC.sheetPresentationController {
      let mediumish = UISheetPresentationController.Detent.custom(identifier: .init("m55")) { ctx in
        ctx.maximumDetentValue * 0.55
      }
      sheet.detents = [mediumish, .large()]
      sheet.selectedDetentIdentifier = .init("m55")
      sheet.prefersGrabberVisible = true
    }
    log("presenting sheet")
    present(sheetVC, animated: true) {
      log("present completion")
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
        self?.expand()
      }
    }
  }

  private func expand() {
    guard let sheet = sheetVC.sheetPresentationController else { return }
    log("BEFORE animateChanges (expand to large), selected=\(String(describing: sheet.selectedDetentIdentifier))")
    SheetVC.insideAnimateChanges = true
    sheet.animateChanges {
      sheet.selectedDetentIdentifier = .large
    }
    SheetVC.insideAnimateChanges = false
    SheetVC.animateChangesReturned = true
    log("AFTER animateChanges returned (expand)")
    DispatchQueue.main.async {
      log("NEXT RUNLOOP after expand animateChanges")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
      self?.collapse()
    }
  }

  private func collapse() {
    guard let sheet = sheetVC.sheetPresentationController else { return }
    SheetVC.animateChangesReturned = false
    log("BEFORE animateChanges (collapse to m55), selected=\(String(describing: sheet.selectedDetentIdentifier))")
    SheetVC.insideAnimateChanges = true
    sheet.animateChanges {
      sheet.selectedDetentIdentifier = .init("m55")
    }
    SheetVC.insideAnimateChanges = false
    SheetVC.animateChangesReturned = true
    log("AFTER animateChanges returned (collapse)")
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
      log("DONE")
      exit(0)
    }
  }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = RootVC()
    window.makeKeyAndVisible()
    self.window = window
    log("scene connected")
  }
}

final class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    log("app launched")
    return true
  }

  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let config = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
    config.delegateClass = SceneDelegate.self
    return config
  }
}

_ = UIApplicationMain(
  CommandLine.argc,
  CommandLine.unsafeArgv,
  nil,
  NSStringFromClass(AppDelegate.self)
)
