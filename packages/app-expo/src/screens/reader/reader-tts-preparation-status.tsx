import { Text } from "@/components/ui/Typography";
import { spacingPixels } from "@deslop/primitives";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";

export function ReaderTTSPreparationStatus({
  preparing,
  loading = false,
  onCancel,
  error,
  foreground,
  background,
}: {
  preparing: boolean;
  loading?: boolean;
  onCancel?: () => void;
  error: "empty" | "failed" | null;
  foreground: string;
  background: string;
}) {
  const { t } = useTranslation();
  if (!preparing && !loading && !error) return null;
  return (
    <View
      style={{
        marginHorizontal: spacingPixels[16],
        padding: spacingPixels[8],
        backgroundColor: background,
      }}
    >
      <Text
        selectable
        accessibilityLiveRegion="polite"
        accessibilityRole={error ? "alert" : "text"}
        style={{ color: foreground, textAlign: "center" }}
      >
        {t(
          preparing
            ? "reader.preparingAudioText"
            : loading
              ? "reader.loadingAudioText"
              : error === "empty"
                ? "reader.audioPreparationEmpty"
                : "reader.audioPreparationFailed",
        )}
      </Text>
      {(preparing || loading) && onCancel && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel", "Отменить")}
          onPress={onCancel}
          style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: foreground }}>{t("common.cancel", "Отменить")}</Text>
        </Pressable>
      )}
    </View>
  );
}
