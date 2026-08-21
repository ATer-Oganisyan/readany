import QuartzCore
import UIKit

private enum RearmMode: String {
  case keep
  case immediate
  case transaction
  case delayed

  static var current: RearmMode {
    let arguments = ProcessInfo.processInfo.arguments
    if arguments.contains("--immediate") { return .immediate }
    if arguments.contains("--transaction") { return .transaction }
    if arguments.contains("--delayed") { return .delayed }
    return .keep
  }
}

private func logProbe(_ message: String) {
  NSLog("DYNAMIC_MORPH_PROBE %.6f %@", CACurrentMediaTime(), message)
}

private final class DynamicSheetViewController: UIViewController {
  var expand: (() -> Void)?
  private let mode: RearmMode

  init(mode: RearmMode) {
    self.mode = mode
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    let label = UILabel()
    label.translatesAutoresizingMaskIntoConstraints = false
    label.font = .preferredFont(forTextStyle: .title2)
    label.textAlignment = .center
    label.numberOfLines = 0
    label.text = "Dynamic detent: \(mode.rawValue)"

    let button = UIButton(type: .system)
    button.translatesAutoresizingMaskIntoConstraints = false
    button.configuration = .filled()
    button.configuration?.title = "Expand to large"
    button.accessibilityIdentifier = "expand-button"
    button.addTarget(self, action: #selector(expandTapped), for: .touchUpInside)

    let content = UIView()
    content.translatesAutoresizingMaskIntoConstraints = false
    content.backgroundColor = .systemTeal.withAlphaComponent(0.2)
    content.layer.cornerRadius = 24

    view.addSubview(label)
    view.addSubview(button)
    view.addSubview(content)
    NSLayoutConstraint.activate([
      label.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20),
      label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      button.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 16),
      button.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      content.topAnchor.constraint(equalTo: button.bottomAnchor, constant: 20),
      content.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
      content.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
      content.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -20),
    ])
  }

  @objc private func expandTapped() {
    expand?()
  }
}

private final class RootViewController: UIViewController, UIAdaptivePresentationControllerDelegate {
  private let mode = RearmMode.current
  private let source = UIButton(type: .system)
  private weak var activeSheetController: DynamicSheetViewController?
  private var providerCalls = 0

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    let title = UILabel()
    title.translatesAutoresizingMaskIntoConstraints = false
    title.font = .preferredFont(forTextStyle: .title1)
    title.numberOfLines = 0
    title.text = "Zoom after detent resize\n\(mode.rawValue)"

    source.translatesAutoresizingMaskIntoConstraints = false
    source.configuration = .filled()
    source.configuration?.title = "Chat"
    source.accessibilityIdentifier = "morph-source-button"
    source.addTarget(self, action: #selector(presentSheet), for: .touchUpInside)

    view.addSubview(title)
    view.addSubview(source)
    NSLayoutConstraint.activate([
      title.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 40),
      title.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      source.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
      source.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
      source.widthAnchor.constraint(greaterThanOrEqualToConstant: 72),
      source.heightAnchor.constraint(equalToConstant: 44),
    ])
    logProbe("ROOT mode=\(mode.rawValue)")
  }

  @objc private func presentSheet() {
    let controller = DynamicSheetViewController(mode: mode)
    controller.modalPresentationStyle = .formSheet
    guard let sheet = controller.sheetPresentationController else { return }

    let mediumID = UISheetPresentationController.Detent.Identifier("medium-55")
    sheet.detents = [
      .custom(identifier: mediumID) { $0.maximumDetentValue * 0.55 },
      .large(),
    ]
    sheet.selectedDetentIdentifier = mediumID
    sheet.prefersGrabberVisible = true
    controller.presentationController?.delegate = self
    controller.expand = { [weak self, weak controller] in
      guard let self, let controller, let sheet = controller.sheetPresentationController else { return }
      resize(controller: controller, sheet: sheet)
    }
    installZoom(on: controller, reason: "initial")
    activeSheetController = controller
    present(controller, animated: true)
  }

  private func resize(
    controller: DynamicSheetViewController,
    sheet: UISheetPresentationController
  ) {
    logProbe("RESIZE_BEGIN mode=\(mode.rawValue) bounds=\(controller.view.bounds)")

    switch mode {
    case .keep:
      sheet.animateChanges { sheet.selectedDetentIdentifier = .large }
      logProbe("ANIMATE_RETURN keep bounds=\(controller.view.bounds)")

    case .immediate:
      controller.preferredTransition = nil
      sheet.animateChanges { sheet.selectedDetentIdentifier = .large }
      logProbe("ANIMATE_RETURN immediate bounds=\(controller.view.bounds)")
      installZoom(on: controller, reason: "immediate")

    case .transaction:
      controller.preferredTransition = nil
      CATransaction.begin()
      CATransaction.setCompletionBlock { [weak self, weak controller] in
        guard let self, let controller else { return }
        logProbe("TRANSACTION_COMPLETION bounds=\(controller.view.bounds)")
        installZoom(on: controller, reason: "transaction")
      }
      sheet.animateChanges { sheet.selectedDetentIdentifier = .large }
      CATransaction.commit()
      logProbe("ANIMATE_RETURN transaction bounds=\(controller.view.bounds)")

    case .delayed:
      controller.preferredTransition = nil
      sheet.animateChanges { sheet.selectedDetentIdentifier = .large }
      logProbe("ANIMATE_RETURN delayed bounds=\(controller.view.bounds)")
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self, weak controller] in
        guard let self, let controller else { return }
        logProbe("DELAYED_REARM bounds=\(controller.view.bounds)")
        installZoom(on: controller, reason: "delayed")
      }
    }
  }

  private func installZoom(on controller: UIViewController, reason: String) {
    let options = UIViewController.Transition.ZoomOptions()
    controller.preferredTransition = .zoom(options: options) { [weak self] _ in
      guard let self else { return nil }
      providerCalls += 1
      logProbe(
        "PROVIDER call=\(providerCalls) reason=\(reason) window=\(source.window != nil) " +
          "hidden=\(source.isHidden) alpha=\(source.alpha)"
      )
      return source.window == nil ? nil : source
    }
    logProbe("ZOOM_INSTALLED reason=\(reason) bounds=\(controller.view.bounds)")
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    logProbe("DID_DISMISS mode=\(mode.rawValue)")
    activeSheetController = nil
  }
}

private final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = RootViewController()
    window.makeKeyAndVisible()
    self.window = window
  }
}

private final class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
    configuration.delegateClass = SceneDelegate.self
    return configuration
  }
}

_ = UIApplicationMain(
  CommandLine.argc,
  CommandLine.unsafeArgv,
  nil,
  NSStringFromClass(AppDelegate.self)
)
