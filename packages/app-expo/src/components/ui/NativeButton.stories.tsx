import type { Meta, StoryObj } from "@storybook/react-native";
import { View } from "react-native";
import { NativeButton } from "./NativeButton";

const meta = {
  title: "Примитивы/Нативная кнопка",
  component: NativeButton,
  args: {
    label: "Продолжить",
    onPress: () => {},
    variant: "primary",
    size: "medium",
    disabled: false,
    fullWidth: false,
  },
  argTypes: {
    variant: { control: "select", options: ["primary", "secondary", "tertiary", "destructive"] },
    size: { control: "select", options: ["small", "medium", "large"] },
    icon: {
      control: "select",
      options: [undefined, "add", "back", "forward", "check", "close", "delete", "edit", "play", "refresh", "search", "send", "settings", "share"],
    },
  },
} satisfies Meta<typeof NativeButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Песочница: Story = {};

export const ВсеВарианты: Story = {
  render: () => (
    <View style={{ gap: 16 }}>
      <NativeButton label="Основное действие" onPress={() => {}} variant="primary" />
      <NativeButton label="Вторичное действие" onPress={() => {}} variant="secondary" />
      <NativeButton label="Текстовое действие" onPress={() => {}} variant="tertiary" />
      <NativeButton label="Удалить книгу" onPress={() => {}} variant="destructive" icon="delete" />
      <NativeButton label="Недоступно" onPress={() => {}} disabled />
      <NativeButton label="Во всю ширину" onPress={() => {}} icon="forward" size="large" fullWidth />
    </View>
  ),
};
