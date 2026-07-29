import type { Meta, StoryObj } from "@storybook/react-native";
import { View } from "react-native";
import { useTheme } from "@/styles/theme";
import { Text, TextInput } from "./Typography";

function TypographyCatalog() {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: colors.foreground, fontSize: 32, fontWeight: "700" }}>Заголовок экрана</Text>
      <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: "600" }}>Заголовок раздела</Text>
      <Text style={{ color: colors.foreground, fontSize: 16, lineHeight: 24 }}>Основной текст набран шрифтом Interface и остаётся удобным для длинного чтения.</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Вторичная подпись и пояснение</Text>
      <TextInput
        placeholder="Название книги"
        placeholderTextColor={colors.mutedForeground}
        style={{ color: colors.foreground, borderColor: colors.border, borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 14 }}
      />
    </View>
  );
}

const meta = {
  title: "Примитивы/Типографика и ввод",
  component: TypographyCatalog,
} satisfies Meta<typeof TypographyCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;
export const ВсеСтили: Story = {};
