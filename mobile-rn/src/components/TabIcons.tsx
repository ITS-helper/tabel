import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Image } from "react-native";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";
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

/** Карта — глобус. */
export function TabMapIcon({ active, size = 24 }: IconProps) {
  return (
    <NeonWrap active={active} size={size}>
      {({ primary, glow, blue }) => (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={12} r={8.5} stroke={primary} strokeWidth={1.6} />
          <Ellipse cx={12} cy={12} rx={3.8} ry={8.5} stroke={glow} strokeWidth={1.3} />
          <Path d="M3.5 12h17" stroke={glow} strokeWidth={1.2} strokeLinecap="round" />
          <Path
            d="M5.2 8.2c1.8 1 3.8 1.5 6.8 1.5s5-0.5 6.8-1.5"
            stroke={blue}
            strokeWidth={1.1}
            strokeLinecap="round"
            opacity={active ? 0.9 : 0.65}
          />
          <Path
            d="M5.2 15.8c1.8-1 3.8-1.5 6.8-1.5s5 0.5 6.8 1.5"
            stroke={blue}
            strokeWidth={1.1}
            strokeLinecap="round"
            opacity={active ? 0.9 : 0.65}
          />
        </Svg>
      )}
    </NeonWrap>
  );
}

const TAB_PATROL_BOOT = require("../../assets/tab-patrol-boot.png");

/** Обход — иконка ботинка (PNG с прозрачным фоном, tint как у остальных вкладок). */
export function TabPatrolIcon({ active, size = 24 }: IconProps) {
  return (
    <NeonWrap active={active} size={size}>
      {({ primary }) => (
        <Image
          source={TAB_PATROL_BOOT}
          resizeMode="contain"
          accessibilityLabel="Обход"
          style={{
            width: size,
            height: size,
            tintColor: primary,
          }}
        />
      )}
    </NeonWrap>
  );
}

/** Поиск — лупа с перекрестием внутри. */
export function TabSearchIcon({ active, size = 24 }: IconProps) {
  return (
    <NeonWrap active={active} size={size}>
      {({ primary, glow, blue }) => (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx={10.2} cy={10.2} r={6.2} stroke={primary} strokeWidth={1.7} />
          <Path d="M9.2 10.2h2" stroke={glow} strokeWidth={1.4} strokeLinecap="round" />
          <Path d="M10.2 9.2v2" stroke={glow} strokeWidth={1.4} strokeLinecap="round" />
          <Circle cx={10.2} cy={10.2} r={2.1} stroke={blue} strokeWidth={1.1} opacity={active ? 0.85 : 0.55} />
          <Path
            d="M14.8 14.8 20.5 20.5"
            stroke={primary}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <Path
            d="M17.2 17.2 19.8 19.8"
            stroke={glow}
            strokeWidth={1.1}
            strokeLinecap="round"
            opacity={0.7}
          />
        </Svg>
      )}
    </NeonWrap>
  );
}
