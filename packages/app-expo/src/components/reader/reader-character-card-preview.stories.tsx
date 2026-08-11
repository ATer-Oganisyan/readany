import type { Meta, StoryObj } from "@storybook/react-native";
import {
  ReaderCharacterCardPreview,
  type ReaderCharacterCardPreviewTheme,
} from "./reader-character-card-preview";

const meta = {
  title: "Читалка/Карточка персонажа",
  component: ReaderCharacterCardPreview,
  args: {
    readerTheme: "light",
    fontSize: 21,
    initiallyOpen: false,
  },
  argTypes: {
    readerTheme: { control: "select", options: ["light", "sepia", "dark"] },
    fontSize: { control: { type: "range", min: 16, max: 34, step: 1 } },
    initiallyOpen: { control: "boolean" },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ReaderCharacterCardPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const НажатиеНаИмя: Story = {};

export const КарточкаОткрыта: Story = {
  args: { initiallyOpen: true },
};

function themeStory(readerTheme: ReaderCharacterCardPreviewTheme): Story {
  return { args: { readerTheme } };
}

export const Сепия = themeStory("sepia");
export const ТёмнаяТема = themeStory("dark");
export const КрупныйШрифт: Story = { args: { fontSize: 30 } };
