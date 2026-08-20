import ExpoModulesCore
import RNScreens
import UIKit

private final class WeakSourceView {
  weak var view: UIView?

  init(_ view: UIView) {
    self.view = view
  }
}

private final class MorphTransitionSourceRepository {
  static let shared = MorphTransitionSourceRepository()

  private var sources: [String: WeakSourceView] = [:]
  private let lock = NSLock()

  private init() {}

  func register(identifier: String, view: UIView) {
    guard !identifier.isEmpty else { return }
    lock.lock()
    sources[identifier] = WeakSourceView(view)
    lock.unlock()
  }

  func unregister(identifier: String, matching view: UIView) {
    guard !identifier.isEmpty else { return }
    lock.lock()
    if sources[identifier]?.view === view {
      sources.removeValue(forKey: identifier)
    }
    lock.unlock()
  }

  func source(identifier: String) -> UIView? {
    guard !identifier.isEmpty else { return nil }
    lock.lock()
    defer { lock.unlock() }

    guard let source = sources[identifier] else { return nil }
    guard let view = source.view else {
      sources.removeValue(forKey: identifier)
      return nil
    }
    return view
  }
}

final class MorphTransitionSourceView: ExpoView {
  var sourceIdentifier = "" {
    didSet {
      if let sourceView, !oldValue.isEmpty {
        MorphTransitionSourceRepository.shared.unregister(
          identifier: oldValue,
          matching: sourceView
        )
      }
      registerCurrentSource()
    }
  }

  private weak var sourceView: UIView?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
  }

  override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    guard sourceView == nil else {
      assertionFailure("MorphTransitionSourceView accepts exactly one native child")
      return
    }

    sourceView = childComponentView
    super.mountChildComponentView(childComponentView, index: index)
    registerCurrentSource()
  }

  override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    if sourceView === childComponentView {
      MorphTransitionSourceRepository.shared.unregister(
        identifier: sourceIdentifier,
        matching: childComponentView
      )
      sourceView = nil
    }
    super.unmountChildComponentView(childComponentView, index: index)
  }

  private func registerCurrentSource() {
    guard let sourceView else { return }
    MorphTransitionSourceRepository.shared.register(
      identifier: sourceIdentifier,
      view: sourceView
    )
  }
}

final class MorphTransitionDestinationView: ExpoView {
  var sourceIdentifier = "" {
    didSet {
      if oldValue != sourceIdentifier {
        scheduleTransitionSetup()
      }
    }
  }

  private weak var configuredScreen: RNSScreen?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    accessibilityElementsHidden = true
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    if superview == nil {
      clearConfiguredTransition()
    } else {
      scheduleTransitionSetup()
    }
  }

  func scheduleTransitionSetup() {
    DispatchQueue.main.async { [weak self] in
      self?.setupTransition()
    }
  }

  private func setupTransition() {
    clearConfiguredTransition()

    guard !sourceIdentifier.isEmpty else { return }
    guard !UIAccessibility.isReduceMotionEnabled else { return }
    guard let screen = findScreen() else { return }

    if #available(iOS 18.0, *) {
      let identifier = sourceIdentifier
      let options = UIViewController.Transition.ZoomOptions()
      screen.preferredTransition = .zoom(options: options) { _ in
        MorphTransitionSourceRepository.shared.source(identifier: identifier)
      }
      configuredScreen = screen
    }
  }

  private func clearConfiguredTransition() {
    if #available(iOS 18.0, *) {
      configuredScreen?.preferredTransition = nil
    }
    configuredScreen = nil
  }

  private func findScreen() -> RNSScreen? {
    var responder: UIResponder? = self
    while let current = responder {
      if let screen = current as? RNSScreen {
        return screen
      }
      responder = current.next
    }
    return nil
  }
}

public final class MorphSheetTransitionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MorphSheetTransition")

    View(MorphTransitionSourceView.self) {
      Prop("sourceId") { (view, sourceId: String) in
        view.sourceIdentifier = sourceId
      }
    }

    View(MorphTransitionDestinationView.self) {
      Prop("sourceId") { (view, sourceId: String) in
        view.sourceIdentifier = sourceId
      }

      OnViewDidUpdateProps { view in
        view.scheduleTransitionSetup()
      }
    }
  }
}
