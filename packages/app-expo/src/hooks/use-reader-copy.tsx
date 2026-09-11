import { toast } from "@/lib/notifications";
import { useColors } from "@/styles/theme";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import CopyToastIcon from "../../assets/icons/copy-2.svg";

export function useReaderCopy() {
  const { t } = useTranslation();
  const colors = useColors();
  return async (text: string, nativeCopied: boolean) => {
    if (typeof text !== "string" || !text) return;
    try {
      if (!nativeCopied) await Clipboard.setStringAsync(text);
      toast.success(t("common.copied", "Скопировано"), {
        icon: <CopyToastIcon width={24} height={24} color={colors.primary60} />,
      });
    } catch {
      toast.error(t("common.error", "Ошибка"));
    }
  };
}
