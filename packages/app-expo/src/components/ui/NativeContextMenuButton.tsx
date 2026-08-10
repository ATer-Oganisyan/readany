import { BookOpenIcon, MoreVerticalIcon, ShareIcon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Typography";
import { fontSize, fontWeight, radius, useColors } from "@/styles/theme";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, TouchableOpacity } from "react-native";
import type { NativeContextMenuButtonProps } from "./NativeContextMenuButton.types";

/**
 * Меню действий на Android. Раньше это был Alert.alert, и он давал два бага:
 * нативный диалог показывает максимум три кнопки (лишние, включая «Отмена»,
 * молча отбрасывались), а без options он ещё и не закрывался тапом мимо.
 * Bottom-sheet снимает оба ограничения: пунктов сколько угодно, закрытие —
 * тапом по фону или системной кнопкой «назад».
 */
export function NativeContextMenuButton({
  accessibilityLabel,
  items,
  sfSymbol = "ellipsis",
  size = 40,
  color,
  onOpenChange,
}: NativeContextMenuButtonProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const iconColor = color ?? colors.foreground;
  const availableItems = items.filter((item) => !item.disabled);

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const runItem = (onPress: () => void) => {
    setOpenState(false);
    onPress();
  };

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
        activeOpacity={0.7}
        onPress={() => setOpenState(true)}
      >
        {sfSymbol.startsWith("book") ? (
          <BookOpenIcon size={18} color={iconColor} />
        ) : sfSymbol === "square.and.arrow.up" ? (
          <ShareIcon size={18} color={iconColor} />
        ) : (
          <MoreVerticalIcon size={18} color={iconColor} />
        )}
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenState(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close", "Закрыть")}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
          onPress={() => setOpenState(false)}
        >
          {/* Тап по самому листу не должен закрывать меню. */}
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: radius.xxl,
              borderTopRightRadius: radius.xxl,
              paddingVertical: 8,
            }}
          >
            <Text
              style={{
                fontSize: fontSize.sm,
                fontWeight: fontWeight.semibold,
                color: colors.mutedForeground,
                paddingHorizontal: 20,
                paddingTop: 8,
                paddingBottom: 4,
              }}
            >
              {accessibilityLabel}
            </Text>
            {availableItems.map((item) => (
              <TouchableOpacity
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                activeOpacity={0.7}
                style={{ paddingVertical: 14, paddingHorizontal: 20 }}
                onPress={() => runItem(item.onPress)}
              >
                <Text
                  style={{
                    fontSize: fontSize.base,
                    color: item.destructive ? colors.destructive : colors.foreground,
                  }}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.7}
              style={{ paddingVertical: 14, paddingHorizontal: 20 }}
              onPress={() => setOpenState(false)}
            >
              <Text style={{ fontSize: fontSize.base, color: colors.mutedForeground }}>
                {t("common.cancel", "Отмена")}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
