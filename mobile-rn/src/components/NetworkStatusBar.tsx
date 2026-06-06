import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNetworkStatus } from "../context/NetworkStatusContext";
import { useTheme } from "../context/ThemeContext";
import type { AppColors } from "../theme/palettes";

const ONLINE = "#22c55e";
const OFFLINE = "#ef4444";

/** Тонкая полоска под системным статус-баром: зелёная — онлайн, красная — офлайн. */
export function NetworkTopLine() {
  const insets = useSafeAreaInsets();
  const { status, online } = useNetworkStatus();
  const { colors } = useTheme();

  const color =
    status === "checking" ? colors.warning : online ? ONLINE : OFFLINE;

  return (
    <View
      pointerEvents="none"
      style={[styles.line, { top: insets.top, backgroundColor: color }]}
    />
  );
}

/** Компактный индикатор для таб-бара. */
export function NetworkTabIndicator() {
  const { status, online, label } = useNetworkStatus();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const dotColor =
    status === "checking" ? colors.warning : online ? ONLINE : OFFLINE;

  return (
    <View
      style={styles.wrap}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[styles.label, !online && status !== "checking" && styles.labelOff]}>
        {label}
      </Text>
    </View>
  );
}

const createStyles = (colors: AppColors) =>
  StyleSheet.create({
    wrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 6,
      marginRight: 4,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    label: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: "600",
    },
    labelOff: {
      color: OFFLINE,
    },
  });

const styles = StyleSheet.create({
  line: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    zIndex: 9999,
  },
});
