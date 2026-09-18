const { getAppVariantConfig } = require("./scripts/app-variant");

const variant = getAppVariantConfig();

module.exports = {
  expo: {
    owner: "mishanaer",
    name: variant.name,
    slug: "readany",
    version: "1.3.5",
    orientation: "portrait",
    icon: "./assets/app-icon.png",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      // Keep release archives compatible with the stable Xcode toolchain used by App Store Connect.
      // This opaque PNG is generated from the same Narra icon artwork as the Icon Composer package.
      icon: "./assets/app-icon.png",
      supportsTablet: false,
      bundleIdentifier: variant.bundleIdentifier,
      // Читает script/build_and_run.sh, чтобы сверить установленный dev-клиент.
      // EAS его игнорирует: appVersionSource "remote", счётчик живёт на сервере.
      buildNumber: "36",
      infoPlist: {
        UIViewControllerBasedStatusBarAppearance: true,
        UIBackgroundModes: ["audio"],
        NSCameraUsageDescription:
          "Камера нужна Narra для сканирования QR‑кодов синхронизации и настройки.",
        NSLocalNetworkUsageDescription:
          "Локальная сеть нужна Narra для синхронизации с другими устройствами и подключения к серверу разработки.",
        ITSAppUsesNonExemptEncryption: false,
        // «Скопировать в Narra» в шер-шите и «Открыть в Narra» для книг из других приложений.
        CFBundleDocumentTypes: [
          {
            CFBundleTypeName: "Книга",
            CFBundleTypeRole: "Viewer",
            LSHandlerRank: "Alternate",
            LSItemContentTypes: ["public.data"],
          },
        ],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        monochromeImage: "./assets/adaptive-icon-monochrome.png",
        backgroundColor: "#FFFFFF",
      },
      softwareKeyboardLayoutMode: "resize",
      package: variant.androidPackage,
      intentFilters: [
        {
          action: "VIEW",
          category: ["DEFAULT", "BROWSABLE"],
          data: [
            { scheme: "content", mimeType: "application/*" },
            { scheme: "content", mimeType: "text/plain" },
          ],
        },
      ],
      permissions: [
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
        "android.permission.MODIFY_AUDIO_SETTINGS",
      ],
    },
    plugins: [
      [
        "expo-splash-screen",
        {
          backgroundColor: "#FFFFFF",
          image: "./assets/narra-face.png",
          imageWidth: 58,
          resizeMode: "contain",
          dark: {
            backgroundColor: "#000000",
            image: "./assets/narra-face.png",
          },
        },
      ],
      [
        "expo-dev-client",
        {
          launchMode: "most-recent",
        },
      ],
      [
        "expo-audio",
        {
          microphonePermission: false,
          recordAudioAndroid: false,
          enableBackgroundPlayback: true,
        },
      ],
      "expo-video",
      [
        "expo-build-properties",
        {
          android: {
            enableShrinkResourcesInReleaseBuilds: true,
            enableMinifyInReleaseBuilds: true,
            networkInspector: false,
            usesCleartextTraffic: true,
          },
          ios: {
            deploymentTarget: "16.4",
            buildReactNativeFromSource: true,
            networkInspector: false,
          },
        },
      ],
      "./plugins/withAndroidReleaseOptimization",
      "expo-font",
      "expo-secure-store",
      "expo-sharing",
      "expo-sqlite",
      "expo-asset",
      "./plugins/withIosSceneLifecycle",
      "./plugins/withIosPodsDeploymentTarget",
      "./plugins/withReactNativeScreensGamma",
      "./plugins/withVolumeKeyPaging",
      [
        "expo-camera",
        {
          cameraPermission:
            "Разрешите Narra доступ к камере, чтобы сканировать QR‑коды синхронизации.",
        },
      ],
    ],
    scheme: variant.scheme,
    extra: {
      appVariant: variant.key,
      eas: {
        projectId: "db152809-736c-4207-b073-38de82e61495",
      },
    },
  },
};
