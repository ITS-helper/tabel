import { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { BleRoute } from "../ble/types";
import { useTheme } from "../context/ThemeContext";
import type { AppColors } from "../theme/palettes";

type Props = {
  visible: boolean;
  routes: BleRoute[];
  selectedId: string;
  onSelect: (id: string, title: string) => void;
  onClose: () => void;
};

export function RoutePickerModal({
  visible,
  routes,
  selectedId,
  onSelect,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const items = useMemo(
    () => [{ id: 0, title: "Все маршруты" }, ...routes],
    [routes],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Маршрут</Text>
          <ScrollView style={styles.list}>
            {items.map((r) => {
              const id = r.id ? String(r.id) : "";
              const active = id === selectedId;
              return (
                <Pressable
                  key={id || "all"}
                  style={[styles.item, active && styles.itemActive]}
                  onPress={() => {
                    onSelect(id, r.title);
                    onClose();
                  }}
                >
                  <Text style={[styles.itemText, active && styles.itemTextActive]}>
                    {r.title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (colors: AppColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      justifyContent: "flex-end",
    },
    sheet: {
      maxHeight: "60%",
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 16,
      borderTopWidth: 2,
      borderColor: colors.neon,
    },
    title: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 12 },
    list: { maxHeight: 360 },
    item: {
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 10,
      marginBottom: 6,
      backgroundColor: colors.surfaceAlt,
    },
    itemActive: {
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.neon,
    },
    itemText: { color: colors.text, fontSize: 15 },
    itemTextActive: { color: colors.neon, fontWeight: "600" },
  });
