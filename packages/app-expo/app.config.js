const { getAppVariantConfig } = require("./scripts/app-variant");

const variant = getAppVariantConfig();

module.exports = {
  expo: {
    owner: "mishanaer",
    name: variant.name,
    slug: "readany",
    version: "1.3.5",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      icon: "./assets/Narra.icon",
      supportsTablet: true,
      bundleIdentifier: variant.bundleIdentifier,
      buildNumber: "6",
      infoPlist: {
        UIViewControllerBasedStatusBarAppearance: true,
        UIBackgroundModes: ["audio"],
        NSCameraUsageDescription:
          "Камера нужна Narra для сканирования QR‑кодов синхронизации и настройки.",
        NSLocalNetworkUsageDescription:
          "Локальная сеть нужна Narra для синхронизации с другими устройствами и подключения к серверу разработки.",
        ITSAppUsesNonExemptEncryption: false,
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
          image: "./assets/splash-logo.png",
          imageWidth: 144,
          resizeMode: "contain",
          dark: {
            backgroundColor: "#000000",
            image: "./assets/splash-logo-dark.png",
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
      [
        "expo-build-properties",
        {
          android: {
            enableProguardInReleaseBuilds: true,
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
      "expo-font",
      [
        "expo-image-picker",
        {
          photosPermission: "Доступ к медиатеке нужен Narra, чтобы выбирать обложки книг.",
        },
      ],
      "expo-secure-store",
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
