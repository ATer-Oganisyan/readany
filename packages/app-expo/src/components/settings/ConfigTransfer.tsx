import { Text, TextInput } from "@/components/ui/Typography";
import { toast } from "@/lib/notifications";
import { decodeConfig, encodeConfig } from "@readany/core/utils";
import * as Clipboard from "expo-clipboard";
import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { TouchableOpacity, View } from "react-native";
import { fontSize, fontWeight, radius, useColors } from "../../styles/theme";

interface ConfigTransferProps {
  getData: () => unknown;
  applyData: (data: unknown) => void | Promise<void>;
  validate: (data: unknown) => boolean;
  label: string;
}

export const ConfigTransfer = memo(function ConfigTransfer({
  getData,
  applyData,
  validate,
  label,
}: ConfigTransferProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const [mode, setMode] = useState<"idle" | "export" | "import">("idle");
  const [token, setToken] = useState("");
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = useCallback(() => {
    try {
      const data = getData();
      const encoded = encodeConfig(data);
      setToken(encoded);
      setMode("export");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("common.error", "Ошибка"), {
        description: `${t("settings.exportFailed", "Не удалось экспортировать")}: ${msg}`,
      });
    }
  }, [getData, t]);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(token);
    toast.success(t("common.copied", "Скопировано"), {
      description: t("settings.copiedToClipboard", "Код скопирован в буфер обмена"),
    });
  }, [token, t]);

  const applyImportedData = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        toast.error(t("common.error", "Ошибка"), {
          description: t("settings.invalidConfig", "Неверный формат конфигурации"),
        });
        return;
      }
      const data = decodeConfig(trimmed);
      if (!data) {
        toast.error(t("common.error", "Ошибка"), {
          description: t("settings.invalidConfig", "Конфигурация повреждена или неполна"),
        });
        return;
      }
      if (!validate(data)) {
        toast.error(t("common.error", "Ошибка"), {
          description: t("settings.invalidConfig", "Неверный формат конфигурации"),
        });
        return;
      }
      try {
        setIsImporting(true);
        await applyData(data);
        toast.success(t("common.success", "Готово"), {
          description: t("settings.configImported", "Конфигурация импортирована"),
        });
        setMode("idle");
        setImportText("");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(t("common.error", "Ошибка"), {
          description: `${t("settings.importFailed", "Не удалось импортировать")}: ${msg}`,
        });
      } finally {
        setIsImporting(false);
      }
    },
    [validate, applyData, t],
  );

  const handleImport = useCallback(() => {
    void applyImportedData(importText);
  }, [importText, applyImportedData]);

  const handlePaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setImportText(text);
  }, []);

  if (mode === "export") {
    return (
      <View
        style={{
          gap: 12,
          padding: 16,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.muted + "40",
        }}
      >
        <TextInput
          value={token}
          editable={false}
          multiline
          selectTextOnFocus
          style={{
            minHeight: 60,
            padding: 12,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            color: colors.foreground,
            fontSize: fontSize.xs,
            textAlignVertical: "top",
          }}
        />
        <Text style={{ fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: "center" }}>
          {t("settings.copyToken", "复制下方口令，在另一台设备导入")}
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            onPress={handleCopy}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: radius.md,
              backgroundColor: colors.primary,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: fontSize.sm,
                color: colors.primaryForeground,
                fontWeight: fontWeight.medium,
              }}
            >
              {t("common.copy", "复制口令")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMode("idle")}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: radius.md,
              backgroundColor: colors.muted,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: fontSize.sm, color: colors.mutedForeground }}>
              {t("common.cancel", "取消")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (mode === "import") {
    return (
      <View
        style={{
          gap: 12,
          padding: 16,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.muted + "40",
        }}
      >
        <TextInput
          placeholder={t("settings.pasteConfig", "粘贴配置口令...")}
          placeholderTextColor={colors.mutedForeground}
          value={importText}
          onChangeText={setImportText}
          multiline
          style={{
            minHeight: 80,
            padding: 12,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            color: colors.foreground,
            fontSize: fontSize.xs,
            textAlignVertical: "top",
          }}
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            onPress={handlePaste}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.background,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: fontSize.sm, color: colors.foreground }}>
              {t("common.paste", "粘贴")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleImport}
            disabled={!importText.trim() || isImporting}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: radius.md,
              backgroundColor: colors.primary,
              alignItems: "center",
              opacity: importText.trim() && !isImporting ? 1 : 0.5,
            }}
          >
            <Text
              style={{
                fontSize: fontSize.sm,
                color: colors.primaryForeground,
                fontWeight: fontWeight.medium,
              }}
            >
              {t("settings.importConfig", "导入")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setMode("idle");
              setImportText("");
            }}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: radius.md,
              backgroundColor: colors.muted,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: fontSize.sm, color: colors.mutedForeground }}>
              {t("common.cancel", "取消")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TouchableOpacity
        onPress={handleExport}
        style={{
          flex: 1,
          paddingVertical: 10,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: fontSize.sm, color: colors.foreground }}>
          {t("settings.exportConfig", "导出")} {label}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setMode("import")}
        style={{
          flex: 1,
          paddingVertical: 10,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: fontSize.sm, color: colors.foreground }}>
          {t("settings.importConfig", "导入")} {label}
        </Text>
      </TouchableOpacity>
    </View>
  );
});
