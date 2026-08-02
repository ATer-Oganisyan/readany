import type { Meta, StoryObj } from "@storybook/react-native";
import {
  READER_PREVIEW_STATES,
  ReaderInterfacePreview,
  type ReaderPreviewState,
} from "./reader-interface-preview";

const meta = {
  title: "Читалка/Все состояния",
  component: ReaderInterfacePreview,
  args: {
    state: "reading",
    readerTheme: "light",
    fontSize: 21,
  },
  argTypes: {
    state: { control: "select", options: READER_PREVIEW_STATES },
    readerTheme: { control: "select", options: ["light", "sepia", "dark"] },
    fontSize: { control: { type: "range", min: 16, max: 34, step: 1 } },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ReaderInterfacePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Песочница: Story = {};

function stateStory(state: ReaderPreviewState): Story {
  return { args: { state } };
}

export const Чтение = stateStory("reading");
export const ПанелиУправления = stateStory("controls");
export const СтраницаВЗакладках = stateStory("bookmarked");
export const ДобавленоВЗакладки = stateStory("bookmark-added");
export const Поиск = stateStory("search-idle");
export const РезультатыПоиска = stateStory("search-results");
export const ПоискБезРезультатов = stateStory("search-empty");
export const ВыделениеТекста = stateStory("selection");
export const СозданиеЗаметки = stateStory("selection-note");
export const Оглавление = stateStory("toc");
export const Закладки = stateStory("bookmarks");
export const ЗакладкиПустые = stateStory("bookmarks-empty");
export const Блокнот = stateStory("notebook");
export const БлокнотПустой = stateStory("notebook-empty");
export const НастройкиЧтения = stateStory("settings");
export const Перевод = stateStory("translation");
export const ПереводЗагружается = stateStory("translation-loading");
export const Озвучивание = stateStory("tts");
export const Загрузка = stateStory("loading");
export const ФайлКнигиПотерян = stateStory("missing-book");
export const ОшибкаОткрытия = stateStory("error");

export const Сепия: Story = { args: { state: "reading", readerTheme: "sepia" } };
export const ТёмнаяТема: Story = { args: { state: "reading", readerTheme: "dark" } };
export const КрупныйШрифт: Story = { args: { state: "reading", fontSize: 32 } };
