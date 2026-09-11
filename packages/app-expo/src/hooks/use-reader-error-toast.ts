import { toast } from "@/lib/notifications";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export function useReaderErrorToast(
  error: string | null,
  isFocused: boolean,
  navigation: Pick<NativeStackNavigationProp<RootStackParamList>, "canGoBack" | "goBack" | "reset">,
  openingId: string,
) {
  const { t } = useTranslation();
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (!error || !isFocused || shownFor.current === openingId) return;
    shownFor.current = openingId;
    toast.error(t("reader.openFailedTitle", "Не удалось открыть книгу"), {
      description: t("reader.openFailedDescription", "Попробуйте ещё раз"),
    });
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.reset({ index: 0, routes: [{ name: "Tabs" }] });
  }, [error, isFocused, navigation, openingId, t]);
}
