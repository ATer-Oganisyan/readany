import type { Meta, StoryObj } from "@storybook/react-native";
import { RichTextEditor } from "./RichTextEditor";

const meta = {
  title: "Поля/Редактор заметки",
  component: RichTextEditor,
  args: {
    initialContent: "## Мысль о книге\n\nВажный фрагмент и **короткий вывод**.",
    placeholder: "Напишите, что хотите запомнить",
  },
} satisfies Meta<typeof RichTextEditor>;

export default meta;
type Story = StoryObj<typeof meta>;
export const ПоУмолчанию: Story = {};
