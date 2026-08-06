import { Text } from "@/components/ui/Typography";
import { useColors } from "@/styles/theme";
import type { Meta, StoryObj } from "@storybook/react-native";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { CatalogBookCard } from "./CatalogBookCard";

const covers = [
  {
    id: "fathers-and-sons",
    title: "Отцы и дети",
    author: "Иван Тургенев",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/fathers-and-sons.jpg"),
  },
  {
    id: "anna-karenina",
    title: "Анна Каренина",
    author: "Лев Толстой",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/anna-karenina.jpg"),
  },
  {
    id: "war-and-peace",
    title: "Война и мир",
    author: "Лев Толстой",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/war-and-peace.jpg"),
  },
  {
    id: "crime-and-punishment",
    title: "Преступление и наказание",
    author: "Фёдор Достоевский",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/crime-and-punishment.jpg"),
  },
  {
    id: "government-inspector",
    title: "Ревизор",
    author: "Николай Гоголь",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/government-inspector.jpg"),
  },
  {
    id: "dead-souls",
    title: "Мёртвые души",
    author: "Николай Гоголь",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/dead-souls.jpg"),
  },
  {
    id: "hero-of-our-time",
    title: "Герой нашего времени",
    author: "Михаил Лермонтов",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/hero-of-our-time.jpg"),
  },
  {
    id: "captains-daughter",
    title: "Капитанская дочка",
    author: "Александр Пушкин",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/captains-daughter.jpg"),
  },
  {
    id: "eugene-onegin",
    title: "Евгений Онегин",
    author: "Александр Пушкин",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/eugene-onegin.jpg"),
  },
  {
    id: "gentleman-from-san-francisco",
    title: "Господин из Сан-Франциско",
    author: "Иван Бунин",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/gentleman-from-san-francisco.jpg"),
  },
  {
    id: "dark-avenues",
    title: "Тёмные аллеи",
    author: "Иван Бунин",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/dark-avenues.jpg"),
  },
  {
    id: "golden-key",
    title: "Золотой ключик",
    author: "Алексей Толстой",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/golden-key.jpg"),
  },
  {
    id: "twelve-chairs",
    title: "Двенадцать стульев",
    author: "Илья Ильф и Евгений Петров",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/twelve-chairs.jpg"),
  },
  {
    id: "three-sisters",
    title: "Три сестры",
    author: "Антон Чехов",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/three-sisters.jpg"),
  },
  {
    id: "seagull",
    title: "Чайка",
    author: "Антон Чехов",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/seagull.jpg"),
  },
  {
    id: "cherry-orchard",
    title: "Вишнёвый сад",
    author: "Антон Чехов",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/cherry-orchard.jpg"),
  },
  {
    id: "thunderstorm",
    title: "Гроза",
    author: "Александр Островский",
    asset: require("../../../assets/catalog/cover-variants/nano-varied-backgrounds-v2/thunderstorm.jpg"),
  },
] as const;

function CatalogCoverBackgrounds() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const horizontalPadding = 20;
  const gap = 14;
  const cardWidth = Math.min(176, (width - horizontalPadding * 2 - gap) / 2);

  return (
    <ScrollView
      style={{ backgroundColor: colors.backgroundPrimary }}
      contentContainerStyle={styles.content}
    >
      <View style={styles.intro}>
        <Text style={[styles.title, { color: colors.foreground }]}>Обложки с разными фонами</Text>
        <Text style={[styles.description, { color: colors.mutedForeground }]}>
          Nano Banana · графический элемент в нижних двух третях · без текста внутри изображения
        </Text>
      </View>
      <View style={[styles.grid, { columnGap: gap, rowGap: 28 }]}>
        {covers.map((book) => (
          <CatalogBookCard
            key={book.id}
            title={book.title}
            author={book.author}
            coverAssetModule={book.asset}
            cardWidth={cardWidth}
            isImporting={false}
            isInLibrary={false}
            onPress={() => undefined}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingBottom: 64,
    paddingTop: 28,
  },
  intro: {
    gap: 6,
    marginBottom: 28,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
  },
  grid: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
  },
});

const meta = {
  title: "Каталог/Обложки — разные фоны",
  component: CatalogCoverBackgrounds,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CatalogCoverBackgrounds>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ВсеКниги: Story = {};
