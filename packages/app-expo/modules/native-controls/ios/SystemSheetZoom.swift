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
    pendingIdentifier = item(identifier: identifier) == nil ? nil : identifier
  }

  @objc private func handleWillPresentFormSheet(_ notification: Notification) {
    guard let identifier = pendingIdentifier else { return }
    pendingIdentifier = nil

    guard #available(iOS 26.0, *), let controller = notification.object as? UIViewController else {
      return
    }

    controller.preferredTransition = .zoom(
      options: nil,
      sourceBarButtonItemProvider: { _ in
        SystemSheetZoomSourceRepository.shared.item(identifier: identifier)
      }
    )
  }
}

final class SystemSheetZoomDestinationView: ExpoView {
  var sourceIdentifier = "" {
    didSet {
      guard oldValue != sourceIdentifier else { return }
      configureTransition()
    }
  }

  var expanded = false {
    didSet {
      guard oldValue != expanded else { return }
      updateDetent()
    }
  }

  private weak var configuredScreen: RNSScreen?
  private var configuredSourceIdentifier: String?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    accessibilityElementsHidden = true
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()

    guard superview != nil else {
      clearTransition()
      return
    }

    configureTransition()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()

    guard window != nil else {
      clearTransition()
      return
    }

    configureTransition()
    updateDetent()
  }

  private func configureTransition() {
    guard let screen = findScreen() else { return }

    guard #available(iOS 26.0, *), !sourceIdentifier.isEmpty else {
      clearTransition()
      return
    }

    guard configuredScreen !== screen || configuredSourceIdentifier != sourceIdentifier else {
      return
    }

    clearTransition()
    let identifier = sourceIdentifier
    screen.preferredTransition = .zoom(
      options: nil,
      sourceBarButtonItemProvider: { _ in
        SystemSheetZoomSourceRepository.shared.item(identifier: identifier)
      }
    )
    configuredScreen = screen
    configuredSourceIdentifier = identifier
  }

  private func clearTransition() {
    if #available(iOS 26.0, *) {
      configuredScreen?.preferredTransition = nil
    }
    configuredScreen = nil
    configuredSourceIdentifier = nil
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
