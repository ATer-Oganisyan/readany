import { interfaceFontAssets } from "@deslop/primitives/native";
import type { Preview } from "@storybook/react-native";
import { useFonts } from "expo-font";
import type { PropsWithChildren } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { I18nextProvider } from "react-i18next";
import i18n from "@readany/core/i18n";
import { ThemeProvider, useTheme } from "../src/styles/ThemeContext";

function Canvas({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  return <View style={{ flex: 1, padding: 24, backgroundColor: colors.background }}>{children}</View>;
}

function Providers({ children }: PropsWithChildren) {
  const [fontsLoaded] = useFonts(interfaceFontAssets);
  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            <Canvas>{children}</Canvas>
          </ThemeProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const preview: Preview = {
  decorators: [
    (Story) => (
      <Providers>
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
