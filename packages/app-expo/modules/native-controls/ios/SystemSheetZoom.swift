import ExpoModulesCore
import RNScreens
import UIKit

private final class WeakBarButtonItem {
  weak var item: UIBarButtonItem?

  init(_ item: UIBarButtonItem) {
    self.item = item
  }
}

final class SystemSheetZoomSourceRepository: NSObject {
  static let shared = SystemSheetZoomSourceRepository()

  private var sources: [String: WeakBarButtonItem] = [:]
  private var pendingIdentifier: String?
  private let targets = NSMapTable<NSString, UIView>.strongToWeakObjects()
  private let views = NSMapTable<NSString, UIView>.strongToWeakObjects()

  func registerTarget(identifier: String, view: UIView) {
    guard !identifier.isEmpty else { return }
    targets.setObject(view, forKey: identifier as NSString)
  }

  func unregisterTarget(identifier: String, matching view: UIView) {
    guard targets.object(forKey: identifier as NSString) === view else { return }
    targets.removeObject(forKey: identifier as NSString)
  }

  func register(identifier: String, view: UIView) {
    guard !identifier.isEmpty else { return }
    views.setObject(view, forKey: identifier as NSString)
  }

  func unregister(identifier: String, matching view: UIView) {
    guard views.object(forKey: identifier as NSString) === view else { return }
    views.removeObject(forKey: identifier as NSString)
  }

  @available(iOS 26.0, *)
  func transition(identifier: String) -> UIViewController.Transition {
    if pendingIdentifier == identifier {
      pendingIdentifier = nil
    }
    if views.object(forKey: identifier as NSString) != nil {
      let options = UIViewController.Transition.ZoomOptions()
      if identifier.hasPrefix("reader:") || identifier.hasPrefix("catalog:") {
        options.interactiveDismissShouldBegin = { _ in false }
        options.dimmingColor = .clear
      }
      options.alignmentRectProvider = { context in
        let destination = context.zoomedViewController.view!
        guard let target = self.targets.object(forKey: identifier as NSString),
          target.isDescendant(of: destination)
        else { return nil }
        destination.layoutIfNeeded()
        guard !target.bounds.isEmpty else { return nil }
        return target.convert(target.bounds, to: destination)
      }
      return .zoom(options: options, sourceViewProvider: { context in
        let source = self.views.object(forKey: identifier as NSString)
        if context.zoomedViewController.isBeingDismissed,
          let coordinator = context.zoomedViewController.transitionCoordinator
        {
          // UIKit animates the real cover back inside its pager. Let the return
          // spring cross the pager's bounds, then restore normal scroll clipping.
          var clippedAncestors: [UIView] = []
          if identifier.hasPrefix("reader:") || identifier.hasPrefix("catalog:") {
            var ancestor = source?.superview
            while let view = ancestor, !(view is UIWindow) {
              if view.clipsToBounds {
                clippedAncestors.append(view)
                view.clipsToBounds = false
              }
              ancestor = view.superview
            }
          }
          let restoreClipping = {
            clippedAncestors.forEach { $0.clipsToBounds = true }
          }
          let registered = coordinator.animate(alongsideTransition: nil) { transition in
            restoreClipping()
            if !transition.isCancelled {
              (source as? SystemSheetZoomSourceView)?.onZoomReturn()
            }
          }
          if !registered { restoreClipping() }
        }
        return source
      })
    }
    return .zoom(options: nil, sourceBarButtonItemProvider: { _ in
      self.item(identifier: identifier)
    })
  }

  private override init() {
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleWillPresentFormSheet),
      name: Notification.Name("ReadAnyRNSScreenWillPresentFormSheet"),
      object: nil
    )
  }

  func register(identifier: String, item: UIBarButtonItem) {
    guard !identifier.isEmpty else { return }
    sources[identifier] = WeakBarButtonItem(item)
  }

  func unregister(identifier: String, matching item: UIBarButtonItem) {
    guard !identifier.isEmpty, sources[identifier]?.item === item else { return }
    sources.removeValue(forKey: identifier)
    if pendingIdentifier == identifier {
      pendingIdentifier = nil
    }
  }

  func item(identifier: String) -> UIBarButtonItem? {
    guard !identifier.isEmpty else { return nil }
    guard let item = sources[identifier]?.item else {
      sources.removeValue(forKey: identifier)
      return nil
    }
    return item
  }

  func preparePresentation(identifier: String) {
    pendingIdentifier = identifier.isEmpty ? nil : identifier
  }

  @objc private func handleWillPresentFormSheet(_ notification: Notification) {
    let identifier = pendingIdentifier
    pendingIdentifier = nil

    guard let controller = notification.object as? UIViewController else { return }

    if controller.modalPresentationStyle == .pageSheet,
      let sheet = controller.sheetPresentationController
    {
      let preview = UISheetPresentationController.Detent.custom(identifier: .init("bookPreview")) {
        [weak sheet] context in
        let container = sheet?.containerView
        let height = container?.bounds.height ?? context.maximumDetentValue
        let bottomInset = container?.safeAreaInsets.bottom ?? 0
        // Medium uses half the container; preserve its safe-area allowance when adding 10%.
        return min(context.maximumDetentValue, (height * 0.5 + bottomInset) * 1.1 - bottomInset)
      }
      sheet.detents = [preview, .large()]
      sheet.selectedDetentIdentifier = preview.identifier
      sheet.prefersGrabberVisible = true
      sheet.prefersScrollingExpandsWhenScrolledToEdge = true
    }

    guard
      #available(iOS 26.0, *),
      let identifier,
      controller.preferredTransition == nil
    else {
      return
    }

    controller.preferredTransition = transition(identifier: identifier)
  }
}

final class SystemSheetZoomDestinationView: ExpoView {
  var sourceIdentifier = "" {
    didSet {
      guard oldValue != sourceIdentifier else { return }
      SystemSheetZoomSourceRepository.shared.unregisterTarget(identifier: oldValue, matching: self)
      registerAlignmentTarget()
      configureTransition()
    }
  }

  var alignToContent = false {
    didSet { registerAlignmentTarget() }
  }

  private func registerAlignmentTarget() {
    if alignToContent {
      SystemSheetZoomSourceRepository.shared.registerTarget(identifier: sourceIdentifier, view: self)
    } else {
      SystemSheetZoomSourceRepository.shared.unregisterTarget(identifier: sourceIdentifier, matching: self)
    }
  }

  var expanded = false {
    didSet {
      guard oldValue != expanded else { return }
      updateDetent()
    }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    accessibilityElementsHidden = true
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()

    guard superview != nil else { return }
    configureTransition()
    // The containing RNSScreen may not be assigned during the initial mount.
    DispatchQueue.main.async { [weak self] in
      self?.configureTransition()
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()

    guard window != nil else { return }
    configureTransition()
    updateDetent()
  }

  private func configureTransition() {
    guard
      #available(iOS 26.0, *),
      !sourceIdentifier.isEmpty,
      let screen = findScreen(),
      screen.preferredTransition == nil
    else {
      return
    }

    // UIKit owns the transition through interactive dismissal, including temporary
    // view detachment. Keep it on the controller until that controller is released.
    let identifier = sourceIdentifier
    screen.preferredTransition = SystemSheetZoomSourceRepository.shared.transition(identifier: identifier)
  }

  private func updateDetent() {
    guard
      window != nil,
      let sheet = findSheetPresentationController(),
      let detent = expanded ? sheet.detents.last : sheet.detents.first,
      sheet.selectedDetentIdentifier != detent.identifier
    else {
      return
    }

    sheet.animateChanges {
      sheet.selectedDetentIdentifier = detent.identifier
    }
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

  private func findSheetPresentationController() -> UISheetPresentationController? {
    guard let screen = findScreen() else { return nil }

    var controller: UIViewController? = screen
    while let current = controller {
      if let sheet = current.presentationController as? UISheetPresentationController {
        return sheet
      }
      controller = current.parent
    }

    return screen.sheetPresentationController
      ?? screen.navigationController?.sheetPresentationController
  }
}

final class SystemSheetZoomSourceView: ExpoView {
  let onZoomReturn = EventDispatcher()

  var sourceIdentifier = "" {
    didSet {
      SystemSheetZoomSourceRepository.shared.unregister(identifier: oldValue, matching: self)
      if superview != nil {
        SystemSheetZoomSourceRepository.shared.register(identifier: sourceIdentifier, view: self)
      }
    }
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    // A pushed screen temporarily leaves the window but remains mounted.
    if superview != nil {
      SystemSheetZoomSourceRepository.shared.register(identifier: sourceIdentifier, view: self)
    } else {
      SystemSheetZoomSourceRepository.shared.unregister(identifier: sourceIdentifier, matching: self)
    }
  }
}
