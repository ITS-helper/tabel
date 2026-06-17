import { useMemo } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BleRoute, BleTagMarker } from "../ble/types";
import { routeProgressFor } from "../field/fieldHelpers";
import { useTheme } from "../context/ThemeContext";
import type { AppColors } from "../theme/palettes";

type Props = {
  visible: boolean;
  routes: BleRoute[];
  markers: BleTagMarker[];
  todayPatrol: Record<string, string[]>;
  routeResetMap: Record<string, boolean>;
  selectedId: string;
  onSelect: (id: string, title: string) => void;
  onClose: () => void;
};

export function RoutePickerModal({
  visible,
  routes,
  markers,
  todayPatrol,
  routeResetMap,
  selectedId,
  onSelect,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const items = useMemo(
    () => [{ id: 0, title: "Все маршруты" }, ...routes],
    [routes],
  );
  const allProgress = useMemo(
    () => routeProgressFor(markers, todayPatrol, "", routeResetMap),
    [markers, todayPatrol, routeResetMap],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Маршрут</Text>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        >
          {items.map((r) => {
            const id = r.id ? String(r.id) : "";
            const active = id === selectedId;
            const progress = id
              ? routeProgressFor(markers, todayPatrol, id, routeResetMap)
              : allProgress;
            const progressLabel =
              progress.total > 0 ? `${progress.done}/${progress.total}` : "—";
            const complete = progress.total > 0 && progress.done >= progress.total;

            return (
              <Pressable
                key={id || "all"}
                style={[styles.item, active && styles.itemActive]}
                onPress={() => {
                  onSelect(id, r.title);
                  onClose();
                }}
              >
                <Text
                  style={[styles.itemText, active && styles.itemTextActive]}
                  numberOfLines={2}
                >
                  {r.title}
                </Text>
                <Text
                  style={[
                    styles.progress,
                    active && styles.progressActive,
                    complete && styles.progressDone,
                  ]}
                >
                  {progressLabel}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const createStyles = (colors: AppColors) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { color: colors.text, fontSize: 20, fontWeight: "700" },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    closeText: { color: colors.textMuted, fontSize: 18, lineHeight: 20 },
    list: { flex: 1 },
    listContent: { padding: 12, paddingBottom: 24 },
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: 12,
      marginBottom: 8,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    itemActive: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.neon,
    },
    itemText: { flex: 1, color: colors.text, fontSize: 16 },
    itemTextActive: { color: colors.neon, fontWeight: "600" },
    progress: {
      minWidth: 52,
      textAlign: "right",
      color: colors.textMuted,
      fontSize: 15,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
    },
    progressActive: { color: colors.neon },
    progressDone: { color: colors.success },
  });
