import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { usePassScan } from "../context/PassContext";
import { useTheme } from "../context/ThemeContext";

export function PassScanButton() {
  const { colors } = useTheme();
  const { passScan, passBusy, requestPassScan } = usePassScan();
  const ready = !!passScan?.uid;

  return (
    <Pressable
      onPress={() => void requestPassScan(true)}
      style={[
        styles.hit,
        {
          backgroundColor: ready ? colors.success : colors.surfaceAlt,
          borderColor: ready ? colors.success : colors.warning,
          shadowColor: ready ? colors.success : colors.warning,
        },
        passBusy && styles.off,
      ]}
      accessibilityRole="button"
      accessibilityLabel={ready ? "Сменить пропуск" : "Сканировать пропуск"}
      disabled={passBusy}
    >
      {passBusy ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <Text style={styles.label}>{ready ? "ID" : "NFC"}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  off: {
    opacity: 0.7,
  },
  label: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});
