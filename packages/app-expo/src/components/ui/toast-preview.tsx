import { NativeButton } from "@/components/ui/NativeButton";
import { Text } from "@/components/ui/Typography";
import { toast } from "@/lib/notifications";
import { headingFontFamily, useColors } from "@/styles/theme";
import { ScrollView, StyleSheet, View } from "react-native";

export function ToastPreview() {
  const colors = useColors();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.container}
      style={{ backgroundColor: colors.background }}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>Превью уведомлений</Text>
      <Text style={[styles.description, { color: colors.mutedForeground }]}>
        Это единый внешний вид sonner-native для transient-уведомлений приложения.
      </Text>

      <View style={styles.actions}>
        <NativeButton
          label="Загрузка книги"
          variant="primary"
          fullWidth
          onPress={() =>
            toast.loading("Загружаем книгу", {
              description: "Это может занять несколько секунд",
            })
          }
        />
        <NativeButton
          label="Закладка добавлена"
          variant="secondary"
          fullWidth
          onPress={() => toast.success("Закладка добавлена", { description: "Страница сохранена" })}
        />
        <NativeButton
          label="Показать ошибку"
          variant="destructive"
          fullWidth
          onPress={() =>
            toast.error("Не удалось загрузить книгу", {
              description: "Проверьте ссылку и попробуйте ещё раз",
            })
          }
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
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
