import Svg, { Circle, Path, Rect } from "react-native-svg";

export function NarraLogo({ size = 96 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="Narra">
      <Rect width="64" height="64" rx="14" fill="#111111" />
      <Path
        d="M13 19.5c7.2-1.1 13.6.6 19 5.1 5.4-4.5 11.8-6.2 19-5.1v24.2c-7.3-.8-13.7 1-19 5.3-5.3-4.3-11.7-6.1-19-5.3V19.5Z"
        fill="#fff"
      />
      <Path d="M32 24.6V49" stroke="#111" strokeWidth="2.4" strokeLinecap="round" />
      <Circle cx="24" cy="34" r="2.3" fill="#b8ff39" />
      <Circle cx="40" cy="34" r="2.3" fill="#b8ff39" />
      <Path
        d="M25.5 40.5c2 2 4.2 3 6.5 3s4.5-1 6.5-3"
        fill="none"
        stroke="#b8ff39"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </Svg>
  );
}
