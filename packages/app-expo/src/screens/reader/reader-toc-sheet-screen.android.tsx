import type { RootStackParamList } from "@/navigation/RootNavigator";
import { bodyTypography, useTheme } from "@/styles/theme";
import { spacingPixels } from "@deslop/primitives";
import {
  Column,
  Host,
  LazyColumn,
  ListItem,
  ModalBottomSheet,
  Text,
} from "@expo/ui/jetpack-compose";
import {
  clickable,
  fillMaxWidth,
  height,
  padding,
  weight,
} from "@expo/ui/jetpack-compose/modifiers";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { flattenTocItems } from "./reader-toc-items";
import { useReaderTOCSheet } from "./reader-toc-sheet-context";

export function ReaderTOCSheetScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "ReaderTOC">) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const { session } = useReaderTOCSheet();
  const rows = session
    ? flattenTocItems(session.toc, session.currentChapter, session.currentChapterHref)
    : [];

  return (
    <Host style={{ flex: 1 }} colorScheme={isDark ? "dark" : "light"}>
      <ModalBottomSheet
        onDismissRequest={() => (session ? session.onClose() : navigation.goBack())}
        showDragHandle
      >
        <Column modifiers={[height(windowHeight * 0.8 - 48 - bottom), fillMaxWidth()]}>
          <Text style={{ typography: "titleLarge" }} modifiers={[padding(24, 0, 24, 16)]}>
            {t("reader.toc", "Оглавление")}
          </Text>
          <LazyColumn modifiers={[weight(1), fillMaxWidth()]}>
            {rows.length ? (
              rows.map((row) => (
                <ListItem
                  key={row.key}
                  colors={{ containerColor: "transparent" }}
                  modifiers={
                    row.href
                      ? [
                          clickable(() => {
                            if (row.href) session?.onSelectTocItem(row.href);
                          }),
                        ]
                      : []
                  }
                >
                  <ListItem.HeadlineContent>
                    <Text
                      color={row.isCurrent ? colors.primary : undefined}
                      style={{ ...bodyTypography, fontWeight: row.isCurrent ? "600" : "400" }}
                      modifiers={[padding(row.level * spacingPixels[16], 0, 0, 0)]}
                    >
                      {row.title}
                    </Text>
                  </ListItem.HeadlineContent>
                </ListItem>
              ))
            ) : (
              <Text modifiers={[padding(24, 0, 24, 0)]}>{t("reader.noToc", "Нет оглавления")}</Text>
            )}
          </LazyColumn>
        </Column>
      </ModalBottomSheet>
    </Host>
  );
}
