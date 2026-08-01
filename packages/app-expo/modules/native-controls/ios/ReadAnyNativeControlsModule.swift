import ExpoModulesCore
import UIKit

public final class ReadAnyNativeControlsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReadAnyNativeControls")

    AsyncFunction("promptForText") { (
      title: String,
      message: String,
      placeholder: String,
      cancelLabel: String,
      confirmLabel: String,
      promise: Promise
    ) in
      guard let currentViewController = appContext?.utilities?.currentViewController() else {
        promise.reject(NativePromptUnavailableException())
        return
      }

      let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
      alert.addTextField { textField in
        textField.placeholder = placeholder
        textField.keyboardType = .URL
        textField.autocapitalizationType = .none
        textField.autocorrectionType = .no
        textField.clearButtonMode = .whileEditing
      }
      alert.addAction(UIAlertAction(title: cancelLabel, style: .cancel) { _ in
        promise.resolve(nil)
      })
      alert.addAction(UIAlertAction(title: confirmLabel, style: .default) { _ in
        promise.resolve(alert.textFields?.first?.text)
      })

      currentViewController.present(alert, animated: true)
    }.runOnQueue(.main)

    View(ReadAnyImportMenuButton.self) {
      Events("onButtonPress", "onUrlPress", "onLocalPress")

      Prop("label") { (view, value: String) in view.label = value }
      Prop("urlLabel") { (view, value: String) in view.urlLabel = value }
      Prop("localLabel") { (view, value: String) in view.localLabel = value }
      Prop("color") { (view, value: UIColor) in view.baseColor = value }
      Prop("foregroundColor") { (view, value: UIColor) in view.foregroundColor = value }
      Prop("disabled") { (view, value: Bool) in view.isControlDisabled = value }
      Prop("showsMenu") { (view, value: Bool) in view.showsMenu = value }

      OnViewDidUpdateProps { view in
        view.updateConfiguration()
      }
    }

  }
}

private final class NativePromptUnavailableException: Exception {
  override var reason: String {
    "Не удалось открыть системный диалог"
  }
}

final class ReadAnyImportMenuButton: ExpoView {
  let onButtonPress = EventDispatcher()
  let onUrlPress = EventDispatcher()
  let onLocalPress = EventDispatcher()

  var label = "Добавить книгу"
  var urlLabel = "Найти по ссылке"
  var localLabel = "Выбрать файл"
  var baseColor = UIColor.systemBlue
  var foregroundColor = UIColor.white
  var isControlDisabled = false
  var showsMenu = true

  private let button = UIButton(type: .system)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    button.translatesAutoresizingMaskIntoConstraints = false
    button.addTarget(self, action: #selector(handlePress), for: .touchUpInside)
    button.changesSelectionAsPrimaryAction = false
    button.titleLabel?.numberOfLines = 1
    button.titleLabel?.lineBreakMode = .byTruncatingTail
    button.titleLabel?.adjustsFontSizeToFitWidth = true
    button.titleLabel?.minimumScaleFactor = 0.8
    if #available(iOS 16.0, *) {
      button.preferredMenuElementOrder = .fixed
    }
    addSubview(button)

    NSLayoutConstraint.activate([
      button.topAnchor.constraint(equalTo: topAnchor),
      button.bottomAnchor.constraint(equalTo: bottomAnchor),
      button.leadingAnchor.constraint(equalTo: leadingAnchor),
      button.trailingAnchor.constraint(equalTo: trailingAnchor)
    ])

    updateConfiguration()
  }

  @objc private func handlePress() {
    guard !showsMenu else { return }
    onButtonPress()
  }

  func updateConfiguration() {
    var configuration: UIButton.Configuration
    if #available(iOS 26.0, *) {
      // The system glass configuration lets UIKit own the complete transition:
      // the control lifts and morphs into its attached UIMenu on touch down.
      configuration = .prominentGlass()
    } else {
      // Earlier supported iOS versions still get the native attached menu.
      configuration = .filled()
    }
    configuration.title = label
    configuration.image = UIImage(systemName: "plus")
    configuration.imagePadding = 7
    configuration.cornerStyle = .capsule
    configuration.titleLineBreakMode = .byTruncatingTail
    configuration.baseBackgroundColor = baseColor
    configuration.baseForegroundColor = foregroundColor
    configuration.contentInsets.trailing += 8
    configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var attributes = attributes
      attributes.font = UIFont(name: "SB Sans Interface", size: 18) ?? UIFont.systemFont(ofSize: 18)
      return attributes
    }

    button.configuration = configuration
    button.showsMenuAsPrimaryAction = showsMenu
    button.accessibilityLabel = label
    button.accessibilityHint = showsMenu ? "Открывает меню добавления книги" : nil
    button.isEnabled = !isControlDisabled
    button.menu = showsMenu
      ? UIMenu(children: [
          UIAction(
            title: urlLabel,
            image: UIImage(systemName: "link"),
            handler: { [weak self] _ in self?.onUrlPress() }
          ),
          UIAction(
            title: localLabel,
            image: UIImage(systemName: "folder"),
            handler: { [weak self] _ in self?.onLocalPress() }
          )
        ])
      : nil
  }
}
