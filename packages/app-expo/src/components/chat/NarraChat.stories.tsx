import type { Meta, StoryObj } from "@storybook/react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import {
  NarraComparisonFrame,
  TelegramChatComparisonHarness,
  TelegramReferenceFrame,
} from "./TelegramChatComparison";

const meta = {
  title: "Чат/Telegram iOS — visual comparison",
  component: TelegramChatComparisonHarness,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TelegramChatComparisonHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

function FullViewport({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, margin: -24 }}>{children}</View>;
}

export const Сравнение: Story = {};

export const СветлыйЭталон: Story = {
  render: () => (
    <FullViewport>
      <TelegramReferenceFrame theme="light" />
    </FullViewport>
  ),
};

export const СветлаяРеализация: Story = {
  render: () => (
    <FullViewport>
      <NarraComparisonFrame theme="light" />
    </FullViewport>
  ),
};

export const ТёмныйЭталон: Story = {
  render: () => (
    <FullViewport>
      <TelegramReferenceFrame theme="dark" />
    </FullViewport>
  ),
};

export const ТёмнаяРеализация: Story = {
  render: () => (
    <FullViewport>
      <NarraComparisonFrame theme="dark" />
    </FullViewport>
  ),
};

export const Typing: Story = {
  render: () => (
    <FullViewport>
      <NarraComparisonFrame theme="light" typing />
    </FullViewport>
  ),
};

export const КлавиатураИКомпозер: Story = {
  render: () => (
    <FullViewport>
      <NarraComparisonFrame theme="light" autoFocus />
    </FullViewport>
  ),
};

export const ОтправкаБезAPI: Story = {
  render: () => (
    <FullViewport>
      <NarraComparisonFrame
        theme="light"
        streaming={false}
        autoFocus
        initialText="No API smoke test"
      />
    </FullViewport>
  ),
  parameters: {
    notes: "onSend — локальный noop: можно проверить набор и очистку поля без AI-запроса.",
  },
};

export const LongPressМеню: Story = {
  render: () => (
    <FullViewport>
      <NarraComparisonFrame theme="light" showContextMenu />
    </FullViewport>
  ),
  parameters: {
    notes: "Удерживайте пузырь: реакции и Reply/Copy/Delete/Select — реальные действия.",
  },
};
