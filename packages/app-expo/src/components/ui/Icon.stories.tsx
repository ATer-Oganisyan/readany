import { useTheme } from "@/styles/theme";
import type { Meta, StoryObj } from "@storybook/react-native";
import { ScrollView, View } from "react-native";
import { MishanaerIcon, mishanaerIconNames } from "./MishanaerIcon";
import { Text } from "./Typography";

function IconCatalog() {
  const { colors } = useTheme();
  return (
    <ScrollView contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {mishanaerIconNames.map((name) => (
        <View key={name} style={{ width: 92, minHeight: 76, alignItems: "center", gap: 8 }}>
          <MishanaerIcon name={name} color={colors.foreground} size={28} />
          <Text style={{ color: colors.mutedForeground, fontSize: 10, textAlign: "center" }}>
            {name}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const meta = {
  title: "Примитивы/Mishanaer Icons",
  component: IconCatalog,
} satisfies Meta<typeof IconCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;
export const ВсеИконки: Story = {};
