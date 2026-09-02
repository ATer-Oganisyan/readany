import { MishanaerIcon } from "@/components/ui/MishanaerIcon";
import { NativeContextMenuButton } from "@/components/ui/NativeContextMenuButton";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import type { ReaderTopBarProps } from "./ReaderTopBar.types";

const BAR_HEIGHT = 50;
const CONTROL_SIZE = 44;
const HORIZONTAL_INSET = 20;

export function ReaderTopBar(props: ReaderTopBarProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={t("common.close", "Закрыть")}
        accessibilityRole="button"
        hitSlop={8}
        onPress={props.onClosePress}
        style={styles.control}
      >
        <MishanaerIcon name="x" size={22} color={props.tintColor} />
      </Pressable>

      {props.showTrailingActions !== false ? (
        <View style={styles.trailing}>
          <Pressable
            accessibilityLabel={t("narra.readerAppearance", "Оформление")}
            accessibilityRole="button"
            hitSlop={8}
            onPress={props.onAppearancePress}
            style={styles.control}
          >
            <MishanaerIcon name="text-t" size={22} color={props.tintColor} />
          </Pressable>
          <NativeContextMenuButton
            accessibilityLabel={t("reader.bookActions", "Действия с книгой")}
            items={props.actions}
            onOpenChange={props.onActionsOpenChange}
            color={props.tintColor}
            size={CONTROL_SIZE}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: HORIZONTAL_INSET,
  },
  control: {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  trailing: { flexDirection: "row", alignItems: "center", gap: 4 },
});

export { BAR_HEIGHT as READER_TOP_BAR_HEIGHT };
export type { ReaderTopBarProps } from "./ReaderTopBar.types";
