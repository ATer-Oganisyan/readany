import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { headingFontFamily, useColors } from "@/styles/theme";
import { StyleSheet, View } from "react-native";
import Toast from "react-native-toast-message";

export function ToastPreview() {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>Превью уведомлений</Text>
      <Text style={[styles.description, { color: colors.mutedForeground }]}>
        Это стандартный внешний вид react-native-toast-message без нашей кастомизации.
      </Text>

      <View style={styles.actions}>
        <NativeButton
          label="Загрузка книги"
          variant="primary"
          fullWidth
          onPress={() =>
            Toast.show({
              type: "info",
              text1: "Загружаем книгу",
              text2: "Это может занять несколько секунд",
            })
          }
        />
        <NativeButton
          label="Закладка добавлена"
          variant="secondary"
          fullWidth
          onPress={() =>
            Toast.show({
              type: "success",
              text1: "Закладка добавлена",
              text2: "Страница сохранена",
            })
          }
        />
        <NativeButton
          label="Показать ошибку"
          variant="destructive"
          fullWidth
          onPress={() =>
            Toast.show({
              type: "error",
              text1: "Не удалось загрузить книгу",
              text2: "Проверьте ссылку и попробуйте ещё раз",
            })
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 12,
    padding: 20,
  },
  title: {
    fontFamily: headingFontFamily,
    fontSize: 22,
    fontWeight: "700",
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    gap: 12,
    marginTop: 8,
  },
});
