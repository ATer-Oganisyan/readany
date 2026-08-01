import {
  interfaceFontAssets,
  serifTextFontAssets,
  serifTextFontFamily,
} from "@deslop/primitives/native";
import i18n from "@readany/core/i18n";
import type { Preview } from "@storybook/react-native";
import { useFonts } from "expo-font";
import type { PropsWithChildren } from "react";
import { I18nextProvider } from "react-i18next";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "../src/styles/ThemeContext";

function Canvas({ children, fullscreen }: PropsWithChildren<{ fullscreen?: boolean }>) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, padding: fullscreen ? 0 : 24, backgroundColor: colors.background }}>
      {children}
    </View>
  );
}

function Providers({ children, fullscreen }: PropsWithChildren<{ fullscreen?: boolean }>) {
  const [fontsLoaded] = useFonts({
    ...interfaceFontAssets,
    [serifTextFontFamily.regular]: serifTextFontAssets.regular,
    [serifTextFontFamily.bold]: serifTextFontAssets.bold,
  });
  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            <Canvas fullscreen={fullscreen}>{children}</Canvas>
          </ThemeProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const preview: Preview = {
  decorators: [
    (Story, context) => (
      <Providers fullscreen={context.parameters.layout === "fullscreen"}>
        <Story />
      </Providers>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    backgrounds: {
      default: "Системный фон",
      values: [
        { name: "Системный фон", value: "#faf9f5" },
        { name: "Тёмный фон", value: "#1c1c1e" },
      ],
    },
  },
};

export default preview;
