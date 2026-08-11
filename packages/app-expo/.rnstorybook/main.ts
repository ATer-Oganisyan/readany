import type { StorybookConfig } from "@storybook/react-native";

const readerOnly = process.env.EXPO_PUBLIC_READER_STORYBOOK_ONLY === "true";

const main: StorybookConfig = {
  stories: readerOnly
    ? ["../src/components/reader/*.stories.tsx"]
    : ["../src/**/*.stories.?(ts|tsx|js|jsx)"],
  deviceAddons: [
    "@storybook/addon-ondevice-controls",
    "@storybook/addon-ondevice-actions",
    "@storybook/addon-ondevice-backgrounds",
  ],
};

export default main;
