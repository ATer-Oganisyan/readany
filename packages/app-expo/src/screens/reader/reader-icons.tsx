import { ListIcon, MishanaerIcon, type MishanaerIconName } from "@/components/ui/Icon";

// ──────────────────────────── Settings Icon (Gear) ────────────────────────────
export function SettingsIcon({ size = 24, color = "#e8e8ed" }: { size?: number; color?: string }) {
  return <MishanaerIcon name="gear" size={size} color={color} />;
}

export { ListIcon };

export function BatteryIcon({
  width = 24,
  color = "#e8e8ed",
  level,
  charging = false,
}: {
  width?: number;
  height?: number;
  color?: string;
  level?: number | null;
  charging?: boolean;
}) {
  const normalizedLevel =
    typeof level === "number" && Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : null;
  const fillColor = normalizedLevel != null && normalizedLevel <= 0.2 ? "#ef4444" : color;
  let iconName: MishanaerIconName = "battery-25%";
  if (charging) iconName = "battery-charging";
  else if (normalizedLevel != null && normalizedLevel < 0.125) iconName = "battery-0%";
  else if (normalizedLevel != null && normalizedLevel < 0.375) iconName = "battery-25%";
  else if (normalizedLevel != null && normalizedLevel < 0.625) iconName = "battery-50%";
  else if (normalizedLevel != null && normalizedLevel < 0.875) iconName = "battery-75%";
  else if (normalizedLevel != null) iconName = "battery-100%";

  return <MishanaerIcon name={iconName} size={width} color={fillColor} variant="stroke" />;
}
