import ExpoModulesCore
import SwiftUI
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

    View(ReadAnyReaderToolbar.self) {
      Events("onSpeechPress", "onChatPress", "onScenePress", "onSettingsPress")

      Prop("tintColor") { (view, value: UIColor) in view.toolbarTintColor = value }
      Prop("isDark") { (view, value: Bool) in view.isDark = value }
      Prop("speechActive") { (view, value: Bool) in view.speechActive = value }
      Prop("speechLabel") { (view, value: String) in view.speechLabel = value }
      Prop("chatLabel") { (view, value: String) in view.chatLabel = value }
      Prop("sceneLabel") { (view, value: String) in view.sceneLabel = value }
      Prop("settingsLabel") { (view, value: String) in view.settingsLabel = value }

      OnViewDidUpdateProps { view in
        view.applyProps()
      }
    }

    View(ReadAnyTTSPlayerToolbar.self) {
      Events("onBackwardPress", "onPlayPausePress", "onForwardPress")

      Prop("tintColor") { (view, value: UIColor) in view.toolbarTintColor = value }
      Prop("primaryColor") { (view, value: UIColor) in view.primaryColor = value }
      Prop("primaryForegroundColor") { (view, value: UIColor) in
        view.primaryForegroundColor = value
      }
      Prop("isDark") { (view, value: Bool) in view.isDark = value }
      Prop("isPlaying") { (view, value: Bool) in view.isPlaying = value }
      Prop("isLoading") { (view, value: Bool) in view.isLoading = value }
      Prop("seekEnabled") { (view, value: Bool) in view.seekEnabled = value }

      OnViewDidUpdateProps { view in
        view.updateConfiguration()
      }
    }

    View(ReadAnySheetNavigationBar.self) {
      Events("onClosePress")
      Prop("title") { (view, value: String) in view.title = value }
      Prop("closeAccessibilityLabel") { (view, value: String) in
        view.closeAccessibilityLabel = value
      }
      Prop("isDark") { (view, value: Bool) in view.isDark = value }

      OnViewDidUpdateProps { view in
        view.updateConfiguration()
      }
    }

    View(ReadAnyNavigationStack.self)

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

final class ReadAnyReaderToolbar: ExpoView {
  let onSpeechPress = EventDispatcher()
  let onChatPress = EventDispatcher()
  let onScenePress = EventDispatcher()
  let onSettingsPress = EventDispatcher()

  var toolbarTintColor = UIColor.label
  var isDark = true
  var speechActive = false
  var speechLabel = "Слушать"
  var chatLabel = "Чат"
  var sceneLabel = "Сцена"
  var settingsLabel = "Оформление"

  private let toolbar = UIToolbar()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    toolbar.translatesAutoresizingMaskIntoConstraints = false
    toolbar.isTranslucent = true
    toolbar.alpha = 0
    addSubview(toolbar)

    NSLayoutConstraint.activate([
      toolbar.topAnchor.constraint(equalTo: topAnchor),
      toolbar.bottomAnchor.constraint(equalTo: bottomAnchor),
      toolbar.leadingAnchor.constraint(equalTo: leadingAnchor),
      toolbar.trailingAnchor.constraint(equalTo: trailingAnchor)
    ])

  }

  @objc private func handleSpeechPress() {
    onSpeechPress()
  }

  @objc private func handleChatPress() {
    onChatPress()
  }

  @objc private func handleScenePress() {
    onScenePress()
  }

  @objc private func handleSettingsPress() {
    onSettingsPress()
  }

  func applyProps() {
    UIView.performWithoutAnimation {
      updateConfiguration()
      layoutIfNeeded()
      toolbar.alpha = 1
    }
  }

  func updateConfiguration() {
    toolbar.tintColor = toolbarTintColor
    toolbar.barStyle = isDark ? .black : .default

    if #available(iOS 15.0, *) {
      let appearance = UIToolbarAppearance()
      appearance.configureWithDefaultBackground()
      toolbar.standardAppearance = appearance
      toolbar.scrollEdgeAppearance = appearance
      toolbar.compactAppearance = appearance
    }

    let speech = makeItem(
      symbol: "speaker.wave.2",
      accessibilityLabel: speechActive ? "Остановить озвучку" : speechLabel,
      action: #selector(handleSpeechPress)
    )
    let chat = makeItem(
      symbol: "message",
      accessibilityLabel: chatLabel,
      action: #selector(handleChatPress)
    )
    let scene = makeItem(
      symbol: "wand.and.rays",
      accessibilityLabel: sceneLabel,
      action: #selector(handleScenePress)
    )
    // Явный вход в оформление читалки (Aa): шрифты, тема, прокрутка
    let settings = makeItem(
      symbol: "textformat.size",
      accessibilityLabel: settingsLabel,
      action: #selector(handleSettingsPress)
    )
    let spacer = { UIBarButtonItem(systemItem: .flexibleSpace) }

    if #available(iOS 26.0, *) {
      [speech, chat, scene, settings].forEach { $0.sharesBackground = true }
    }

    toolbar.setItems(
      [spacer(), speech, chat, scene, settings, spacer()],
      animated: false
    )
  }

  private func makeItem(
    symbol: String,
    accessibilityLabel: String,
    action: Selector
  ) -> UIBarButtonItem {
    let item = UIBarButtonItem(
      image: UIImage(systemName: symbol),
      style: .plain,
      target: self,
      action: action
    )
    item.accessibilityLabel = accessibilityLabel
    item.accessibilityHint = "Выполняет действие в текущей книге"
    return item
  }
}

final class ReadAnyTTSPlayerToolbar: ExpoView {
  let onBackwardPress = EventDispatcher()
  let onPlayPausePress = EventDispatcher()
  let onForwardPress = EventDispatcher()

  var toolbarTintColor = UIColor.label
  var primaryColor = UIColor.systemOrange
  var primaryForegroundColor = UIColor.white
  var isDark = true
  var isPlaying = false
  var isLoading = false
  var seekEnabled = false

  private let toolbar = UIToolbar()
  private let playButton = UIButton(type: .system)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    toolbar.translatesAutoresizingMaskIntoConstraints = false
    toolbar.isTranslucent = true
    playButton.translatesAutoresizingMaskIntoConstraints = false
    playButton.addTarget(self, action: #selector(handlePlayPausePress), for: .touchUpInside)
    addSubview(toolbar)

    NSLayoutConstraint.activate([
      toolbar.topAnchor.constraint(equalTo: topAnchor),
      toolbar.bottomAnchor.constraint(equalTo: bottomAnchor),
      toolbar.leadingAnchor.constraint(equalTo: leadingAnchor),
      toolbar.trailingAnchor.constraint(equalTo: trailingAnchor),
      playButton.widthAnchor.constraint(equalToConstant: 44),
      playButton.heightAnchor.constraint(equalToConstant: 44)
    ])

    updateConfiguration()
  }

  @objc private func handleBackwardPress() {
    onBackwardPress()
  }

  @objc private func handlePlayPausePress() {
    onPlayPausePress()
  }

  @objc private func handleForwardPress() {
    onForwardPress()
  }

  func updateConfiguration() {
    toolbar.tintColor = toolbarTintColor
    toolbar.barStyle = isDark ? .black : .default
    toolbar.overrideUserInterfaceStyle = isDark ? .dark : .light

    if #available(iOS 15.0, *) {
      let appearance = UIToolbarAppearance()
      appearance.configureWithDefaultBackground()
      toolbar.standardAppearance = appearance
      toolbar.scrollEdgeAppearance = appearance
      toolbar.compactAppearance = appearance
    }

    let backward = UIBarButtonItem(
      image: UIImage(systemName: "gobackward.15"),
      style: .plain,
      target: self,
      action: #selector(handleBackwardPress)
    )
    backward.accessibilityLabel = "Назад на 15 секунд"
    backward.isEnabled = seekEnabled

    let forward = UIBarButtonItem(
      image: UIImage(systemName: "goforward.15"),
      style: .plain,
      target: self,
      action: #selector(handleForwardPress)
    )
    forward.accessibilityLabel = "Вперёд на 15 секунд"
    forward.isEnabled = seekEnabled

    var configuration: UIButton.Configuration
    if #available(iOS 26.0, *) {
      configuration = .prominentGlass()
    } else {
      configuration = .filled()
    }
    configuration.cornerStyle = .capsule
    configuration.baseBackgroundColor = primaryColor
    configuration.baseForegroundColor = primaryForegroundColor
    // The React layer overlays the shared book-page loader so every loading
    // state uses the same cross-platform animation.
    configuration.showsActivityIndicator = false
    configuration.image = isLoading
      ? nil
      : UIImage(systemName: isPlaying ? "pause.fill" : "play.fill")
    playButton.configuration = configuration
    playButton.accessibilityLabel = isLoading
      ? "Остановить загрузку"
      : (isPlaying ? "Пауза" : "Воспроизвести")

    let play = UIBarButtonItem(customView: playButton)
    let spacer = { UIBarButtonItem(systemItem: .flexibleSpace) }

    if #available(iOS 26.0, *) {
      backward.sharesBackground = true
      forward.sharesBackground = true
    }

    toolbar.setItems(
      [spacer(), backward, spacer(), play, spacer(), forward, spacer()],
      animated: false
    )
  }
}

public final class ReadAnyNavigationStackProps: ExpoSwiftUI.ViewProps {
  @Field var title = ""
  @Field var closeAccessibilityLabel = "Закрыть"
  var onClosePress = EventDispatcher()
}

public struct ReadAnyNavigationStack: ExpoSwiftUI.View {
  @ObservedObject public var props: ReadAnyNavigationStackProps

  public init(props: ReadAnyNavigationStackProps) {
    self.props = props
  }

  public var body: some SwiftUI.View {
    if #available(iOS 16.0, *) {
      NavigationStack {
        navigationContent
      }
    } else {
      NavigationView {
        navigationContent
      }
      .navigationViewStyle(.stack)
    }
  }

  private var navigationContent: some SwiftUI.View {
    Children()
      .navigationTitle(props.title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          SwiftUI.Button {
            props.onClosePress()
          } label: {
            Image(systemName: "xmark")
          }
          .accessibilityLabel(props.closeAccessibilityLabel)
        }
      }
  }
}

final class ReadAnySheetNavigationBar: ExpoView {
  let onClosePress = EventDispatcher()

  var title = ""
  var closeAccessibilityLabel = "Закрыть"
  var isDark = true

  private let navigationBar = UINavigationBar()
  private let navigationItem = UINavigationItem()
  private var closeItem: UIBarButtonItem!

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    navigationBar.translatesAutoresizingMaskIntoConstraints = false
    navigationBar.isTranslucent = true
    navigationBar.backgroundColor = .clear
    backgroundColor = .clear
    addSubview(navigationBar)

    NSLayoutConstraint.activate([
      navigationBar.topAnchor.constraint(equalTo: topAnchor),
      navigationBar.bottomAnchor.constraint(equalTo: bottomAnchor),
      navigationBar.leadingAnchor.constraint(equalTo: leadingAnchor),
      navigationBar.trailingAnchor.constraint(equalTo: trailingAnchor)
    ])

    navigationBar.prefersLargeTitles = false
    closeItem = UIBarButtonItem(
      barButtonSystemItem: .close,
      target: self,
      action: #selector(handleClosePress)
    )
    navigationItem.rightBarButtonItem = closeItem
    navigationBar.setItems([navigationItem], animated: false)
    updateConfiguration()
  }

  @objc private func handleClosePress() {
    onClosePress()
  }

  func updateConfiguration() {
    overrideUserInterfaceStyle = isDark ? .dark : .light
    navigationBar.overrideUserInterfaceStyle = isDark ? .dark : .light
    navigationItem.title = title
    closeItem.accessibilityLabel = closeAccessibilityLabel

    if #available(iOS 15.0, *) {
      let appearance = UINavigationBarAppearance()
      appearance.configureWithOpaqueBackground()
      appearance.backgroundColor = isDark ? .black : .systemBackground
      appearance.titleTextAttributes = [
        .foregroundColor: isDark ? UIColor.white : UIColor.label
      ]
      navigationBar.tintColor = isDark ? .white : .label
      navigationBar.standardAppearance = appearance
      navigationBar.scrollEdgeAppearance = appearance
      navigationBar.compactAppearance = appearance
      navigationBar.compactScrollEdgeAppearance = appearance
    }
  }
}
