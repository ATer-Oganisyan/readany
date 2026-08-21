import ExpoModulesCore
import RNScreens
import UIKit

#if DEBUG
private func morphDebug(_ message: @autoclosure () -> String) {
  NSLog("[MorphSheet][%.6f] %@", CACurrentMediaTime(), message())
}
#else
private func morphDebug(_ message: @autoclosure () -> String) {}
#endif

private func morphViewState(_ view: UIView?) -> String {
  guard let view else { return "view=nil" }
  let frame = view.window.map { view.convert(view.bounds, to: $0) } ?? .null
  return "view=\(ObjectIdentifier(view)) window=\(view.window != nil) hidden=\(view.isHidden) alpha=\(view.alpha) frame=\(frame)"
}

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
    morphDebug("source register id=\(identifier) \(morphViewState(view))")
  }

  func unregister(identifier: String, matching view: UIView) {
    guard !identifier.isEmpty else { return }
    lock.lock()
    if sources[identifier]?.view === view {
      sources.removeValue(forKey: identifier)
    }
    lock.unlock()
    morphDebug("source unregister id=\(identifier) \(morphViewState(view))")
  }

  func source(identifier: String) -> UIView? {
    guard !identifier.isEmpty else { return nil }
    lock.lock()
    defer { lock.unlock() }

    guard let source = sources[identifier] else {
      morphDebug("provider id=\(identifier) missing")
      return nil
    }
    guard let view = source.view else {
      sources.removeValue(forKey: identifier)
      morphDebug("provider id=\(identifier) deallocated")
      return nil
    }
    let result = view.window == nil ? nil : view
    morphDebug("provider id=\(identifier) result=\(result == nil ? "nil" : "source") \(morphViewState(view))")
    return result
  }
}

private final class SheetResizeObserverViewController: UIViewController {
  var onResizeCompleted: ((UInt) -> Void)?

  private var pendingGeneration: UInt?
  private var observedGeneration: UInt?

  func prepareForResize(generation: UInt) {
    pendingGeneration = generation
    observedGeneration = nil
    morphDebug("resize observer prepare generation=\(generation)")
  }

  func observedResize(generation: UInt) -> Bool {
    observedGeneration == generation
  }

  func finishResize(generation: UInt) {
    guard pendingGeneration == generation else { return }
    pendingGeneration = nil
    observedGeneration = nil
  }

  func cancelPendingResize() {
    pendingGeneration = nil
    observedGeneration = nil
  }

  override func viewWillTransition(
    to size: CGSize,
    with coordinator: any UIViewControllerTransitionCoordinator
  ) {
    super.viewWillTransition(to: size, with: coordinator)

    morphDebug("resize observer callback size=\(size) pending=\(String(describing: pendingGeneration))")

    guard
      let generation = pendingGeneration,
      observedGeneration != generation
    else {
      return
    }

    let registered = coordinator.animate(alongsideTransition: nil) { [weak self] _ in
      self?.onResizeCompleted?(generation)
    }
    if registered {
      observedGeneration = generation
    }
    morphDebug("resize observer coordinator generation=\(generation) registered=\(registered)")
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
  private var configuredSourceIdentifier: String?
  private weak var resizeObserverScreen: RNSScreen?
  private var resizeObserver: SheetResizeObserverViewController?
  private var resizeGeneration: UInt = 0
  private var pendingResizeGeneration: UInt?
  private var requestedExpanded: Bool?
  private var pendingSheetUpdatePromise: Promise?
  private var sheetUpdateWorkItem: DispatchWorkItem?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    accessibilityElementsHidden = true
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    if superview == nil {
      sheetUpdateWorkItem?.cancel()
      sheetUpdateWorkItem = nil
      requestedExpanded = nil
      rejectPendingSheetUpdate(
        code: "ERR_MORPH_SHEET_UNMOUNTED",
        description: "The sheet was removed before its detent transition completed"
      )
      invalidatePendingResize()
      clearConfiguredTransition()
      removeResizeObserver()
    } else {
      scheduleTransitionSetup()
    }
  }

  func scheduleTransitionSetup() {
    DispatchQueue.main.async { [weak self] in
      self?.setupTransition()
    }
  }

  func expandSheet(promise: Promise) {
    updateSheet(expanded: true, promise: promise)
  }

  func collapseSheet(promise: Promise) {
    updateSheet(expanded: false, promise: promise)
  }

  private func updateSheet(expanded: Bool, promise: Promise) {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in
        self?.updateSheet(expanded: expanded, promise: promise)
      }
      return
    }

    morphDebug("detent request expanded=\(expanded)")
    rejectPendingSheetUpdate(
      code: "ERR_MORPH_SHEET_UPDATE_SUPERSEDED",
      description: "A newer sheet detent transition replaced the pending transition"
    )
    pendingSheetUpdatePromise = promise
    requestedExpanded = expanded
    sheetUpdateWorkItem?.cancel()
    sheetUpdateWorkItem = nil
    applyRequestedSheetState(remainingAttempts: 8)
  }

  private func applyRequestedSheetState(remainingAttempts: Int) {
    guard let expanded = requestedExpanded else { return }
    guard
      let sheet = findSheetPresentationController(),
      let detent = expanded ? sheet.detents.last : sheet.detents.first
    else {
      guard remainingAttempts > 0 else {
        requestedExpanded = nil
        rejectPendingSheetUpdate(
          code: "ERR_MORPH_SHEET_UNAVAILABLE",
          description: "The native sheet presentation controller was not available"
        )
        return
      }
      let workItem = DispatchWorkItem { [weak self] in
        self?.applyRequestedSheetState(remainingAttempts: remainingAttempts - 1)
      }
      sheetUpdateWorkItem = workItem
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.025, execute: workItem)
      return
    }

    sheetUpdateWorkItem = nil
    requestedExpanded = nil
    morphDebug("detent apply expanded=\(expanded) current=\(String(describing: sheet.selectedDetentIdentifier)) target=\(String(describing: detent.identifier))")
    guard sheet.selectedDetentIdentifier != detent.identifier else {
      setupTransition()
      resolvePendingSheetUpdate()
      return
    }

    guard let screen = findScreen() else {
      rejectPendingSheetUpdate(
        code: "ERR_MORPH_SHEET_SCREEN_UNAVAILABLE",
        description: "The native screen containing the sheet was not available"
      )
      return
    }
    let generation = suspendTransitionForResize(on: screen)

    // React Native Screens owns the presentation style, detents, grabber and
    // system corner geometry. This view only selects a detent, so UIKit gets a
    // single owner and performs one layout pass instead of two competing ones.
    sheet.animateChanges {
      sheet.selectedDetentIdentifier = detent.identifier
    }

    morphDebug("detent animateChanges returned generation=\(generation) observed=\(resizeObserver?.observedResize(generation: generation) == true) selected=\(String(describing: sheet.selectedDetentIdentifier))")

    // UIKit sends viewWillTransition synchronously when this call starts an
    // actual size transition. If the requested detent did not change the
    // presented size, there is no coordinator to wait for and Zoom is safe to
    // restore immediately.
    if resizeObserver?.observedResize(generation: generation) != true {
      finishResize(generation: generation)
    }
  }

  private func setupTransition() {
    guard let screen = findScreen() else {
      morphDebug("zoom setup skipped: screen unavailable")
      return
    }

    ensureResizeObserver(on: screen)

    guard pendingResizeGeneration == nil else {
      morphDebug("zoom setup deferred pendingResize=\(String(describing: pendingResizeGeneration))")
      return
    }

    guard !sourceIdentifier.isEmpty, !UIAccessibility.isReduceMotionEnabled else {
      clearConfiguredTransition()
      return
    }

    if #available(iOS 18.0, *) {
      guard configuredScreen !== screen || configuredSourceIdentifier != sourceIdentifier else {
        return
      }

      clearConfiguredTransition()
      let identifier = sourceIdentifier
      let options = UIViewController.Transition.ZoomOptions()
      screen.preferredTransition = .zoom(options: options) { _ in
        morphDebug("zoom provider invoked id=\(identifier)")
        return MorphTransitionSourceRepository.shared.source(identifier: identifier)
      }
      configuredScreen = screen
      configuredSourceIdentifier = identifier
      morphDebug("zoom configured screen=\(ObjectIdentifier(screen)) id=\(identifier)")
    }
  }

  private func clearConfiguredTransition() {
    if #available(iOS 18.0, *) {
      configuredScreen?.preferredTransition = nil
    }
    configuredScreen = nil
    configuredSourceIdentifier = nil
    morphDebug("zoom cleared")
  }

  private func suspendTransitionForResize(on screen: RNSScreen) -> UInt {
    ensureResizeObserver(on: screen)

    resizeGeneration &+= 1
    let generation = resizeGeneration
    pendingResizeGeneration = generation
    resizeObserver?.prepareForResize(generation: generation)

    // preferredTransition is stateful inside UIKit. Keeping the Zoom object
    // alive while a sheet changes detents leaves it bound to stale geometry,
    // so a later dismissal can splice a sheet slide and a zoom together.
    clearConfiguredTransition()
    morphDebug("resize suspended generation=\(generation)")
    return generation
  }

  private func finishResize(generation: UInt) {
    guard pendingResizeGeneration == generation else { return }

    morphDebug("resize finish generation=\(generation)")
    pendingResizeGeneration = nil
    resizeObserver?.finishResize(generation: generation)
    setupTransition()
    resolvePendingSheetUpdate()
  }

  private func resolvePendingSheetUpdate() {
    guard let promise = pendingSheetUpdatePromise else { return }
    pendingSheetUpdatePromise = nil
    promise.resolve()
  }

  private func rejectPendingSheetUpdate(code: String, description: String) {
    guard let promise = pendingSheetUpdatePromise else { return }
    pendingSheetUpdatePromise = nil
    promise.reject(code, description)
  }

  private func invalidatePendingResize() {
    resizeGeneration &+= 1
    pendingResizeGeneration = nil
    resizeObserver?.cancelPendingResize()
  }

  private func ensureResizeObserver(on screen: RNSScreen) {
    guard resizeObserverScreen !== screen || resizeObserver == nil else { return }

    removeResizeObserver()

    let observer = SheetResizeObserverViewController()
    observer.onResizeCompleted = { [weak self] generation in
      self?.finishResize(generation: generation)
    }

    screen.addChild(observer)
    observer.view.frame = screen.view.bounds
    observer.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    observer.view.isHidden = true
    observer.view.isUserInteractionEnabled = false
    screen.view.addSubview(observer.view)
    observer.didMove(toParent: screen)

    resizeObserver = observer
    resizeObserverScreen = screen
  }

  private func removeResizeObserver() {
    guard let observer = resizeObserver else {
      resizeObserverScreen = nil
      return
    }

    observer.cancelPendingResize()
    observer.onResizeCompleted = nil
    observer.willMove(toParent: nil)
    observer.view.removeFromSuperview()
    observer.removeFromParent()
    resizeObserver = nil
    resizeObserverScreen = nil
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

    return findSheetPresentationController(from: screen)
  }

  private func findSheetPresentationController(from screen: RNSScreen) -> UISheetPresentationController? {
    var controller: UIViewController? = screen
    while let current = controller {
      if let sheet = current.presentationController as? UISheetPresentationController {
        return sheet
      }
      controller = current.parent
    }

    return screen.sheetPresentationController ?? screen.navigationController?.sheetPresentationController
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

      AsyncFunction("expandSheet") { (view: MorphTransitionDestinationView, promise: Promise) in
        view.expandSheet(promise: promise)
      }

      AsyncFunction("collapseSheet") { (view: MorphTransitionDestinationView, promise: Promise) in
        view.collapseSheet(promise: promise)
      }
    }
  }
}
