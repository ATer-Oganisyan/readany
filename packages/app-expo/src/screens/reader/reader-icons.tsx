import { ListIcon, MaterialIcon } from "@/components/ui/Icon";
import Svg, { Path, Rect } from "react-native-svg";

// ──────────────────────────── Settings Icon (Gear) ────────────────────────────
export function SettingsIcon({ size = 24, color = "#e8e8ed" }: { size?: number; color?: string }) {
  return <MaterialIcon name="settings" size={size} color={color} />;
}

export { ListIcon };

export function BatteryIcon({
  width = 24,
  height = 12,
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
  const bodyWidth = width - 3;
  const innerPadding = 1.5;
  const innerWidth = Math.max(0, bodyWidth - innerPadding * 2);
  const fillWidth =
    normalizedLevel == null ? innerWidth * 0.42 : Math.max(2, innerWidth * normalizedLevel);
  const fillColor = normalizedLevel != null && normalizedLevel <= 0.2 ? "#ef4444" : color;
  const boltPath = [
    `M ${1 + bodyWidth * 0.52} ${height * 0.18}`,
    `L ${1 + bodyWidth * 0.4} ${height * 0.5}`,
    `H ${1 + bodyWidth * 0.56}`,
    `L ${1 + bodyWidth * 0.42} ${height * 0.82}`,
    `L ${1 + bodyWidth * 0.66} ${height * 0.42}`,
    `H ${1 + bodyWidth * 0.5}`,
  ].join(" ");

  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Rect x={1} y={1} width={bodyWidth} height={height - 2} rx={2.8} />
      <Rect
        x={3}
        y={2.6}
        width={fillWidth}
        height={Math.max(0, height - 5.2)}
        rx={1.8}
        fill={fillColor}
        stroke="none"
      />
      <Rect
        x={width - 2}
        y={height / 2 - 2}
        width={2}
        height={4}
        rx={1}
        fill={color}
        stroke="none"
      />
      {charging ? (
        <Path
          d={boltPath}
          fill="none"
          stroke="#fffaf0"
          strokeWidth={1.15}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </Svg>
  );
}
