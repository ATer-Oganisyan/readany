import { useTheme } from "@/styles/theme";
import type { Meta, StoryObj } from "@storybook/react-native";
import { ScrollView, View } from "react-native";
import { MaterialIcon } from "./Icon";
import { Text } from "./Typography";

const iconNames = [
  "book_2",
  "chat",
  "chat_add_on",
  "edit",
  "person",
  "add",
  "search",
  "close",
  "filter_list",
  "chevron_right",
  "chevron_left",
  "folder",
  "folder_open",
  "file_open",
  "more_vert",
  "analytics",
  "description",
  "bolt",
  "event",
  "palette",
  "refresh",
  "cloud",
  "database",
  "notifications",
  "mic",
  "play_arrow",
  "cancel",
  "arrow_back",
  "arrow_forward",
  "language",
  "terminal",
  "apps",
  "help",
  "info",
  "bar_chart",
  "schedule",
  "workspace_premium",
  "shield",
  "content_copy",
  "delete",
  "badge",
  "verified",
  "star",
  "tune",
  "send",
  "error",
  "expand_more",
  "expand_less",
  "check",
  "share",
  "calendar_month",
  "currency_exchange",
  "light_mode",
  "dark_mode",
  "visibility",
  "visibility_off",
  "remove",
  "menu",
  "link",
  "add_circle",
  "remove_circle",
  "download",
  "open_in_new",
  "dock_to_left",
  "favorite",
  "public",
  "grid_view",
  "archive",
  "warning",
  "check_circle",
  "qr_code_scanner",
] as const;

function IconCatalog() {
  const { colors } = useTheme();
  return (
    <ScrollView contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {iconNames.map((name) => (
        <View key={name} style={{ width: 92, minHeight: 76, alignItems: "center", gap: 8 }}>
          <MaterialIcon name={name} color={colors.foreground} size={28} />
          <Text style={{ color: colors.mutedForeground, fontSize: 10, textAlign: "center" }}>
            {name}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const meta = {
  title: "Примитивы/Material Icons",
  component: IconCatalog,
} satisfies Meta<typeof IconCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;
export const ВсеИконки: Story = {};
