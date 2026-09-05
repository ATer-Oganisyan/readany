import { getStrokeIconImageSource } from "@/components/ui/MishanaerIcon";
import { NativeButton } from "@/components/ui/NativeButton";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useColors } from "@/styles/theme";
import { type RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { Platform, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NotesView } from "./NotesView";

export function FullScreenNotesScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "FullScreenNotes">>();
  const { bookId } = route.params;

  useLayoutEffect(() => {
    const addNote = () => navigation.navigate("ManualNote", { bookId });
    if (Platform.OS !== "ios") {
      navigation.setOptions({
        headerRight: () => (
          <NativeButton
            label={t("common.add", "Добавить")}
            accessibilityLabel={t("notes.addNote", "Добавить заметку")}
            icon="add"
            size="small"
            variant="tertiary"
            onPress={addNote}
          />
        ),
      });
      return;
    }
    navigation.setOptions({
      headerRight: undefined,
      unstable_headerRightItems: () => [
        {
          type: "button" as const,
          label: t("notes.addNote", "Добавить заметку"),
          accessibilityLabel: t("notes.addNote", "Добавить заметку"),
          icon: { type: "image" as const, source: getStrokeIconImageSource("plus") },
          onPress: addNote,
        },
        {
          type: "button" as const,
          label: t("common.close", "Закрыть"),
          accessibilityLabel: t("common.close", "Закрыть"),
          icon: { type: "image" as const, source: getStrokeIconImageSource("x") },
          onPress: () => navigation.goBack(),
        },
      ],
    });
  }, [bookId, navigation, t]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["bottom"]}
    >
      <NotesView initialBookId={bookId} showBackButton={false} edges={[]} hideDetailHeader />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
