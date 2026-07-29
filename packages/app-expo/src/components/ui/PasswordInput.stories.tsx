import type { Meta, StoryObj } from "@storybook/react-native";
import { useTheme } from "@/styles/theme";
import { PasswordInput } from "./PasswordInput";

function PasswordInputDemo() {
  const { colors } = useTheme();
  return (
    <PasswordInput
      placeholder="Пароль"
      placeholderTextColor={colors.mutedForeground}
      style={{ color: colors.foreground, borderColor: colors.border, borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 14 }}
    />
  );
}

const meta = {
  title: "Поля/Пароль",
  component: PasswordInputDemo,
} satisfies Meta<typeof PasswordInputDemo>;

export default meta;
type Story = StoryObj<typeof meta>;
export const ПоУмолчанию: Story = {};
