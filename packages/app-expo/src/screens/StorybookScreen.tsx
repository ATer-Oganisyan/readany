import {
  MishanaerIcon,
  type MishanaerIconName,
  mishanaerIconNames,
} from "@/components/ui/MishanaerIcon";
import { NativeButton } from "@/components/ui/NativeButton";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { Text, TextInput } from "@/components/ui/Typography";
import { ToastPreview } from "@/components/ui/toast-preview";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { ChatScreen } from "@/screens/ChatScreen";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { NotesView } from "@/screens/NotesView";
import { ProfileScreen } from "@/screens/ProfileScreen";
import StatsScreen from "@/screens/StatsScreen";
import AISettingsScreen from "@/screens/settings/AISettingsScreen";
import AboutScreen from "@/screens/settings/AboutScreen";
import AppearanceSettingsScreen from "@/screens/settings/AppearanceSettingsScreen";
import SyncSettingsScreen from "@/screens/settings/SyncSettingsScreen";
import TTSSettingsScreen from "@/screens/settings/TTSSettingsScreen";
import TranslationSettingsScreen from "@/screens/settings/TranslationSettingsScreen";
import VectorModelSettingsScreen from "@/screens/settings/VectorModelSettingsScreen";
import { secondLevelTitleFontFamily, useColors } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ComponentType } from "react";
import { Pressable, ScrollView, SectionList, StyleSheet, View } from "react-native";

type CatalogItem = {
  id: string;
  title: string;
  subtitle: string;
  icon: MishanaerIconName;
  preview: ComponentType;
};

function ButtonPreview() {
  return (
    <PreviewCanvas>
      <PreviewHeading title="Варианты" />
      <NativeButton label="Основное действие" onPress={() => {}} variant="primary" />
      <NativeButton label="Вторичное действие" onPress={() => {}} variant="secondary" />
      <NativeButton label="Текстовое действие" onPress={() => {}} variant="tertiary" />
      <NativeButton label="Удалить книгу" onPress={() => {}} variant="destructive" icon="delete" />
      <NativeButton label="Недоступно" onPress={() => {}} disabled />
      <NativeButton
        label="Во всю ширину"
        onPress={() => {}}
        icon="forward"
        size="large"
        fullWidth
      />
    </PreviewCanvas>
  );
}

function IconsPreview() {
  const colors = useColors();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.iconGrid}
      style={{ backgroundColor: colors.background }}
    >
      {mishanaerIconNames.map((name) => (
        <View key={name} style={styles.iconItem}>
          <MishanaerIcon name={name} color={colors.foreground} size={30} />
          <Text style={[styles.iconName, { color: colors.mutedForeground }]}>{name}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function TypographyPreview() {
  const colors = useColors();
  return (
    <PreviewCanvas>
      <Text style={[styles.displayTitle, { color: colors.foreground }]}>Заголовок экрана</Text>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Заголовок раздела</Text>
      <Text style={[styles.bodyText, { color: colors.foreground }]}>Основной текст интерфейса</Text>
      <Text style={[styles.caption, { color: colors.mutedForeground }]}>Вторичная подпись</Text>
      <TextInput
        placeholder="Название книги"
        placeholderTextColor={colors.mutedForeground}
        style={[
          styles.textField,
          { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
        ]}
      />
    </PreviewCanvas>
  );
}

function PasswordPreview() {
  const colors = useColors();
  return (
    <PreviewCanvas>
      <PreviewHeading title="Поле пароля" />
      <PasswordInput
        placeholder="Пароль"
        placeholderTextColor={colors.mutedForeground}
        style={[
          styles.textField,
          { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
        ]}
      />
    </PreviewCanvas>
  );
}

function EditorPreview() {
  return (
    <PreviewCanvas>
      <RichTextEditor
        initialContent="## Мысль о книге\n\nВажный фрагмент и **короткий вывод**."
        placeholder="Что хотите запомнить"
      />
    </PreviewCanvas>
  );
}

function NotesPreview() {
  return <NotesView edges={[]} showBackButton={false} />;
}

function PreviewCanvas({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.previewCanvas}
      style={{ backgroundColor: colors.background }}
    >
      {children}
    </ScrollView>
  );
}

function PreviewHeading({ title }: { title: string }) {
  const colors = useColors();
  return <Text style={[styles.previewHeading, { color: colors.foreground }]}>{title}</Text>;
}

const componentItems: CatalogItem[] = [
  {
    id: "native-button",
    title: "Нативная кнопка",
    subtitle: "Состояния, размеры и действия",
    icon: "hand",
    preview: ButtonPreview,
  },
  {
    id: "toast",
    title: "Toast",
    subtitle: "Загрузка, успех и ошибка",
    icon: "bell",
    preview: ToastPreview,
  },
  {
    id: "mishanaer-icons",
    title: "Mishanaer Icons",
    subtitle: "Stroke-иконки приложения",
    icon: "grid-2x2",
    preview: IconsPreview,
  },
  {
    id: "typography",
    title: "Типографика",
    subtitle: "Заголовки, текст и поля",
    icon: "text-t",
    preview: TypographyPreview,
  },
  {
    id: "password",
    title: "Пароль",
    subtitle: "Поле с показом и скрытием",
    icon: "eye",
    preview: PasswordPreview,
  },
  {
    id: "note-editor",
    title: "Редактор заметки",
    subtitle: "Форматирование и предпросмотр",
    icon: "pencil-square",
    preview: EditorPreview,
  },
];

const pageItems: CatalogItem[] = [
  {
    id: "library",
    title: "Библиотека",
    subtitle: "Список и импорт книг",
    icon: "books-spines",
    preview: LibraryScreen,
  },
  {
    id: "chat",
    title: "ИИ",
    subtitle: "Диалоги и помощник по чтению",
    icon: "chat-bubble",
    preview: ChatScreen,
  },
  {
    id: "notes",
    title: "Заметки",
    subtitle: "Цитаты, заметки и блокноты",
    icon: "note",
    preview: NotesPreview,
  },
  {
    id: "profile",
    title: "Профиль",
    subtitle: "Статистика и настройки",
    icon: "person",
    preview: ProfileScreen,
  },
  {
    id: "stats",
    title: "Статистика",
    subtitle: "Прогресс и активность чтения",
    icon: "chart-bar",
    preview: StatsScreen,
  },
  {
    id: "appearance",
    title: "Оформление",
    subtitle: "Тема и внешний вид",
    icon: "palette",
    preview: AppearanceSettingsScreen,
  },
  {
    id: "ai-settings",
    title: "Настройки ИИ",
    subtitle: "Модель и подключение",
    icon: "sparkles",
    preview: AISettingsScreen,
  },
  {
    id: "semantic-search",
    title: "Смысловой поиск",
    subtitle: "Модель поиска по содержанию",
    icon: "book-open-magnifying-glass",
    preview: VectorModelSettingsScreen,
  },
  {
    id: "speech",
    title: "Озвучивание",
    subtitle: "Голос и воспроизведение",
    icon: "headphones",
    preview: TTSSettingsScreen,
  },
  {
    id: "translation",
    title: "Перевод",
    subtitle: "Язык и модель перевода",
    icon: "translate",
    preview: TranslationSettingsScreen,
  },
  {
    id: "sync",
    title: "Синхронизация",
    subtitle: "Резервная копия библиотеки",
    icon: "cloud",
    preview: SyncSettingsScreen,
  },
  {
    id: "about",
    title: "О приложении",
    subtitle: "Версия и полезные ссылки",
    icon: "question-circle",
    preview: AboutScreen,
  },
];

const allItems = [...componentItems, ...pageItems];

export type StorybookItemId = (typeof allItems)[number]["id"];

export function getStorybookItemTitle(id: string): string {
  return allItems.find((item) => item.id === id)?.title ?? "Компонент";
}

type CatalogProps = NativeStackScreenProps<RootStackParamList, "Storybook">;

export function StorybookScreen({ navigation }: CatalogProps) {
  const colors = useColors();

  return (
    <SectionList
      sections={[
        { title: "Компоненты", data: componentItems },
        { title: "Страницы", data: pageItems },
      ]}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.catalogContent}
      style={{ backgroundColor: colors.background }}
      renderSectionHeader={({ section }) => (
        <Text style={[styles.catalogSectionTitle, { color: colors.mutedForeground }]}>
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Открыть: ${item.title}`}
          onPress={() => navigation.navigate("StorybookPreview", { id: item.id })}
          style={({ pressed }) => [
            styles.catalogCell,
            {
              backgroundColor: pressed ? colors.muted : colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={[styles.catalogIcon, { backgroundColor: colors.muted }]}>
            <MishanaerIcon name={item.icon} size={22} color={colors.foreground} />
          </View>
          <View style={styles.catalogText}>
            <Text style={[styles.catalogTitle, { color: colors.foreground }]}>{item.title}</Text>
            <Text style={[styles.catalogSubtitle, { color: colors.mutedForeground }]}>
              {item.subtitle}
            </Text>
          </View>
          <MishanaerIcon name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>
      )}
    />
  );
}

type PreviewProps = NativeStackScreenProps<RootStackParamList, "StorybookPreview">;

export function StorybookPreviewScreen({ route }: PreviewProps) {
  const item = allItems.find((entry) => entry.id === route.params.id);
  const colors = useColors();

  if (!item) {
    return (
      <View style={[styles.missingPreview, { backgroundColor: colors.background }]}>
        <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
          Компонент не найден
        </Text>
      </View>
    );
  }

  const Preview = item.preview;
  return <Preview />;
}

const styles = StyleSheet.create({
  catalogContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  catalogSectionTitle: {
    fontFamily: secondLevelTitleFontFamily,
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 4,
    fontSize: 13,
    fontWeight: "400",
    textTransform: "uppercase",
  },
  catalogCell: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
  },
  catalogIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  catalogText: {
    flex: 1,
    gap: 2,
  },
  catalogTitle: {
    fontFamily: secondLevelTitleFontFamily,
    fontSize: 16,
    fontWeight: "600",
  },
  catalogSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  previewCanvas: {
    flexGrow: 1,
    gap: 16,
    padding: 20,
  },
  previewHeading: {
    fontFamily: secondLevelTitleFontFamily,
    fontSize: 22,
    fontWeight: "700",
  },
  displayTitle: {
    fontFamily: secondLevelTitleFontFamily,
    fontSize: 32,
    fontWeight: "700",
  },
  sectionTitle: {
    fontFamily: secondLevelTitleFontFamily,
    fontSize: 22,
    fontWeight: "600",
  },
  bodyText: {
    fontSize: 16,
    lineHeight: 24,
  },
  caption: {
    fontSize: 14,
  },
  textField: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 12,
  },
  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    padding: 20,
  },
  iconItem: {
    width: 92,
    minHeight: 76,
    alignItems: "center",
    gap: 8,
  },
  iconName: {
    fontSize: 10,
    textAlign: "center",
  },
  missingPreview: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
});
