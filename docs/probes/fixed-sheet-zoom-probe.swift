import QuartzCore
import UIKit

private enum ProbeMode: String {
  case medium
  case large

  static var current: ProbeMode {
    ProcessInfo.processInfo.arguments.contains("--large") ? .large : .medium
  }
}

private func probeTimestamp() -> String {
  String(format: "%.4f", CACurrentMediaTime())
}

private func probeLog(_ message: String) {
  NSLog("MORPH_PROBE %@ %@", probeTimestamp(), message)
}

private final class SourceDisplayLinkSampler: NSObject {
  private weak var sampledView: UIView?
  private var displayLink: CADisplayLink?
  private var lastSignature: String?
  private var framesRemaining = 0
  private var reason = ""

  func start(view: UIView, reason: String) {
    stop()
    sampledView = view
    self.reason = reason
    framesRemaining = 360
    lastSignature = nil

    let link = CADisplayLink(target: self, selector: #selector(sampleFrame))
    link.add(to: .main, forMode: .common)
    displayLink = link
    sampleFrame()
  }

  func stop() {
    displayLink?.invalidate()
    displayLink = nil
    sampledView = nil
    lastSignature = nil
    framesRemaining = 0
  }

  @objc private func sampleFrame() {
    guard let view = sampledView else {
      stop()
      return
    }

    var ancestor: UIView? = view
    var hasHiddenAncestor = false
    var effectiveAlpha: CGFloat = 1
    while let current = ancestor {
      hasHiddenAncestor = hasHiddenAncestor || current.isHidden
      effectiveAlpha *= current.alpha
      ancestor = current.superview
    }

    let modelFrame = view.window.map { view.convert(view.bounds, to: $0) } ?? .null
    let presentationFrame = view.layer.presentation()?.frame ?? .null
    let signature = [
      "reason=\(reason)",
      "window=\(view.window != nil)",
      "hidden=\(view.isHidden)",
      "hiddenAncestor=\(hasHiddenAncestor)",
      String(format: "alpha=%.3f", view.alpha),
      String(format: "effectiveAlpha=%.3f", effectiveAlpha),
      String(format: "layerOpacity=%.3f", view.layer.opacity),
      "modelFrame=\(modelFrame)",
      "presentationFrame=\(presentationFrame)",
      "transform=\(view.transform)",
    ].joined(separator: " ")

    if signature != lastSignature {
      probeLog("SOURCE_SAMPLE \(signature)")
      lastSignature = signature
    }

    framesRemaining -= 1
    if framesRemaining <= 0 {
      probeLog("SOURCE_SAMPLE_DONE reason=\(reason)")
      stop()
    }
  }
}

private final class ProbeSheetViewController: UIViewController {
  let mode: ProbeMode

  init(mode: ProbeMode) {
    self.mode = mode
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    let titleLabel = UILabel()
    titleLabel.translatesAutoresizingMaskIntoConstraints = false
    titleLabel.font = .preferredFont(forTextStyle: .title2)
    titleLabel.textAlignment = .center
    titleLabel.numberOfLines = 0
    titleLabel.text = "Fixed \(mode.rawValue) sheet\nSwipe down to dismiss"

    let content = UIView()
    content.translatesAutoresizingMaskIntoConstraints = false
    content.backgroundColor = .systemTeal.withAlphaComponent(0.18)
    content.layer.cornerRadius = 24

    view.addSubview(titleLabel)
    view.addSubview(content)
    NSLayoutConstraint.activate([
      titleLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
      titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      titleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
      content.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 28),
      content.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      content.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
      content.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
    ])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    probeLog("SHEET_DID_APPEAR mode=\(mode.rawValue) bounds=\(view.bounds)")
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    probeLog("SHEET_DID_DISAPPEAR mode=\(mode.rawValue)")
  }
}

private final class ProbeRootViewController: UIViewController, UIAdaptivePresentationControllerDelegate {
  private let mode = ProbeMode.current
  private let sampler = SourceDisplayLinkSampler()
  private let sourceContainer = UIView()
  private var providerCallCount = 0
  private var presentationCount = 0
  private var isPresentingSheet = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    let heading = UILabel()
    heading.translatesAutoresizingMaskIntoConstraints = false
    heading.font = .preferredFont(forTextStyle: .title1)
    heading.text = "Zoom + fixed \(mode.rawValue) sheet"

    let body = UILabel()
    body.translatesAutoresizingMaskIntoConstraints = false
    body.font = .preferredFont(forTextStyle: .body)
    body.textColor = .secondaryLabel
    body.numberOfLines = 0
    body.text = "The source stays mounted. Tap Chat, then dismiss the sheet with slow and fast swipes."

    let listenButton = UIButton(type: .system)
    listenButton.translatesAutoresizingMaskIntoConstraints = false
    listenButton.configuration = .filled()
    listenButton.configuration?.title = "Listen"

    sourceContainer.translatesAutoresizingMaskIntoConstraints = false
    sourceContainer.accessibilityIdentifier = "morph-source-container"

    let chatButton = UIButton(type: .system)
    chatButton.translatesAutoresizingMaskIntoConstraints = false
    chatButton.configuration = .filled()
    chatButton.configuration?.title = "Chat"
    chatButton.accessibilityIdentifier = "morph-source-button"
    chatButton.addTarget(self, action: #selector(presentProbeSheet), for: .touchUpInside)
    sourceContainer.addSubview(chatButton)

    let toolbar = UIStackView(arrangedSubviews: [listenButton, UIView(), sourceContainer])
    toolbar.translatesAutoresizingMaskIntoConstraints = false
    toolbar.axis = .horizontal
    toolbar.alignment = .center
    toolbar.spacing = 12

    view.addSubview(heading)
    view.addSubview(body)
    view.addSubview(toolbar)
    NSLayoutConstraint.activate([
      heading.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 40),
      heading.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      heading.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
      body.topAnchor.constraint(equalTo: heading.bottomAnchor, constant: 16),
      body.leadingAnchor.constraint(equalTo: heading.leadingAnchor),
      body.trailingAnchor.constraint(equalTo: heading.trailingAnchor),
      toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
      toolbar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
      toolbar.heightAnchor.constraint(equalToConstant: 48),
      sourceContainer.heightAnchor.constraint(equalToConstant: 44),
      chatButton.topAnchor.constraint(equalTo: sourceContainer.topAnchor),
      chatButton.leadingAnchor.constraint(equalTo: sourceContainer.leadingAnchor),
      chatButton.trailingAnchor.constraint(equalTo: sourceContainer.trailingAnchor),
      chatButton.bottomAnchor.constraint(equalTo: sourceContainer.bottomAnchor),
    ])

    probeLog("ROOT_LOADED mode=\(mode.rawValue)")
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    probeLog("ROOT_DID_APPEAR mode=\(mode.rawValue) sourceWindow=\(sourceContainer.window != nil)")
  }

  @objc private func presentProbeSheet() {
    guard !isPresentingSheet, presentedViewController == nil else { return }
    isPresentingSheet = true
    presentationCount += 1

    let sheetViewController = ProbeSheetViewController(mode: mode)
    sheetViewController.modalPresentationStyle = .formSheet

    guard let sheet = sheetViewController.sheetPresentationController else {
      probeLog("ERROR no UISheetPresentationController")
      isPresentingSheet = false
      return
    }

    switch mode {
    case .medium:
      let identifier = UISheetPresentationController.Detent.Identifier("fixed-medium")
      sheet.detents = [
        .custom(identifier: identifier) { context in
          context.maximumDetentValue * 0.55
        },
      ]
      sheet.selectedDetentIdentifier = identifier
    case .large:
      sheet.detents = [.large()]
      sheet.selectedDetentIdentifier = .large
    }
    sheet.prefersGrabberVisible = true
    sheetViewController.presentationController?.delegate = self

    let options = UIViewController.Transition.ZoomOptions()
    sheetViewController.preferredTransition = .zoom(options: options) { [weak self] _ in
      guard let self else { return nil }
      providerCallCount += 1
      let reason = "provider-\(providerCallCount)-presentation-\(presentationCount)"
      logSource(reason: reason)
      sampler.start(view: sourceContainer, reason: reason)
      return sourceContainer.window == nil ? nil : sourceContainer
    }

    probeLog(
      "PRESENT_REQUEST mode=\(mode.rawValue) count=\(presentationCount) " +
        "selected=\(String(describing: sheet.selectedDetentIdentifier))"
    )
    present(sheetViewController, animated: true) { [weak self] in
      guard let self else { return }
      probeLog("PRESENT_COMPLETION mode=\(mode.rawValue) count=\(presentationCount)")
      isPresentingSheet = false
    }
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    probeLog("PRESENTATION_DID_DISMISS mode=\(mode.rawValue) count=\(presentationCount)")
    isPresentingSheet = false
    logSource(reason: "presentation-did-dismiss-\(presentationCount)")
  }

  private func logSource(reason: String) {
    let modelFrame = sourceContainer.window.map {
      sourceContainer.convert(sourceContainer.bounds, to: $0)
    } ?? .null
    let presentationFrame = sourceContainer.layer.presentation()?.frame ?? .null
    probeLog(
      "SOURCE reason=\(reason) window=\(sourceContainer.window != nil) " +
        "hidden=\(sourceContainer.isHidden) alpha=\(sourceContainer.alpha) " +
        "layerOpacity=\(sourceContainer.layer.opacity) modelFrame=\(modelFrame) " +
        "presentationFrame=\(presentationFrame)"
    )
  }
}

private final class ProbeSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = ProbeRootViewController()
    window.makeKeyAndVisible()
    self.window = window
    probeLog("SCENE_CONNECTED mode=\(ProbeMode.current.rawValue)")
  }
}

private final class ProbeAppDelegate: UIResponder, UIApplicationDelegate {

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    probeLog("APP_LAUNCHED mode=\(ProbeMode.current.rawValue)")
    return true
  }

  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(
      name: "Default Configuration",
      sessionRole: connectingSceneSession.role
    )
    configuration.delegateClass = ProbeSceneDelegate.self
    return configuration
  }
}

_ = UIApplicationMain(
  CommandLine.argc,
  CommandLine.unsafeArgv,
  nil,
  NSStringFromClass(ProbeAppDelegate.self)
)
