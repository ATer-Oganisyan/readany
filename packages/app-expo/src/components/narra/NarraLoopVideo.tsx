/**
 * Зацикленное видео «ожившей» картинки (P18) поверх места статичного кадра.
 *
 * В проекте нет нативного видео-плеера (expo-video/expo-av/react-native-video
 * отсутствуют в package.json, аудио играет react-native-track-player), поэтому
 * ничего не ставим: локальный mp4 проигрывает уже подключённый
 * react-native-webview тегом <video> — autoplay, loop, muted, inline,
 * object-fit: cover как у Image resizeMode="cover".
 */

import { useMemo } from "react";
import { type StyleProp, StyleSheet, type ViewStyle } from "react-native";
import WebView from "react-native-webview";

interface NarraLoopVideoProps {
  /** file://-URI mp4-файла в narra-media. */
  uri: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

function videoHtml(fileName: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
    video { width: 100%; height: 100%; object-fit: cover; display: block; }
  </style>
</head>
<body>
  <video src="${fileName}" autoplay loop muted playsinline></video>
  <script>document.querySelector("video").play().catch(function () {});</script>
</body>
</html>`;
}

export function NarraLoopVideo({ uri, style, accessibilityLabel }: NarraLoopVideoProps) {
  // baseUrl — каталог файла: WKWebView получает доступ на чтение к каталогу
  // (allowingReadAccessToURL), а <video> ссылается на файл по имени.
  const source = useMemo(() => {
    const separator = uri.lastIndexOf("/");
    const directory = uri.slice(0, separator + 1);
    const fileName = uri.slice(separator + 1);
    return { html: videoHtml(fileName), baseUrl: directory, directory };
  }, [uri]);

  return (
    <WebView
      accessibilityLabel={accessibilityLabel}
      source={{ html: source.html, baseUrl: source.baseUrl }}
      style={[styles.video, style]}
      originWhitelist={["*"]}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowingReadAccessToURL={source.directory}
      allowFileAccess
      allowFileAccessFromFileURLs
      javaScriptEnabled
      scrollEnabled={false}
      overScrollMode="never"
      bounces={false}
      androidLayerType="hardware"
    />
  );
}

const styles = StyleSheet.create({
  video: { flex: 1, backgroundColor: "transparent" },
});
