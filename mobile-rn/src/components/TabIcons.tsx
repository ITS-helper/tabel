import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useTheme } from "../context/ThemeContext";

function useNeonPulse(active: boolean) {
  const pulse = useRef(new Animated.Value(active ? 1 : 0.55)).current;

  useEffect(() => {
    if (!active) {
      pulse.setValue(0.55);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0.42,
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  return pulse;
}

type IconProps = {
  active?: boolean;
  size?: number;
};

function NeonWrap({
  active = false,
  size = 24,
  children,
}: IconProps & { children: (colors: { primary: string; glow: string; blue: string }) => ReactNode }) {
  const { colors, isDark } = useTheme();
  const pulse = useNeonPulse(!!active && isDark);
  const glow = pulse.interpolate({
    inputRange: [0.4, 1],
    outputRange: [0.35, 1],
  });

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        opacity: active ? glow : 0.5,
        shadowColor: active && isDark ? colors.neon : "transparent",
        shadowOpacity: active && isDark ? 0.95 : 0,
        shadowRadius: isDark ? 12 : 4,
        shadowOffset: { width: 0, height: 0 },
      }}
    >
      {children({
        primary: active ? colors.neon : colors.textMuted,
        glow: active ? colors.accent : colors.textMuted,
        blue: active ? colors.neonDim : colors.textMuted,
      })}
    </Animated.View>
  );
}

/** Карты — как в WorkWatch sidebar. */
export function TabMapIcon({ active, size = 24 }: IconProps) {
  return (
    <NeonWrap active={active} size={size}>
      {({ primary, glow, blue }) => (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M4 6.5 9 4.5v13L4 19.5V6.5Z"
            stroke={glow}
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
          <Path
            d="M9 4.5 15 6.5v13L9 17.5V4.5Z"
            stroke={primary}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          <Path
            d="M15 6.5 20 8.5v13l-5-2V6.5Z"
            stroke={blue}
            strokeWidth={1.4}
            strokeLinejoin="round"
            opacity={active ? 1 : 0.7}
          />
        </Svg>
      )}
    </NeonWrap>
  );
}

/** Обход — BLE / радиоволны. */
export function TabPatrolIcon({ active, size = 24 }: IconProps) {
  return (
    <NeonWrap active={active} size={size}>
      {({ primary, glow, blue }) => (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={14} r={2.2} fill={primary} />
          <Path
            d="M8.5 11.5a5.5 5.5 0 0 1 7 0"
            stroke={glow}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          <Path
            d="M6 9a9 9 0 0 1 12 0"
            stroke={primary}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          <Path
            d="M3.5 6.5a13 13 0 0 1 17 0"
            stroke={blue}
            strokeWidth={1.4}
            strokeLinecap="round"
            opacity={active ? 1 : 0.65}
          />
          <Rect x={10.5} y={2} width={3} height={2.5} rx={0.8} fill={glow} opacity={active ? 1 : 0.5} />
        </Svg>
      )}
    </NeonWrap>
  );
}

/** Поиск — лупа. */
export function TabSearchIcon({ active, size = 24 }: IconProps) {
  return (
    <NeonWrap active={active} size={size}>
      {({ primary, glow, blue }) => (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx={10.5} cy={10.5} r={5.5} stroke={primary} strokeWidth={1.7} />
          <Circle cx={10.5} cy={10.5} r={3.2} stroke={glow} strokeWidth={0.9} opacity={0.75} />
          <Path
            d="M15 15 20 20"
            stroke={blue}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
      )}
    </NeonWrap>
  );
}
