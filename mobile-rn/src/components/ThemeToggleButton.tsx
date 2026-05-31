import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "../context/ThemeContext";

export function ThemeToggleButton() {
  const { colors, isDark, toggleTheme } = useTheme();
  const pulse = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (!isDark) {
      pulse.setValue(0.85);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isDark, pulse]);

  const borderColor = pulse.interpolate({
    inputRange: [0.4, 1],
    outputRange: [colors.neonDim, colors.neon],
  });

  return (
    <Pressable
      onPress={toggleTheme}
      style={styles.hit}
      accessibilityRole="button"
      accessibilityLabel={isDark ? "Светлая тема" : "Тёмная тема"}
    >
      <Animated.View
        style={[
          styles.btn,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor,
            shadowColor: isDark ? colors.neon : colors.accent,
          },
        ]}
      >
        <Text style={[styles.glyph, { color: isDark ? colors.neon : colors.accent }]}>
          {isDark ? "☀" : "☾"}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 8,
    elevation: 4,
  },
  glyph: {
    fontSize: 18,
    fontWeight: "700",
  },
});
