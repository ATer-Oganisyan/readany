import { Text } from "@/components/ui/Typography";
import { useColors } from "@/styles/theme";
import type { Meta, StoryObj } from "@storybook/react-native";
import { View } from "react-native";
import { PressableScale } from "./PressableScale";

const meta = {
  title: "Примитивы/Нажатие",
  component: PressableScale,
  args: {
    pressedScale: 0.97,
    disableScale: false,
    onPress: () => {},
  },
  argTypes: {
    pressedScale: { control: { type: "range", min: 0.8, max: 1, step: 0.01 } },
  },
} satisfies Meta<typeof PressableScale>;

export default meta;
type Story = StoryObj<typeof meta>;

function Card({ label }: { label: string }) {
  const colors = useColors();
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 20,
        paddingHorizontal: 16,
      }}
    >
      <Text>{label}</Text>
    </View>
  );
}

/** Ползунок pressedScale в панели управления — чтобы поймать порог на глаз. */
export const Песочница: Story = {
  render: (args) => (
    <PressableScale {...args}>
      <Card label="Нажми и подержи" />
    </PressableScale>
  ),
};

/**
 * Глубина вжатия зависит от размера поверхности: 0.97 на карточке во весь экран
 * читается как «уезжает вдаль», а на иконке 20pt вообще не виден.
 */
export const ГлубинаПоРазмеру: Story = {
  render: () => (
    <View style={{ gap: 16 }}>
      <PressableScale onPress={() => {}} pressedScale={0.98}>
        <Card label="0.98 — крупная карточка" />
      </PressableScale>
      <PressableScale onPress={() => {}} pressedScale={0.97}>
        <Card label="0.97 — значение по умолчанию" />
      </PressableScale>
      <PressableScale onPress={() => {}} pressedScale={0.94}>
        <Card label="0.94 — строка списка" />
      </PressableScale>
      <PressableScale onPress={() => {}} pressedScale={0.88}>
        <Card label="0.88 — мелкая иконка" />
      </PressableScale>
    </View>
  ),
};

/**
 * Сравнение со старым откликом. Затухание прозрачности читается как «экран
 * моргнул»: подпись внутри не двигается, поэтому нажатие не ощущается физическим.
 */
export const ВжатиеПротивЗатухания: Story = {
  render: () => (
    <View style={{ gap: 16 }}>
      <PressableScale onPress={() => {}}>
        <Card label="Вжатие — подпись едет вместе с фоном" />
      </PressableScale>
      <PressableScale onPress={() => {}} disableScale>
        <Card label="Без вжатия — для сравнения" />
      </PressableScale>
    </View>
  ),
};

/**
 * Допуск на дрожание пальца: нажми, уведи палец на сантиметр в сторону, не
 * отпуская, и вернись. Нажатие не должно отменяться.
 */
export const ДопускНаДрожание: Story = {
  render: () => (
    <View style={{ gap: 16 }}>
      <PressableScale onPress={() => {}} pressRetentionOffset={12}>
        <Card label="Допуск 12pt — по умолчанию" />
      </PressableScale>
      <PressableScale onPress={() => {}} pressRetentionOffset={0}>
        <Card label="Допуск 0 — сорвётся от малейшего сдвига" />
      </PressableScale>
    </View>
  ),
};
