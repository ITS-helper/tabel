import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import { TabMapIcon, TabPatrolIcon, TabSearchIcon } from "./TabIcons";
import { ThemeToggleButton } from "./ThemeToggleButton";
import { NetworkTabIndicator } from "./NetworkStatusBar";

const TAB_ICONS = [TabMapIcon, TabPatrolIcon, TabSearchIcon] as const;

type CyberTabBarProps = {
  state: {
    index: number;
    routes: { key: string; name: string }[];
  };
  navigation: {
    navigate: (name: string) => void;
  };
};

export function CyberTabBar({ state, navigation }: CyberTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    if (!isDark) {
      pulse.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isDark, pulse]);

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.tabBar,
          paddingBottom: Math.max(insets.bottom, 6),
          borderTopColor: colors.tabBarBorder,
        },
      ]}
    >
      {isDark ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glowLine,
            {
              backgroundColor: colors.neon,
              opacity: pulse,
              shadowColor: colors.neon,
            },
          ]}
        />
      ) : (
        <View
          pointerEvents="none"
          style={[styles.glowLine, { backgroundColor: colors.tabBarBorder, opacity: 1 }]}
        />
      )}
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const Icon = TAB_ICONS[index] ?? TabMapIcon;
          return (
            <Pressable
              key={route.key}
              style={styles.tab}
              onPress={() => navigation.navigate(route.name)}
              accessibilityRole="button"
            >
              <View
                style={[
                  styles.iconSlot,
                  focused && {
                    backgroundColor: colors.accentSoft,
                    borderColor: focused ? colors.neon : "transparent",
                  },
                ]}
              >
                <Icon active={focused} size={26} />
              </View>
            </Pressable>
          );
        })}
        <NetworkTabIndicator />
        <ThemeToggleButton />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
  },
  glowLine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  tab: {
    flex: 1,
    alignItems: "center",
  },
  iconSlot: {
    width: 48,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
});
