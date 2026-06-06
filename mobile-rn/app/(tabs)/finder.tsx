import { useMemo } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SearchField } from "../../src/components/SearchField";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFinder } from "../../src/context/FinderContext";
import { useTheme } from "../../src/context/ThemeContext";
import type { AppColors } from "../../src/theme/palettes";

export default function FinderScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    input,
    setInput,
    tab,
    setTab,
    targets,
    scanning,
    pausedByField,
    foundMap,
    status,
    startFinder,
    stopFinder,
  } = useFinder();

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <View style={styles.tabs}>
        {(["tags", "watch"] as const).map((id) => (
          <Pressable
            key={id}
            style={[styles.tab, tab === id && styles.tabActive]}
            onPress={() => setTab(id)}
          >
            <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>
              {id === "tags" ? "Метки" : "Часы"}
            </Text>
          </Pressable>
        ))}
      </View>

      <SearchField
        style={styles.input}
        placeholder={
          tab === "tags"
            ? "Номера меток через пробел"
            : "MAC или имя часов"
        }
        placeholderTextColor={colors.textMuted}
        value={input}
        onChangeText={setInput}
        multiline
      />

      <Text style={styles.bgHint}>
        Поиск работает в фоне: можно перейти на карту или обход. При «Отметить» и
        подключении к метке поиск ставится на паузу. Не закрывайте приложение из
        списка задач.
      </Text>

      <Pressable
        style={[styles.scanBtn, scanning && styles.scanBtnStop]}
        onPress={scanning ? stopFinder : startFinder}
      >
        <Text style={styles.scanBtnText}>
          {scanning ? "Остановить поиск" : "Искать в фоне"}
        </Text>
      </Pressable>

      {status ? <Text style={styles.status}>{status}</Text> : null}
      {scanning && pausedByField ? (
        <Text style={styles.paused}>Пауза — идёт обход / подключение к метке</Text>
      ) : null}

      <FlatList
        data={targets}
        keyExtractor={(item) => item.ble}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.hint}>
            Введите номера и нажмите «Искать в фоне»
          </Text>
        }
        renderItem={({ item }) => {
          const found = item.foundAt != null;
          const dev = foundMap.get(item.ble);
          return (
            <View style={[styles.row, found && styles.rowFound]}>
              <Text style={styles.ble}>
                {tab === "tags" ? `BLE ${item.ble}` : item.ble}
              </Text>
              <Text style={styles.state}>
                {found
                  ? `Найдено · RSSI ${dev?.rssi ?? "?"}`
                  : scanning
                    ? pausedByField
                      ? "Пауза (обход)…"
                      : "Поиск…"
                    : "—"}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const createStyles = (colors: AppColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16, paddingBottom: 16 },
    tabs: { flexDirection: "row", gap: 8, marginBottom: 12 },
    tab: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.surface,
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    tabActive: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.neon,
      shadowColor: colors.neon,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.45,
      shadowRadius: 6,
    },
    tabText: { color: colors.textMuted, fontWeight: "600" },
    tabTextActive: { color: colors.accent },
    input: {
      minHeight: 80,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      textAlignVertical: "top",
    },
    bgHint: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 10,
    },
    scanBtn: {
      marginTop: 12,
      backgroundColor: colors.accent,
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.neon,
    },
    scanBtnStop: { backgroundColor: colors.danger },
    scanBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
    status: { color: colors.warning, marginTop: 8, fontSize: 13 },
    paused: { color: colors.accent, marginTop: 6, fontSize: 13, fontWeight: "600" },
    list: { paddingTop: 16, gap: 8 },
    hint: { color: colors.textMuted, textAlign: "center", marginTop: 24 },
    row: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 14,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowFound: {
      borderColor: colors.success,
      backgroundColor: "rgba(34,197,94,0.12)",
    },
    ble: { color: colors.text, fontSize: 16, fontWeight: "600" },
    state: { color: colors.textMuted, marginTop: 4, fontSize: 13 },
  });
