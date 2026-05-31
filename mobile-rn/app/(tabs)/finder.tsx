import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BleService } from "../../src/ble/BleService";
import type { ScannedDevice } from "../../src/ble/types";
import { normalizeBle } from "../../src/ble/wwAdvert";
import { FOUND_SOUND_COOLDOWN_MS } from "../../src/config";
import { useTheme } from "../../src/context/ThemeContext";
import type { AppColors } from "../../src/theme/palettes";

type Target = { ble: string; foundAt?: number };

function matchWatchTarget(dev: ScannedDevice, key: string): boolean {
  const name = String(dev.name ?? "").toLowerCase();
  const id = String(dev.id ?? "").toLowerCase();
  const idCompact = id.replace(/[^a-f0-9]/g, "");
  const keyCompact = key.replace(/[^a-f0-9]/g, "");
  if (name && name.includes(key)) return true;
  if (keyCompact.length >= 4 && idCompact.includes(keyCompact)) return true;
  return id.includes(key);
}

function matchTagTarget(dev: ScannedDevice, key: string): boolean {
  if (normalizeBle(dev.bleFromAdv) === normalizeBle(key)) return true;
  const mac = dev.id.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  return mac.includes(key.toUpperCase());
}

export default function FinderScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [input, setInput] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [tab, setTab] = useState<"tags" | "watch">("tags");
  const [status, setStatus] = useState<string | null>(null);
  const lastAlertRef = useRef<Map<string, number>>(new Map());

  const playFound = useCallback(() => {
    Vibration.vibrate(120);
  }, []);

  useEffect(() => {
    BleService.onScanUpdate(setDevices);
    return () => {
      BleService.onScanUpdate(null);
      if (scanning) void BleService.stopScan();
    };
  }, [scanning]);

  const foundMap = useMemo(() => {
    const map = new Map<string, ScannedDevice>();
    for (const t of targets) {
      for (const d of devices) {
        const ok =
          tab === "watch"
            ? matchWatchTarget(d, t.ble)
            : matchTagTarget(d, t.ble);
        if (ok) {
          map.set(t.ble, d);
          break;
        }
      }
    }
    return map;
  }, [devices, targets, tab]);

  useEffect(() => {
    if (!scanning || targets.length === 0) return;
    const now = Date.now();
    let changed = false;
    const next = targets.map((t) => {
      const dev = foundMap.get(t.ble);
      if (!dev) return t;
      const prevAlert = lastAlertRef.current.get(t.ble) ?? 0;
      const firstFound = t.foundAt == null;
      const cooldownOk = now - prevAlert >= FOUND_SOUND_COOLDOWN_MS;
      if (firstFound || cooldownOk) {
        changed = true;
        lastAlertRef.current.set(t.ble, now);
        playFound();
        return { ...t, foundAt: t.foundAt ?? now };
      }
      return t;
    });
    if (changed) setTargets(next);
  }, [foundMap, scanning, targets, playFound]);

  const startScan = async () => {
    const list = input
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((ble) => ({
        ble: tab === "watch" ? ble.toLowerCase() : normalizeBle(ble),
      }));
    if (list.length === 0) return;
    lastAlertRef.current = new Map();
    setTargets(list);
    BleService.setFinderWatchMode(tab === "watch");
    BleService.setFinderTargets(list.map((t) => t.ble));
    await BleService.stopScan();
    try {
      await BleService.startScan("finder");
      setScanning(true);
      setStatus("Сканирование…");
    } catch (e) {
      setScanning(false);
      setStatus(e instanceof Error ? e.message : "BLE ошибка");
    }
  };

  const stopScan = async () => {
    await BleService.stopScan();
    setScanning(false);
    setStatus(null);
  };

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

      <TextInput
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

      <Pressable
        style={[styles.scanBtn, scanning && styles.scanBtnStop]}
        onPress={scanning ? stopScan : startScan}
      >
        <Text style={styles.scanBtnText}>
          {scanning ? "Остановить" : "Сканировать"}
        </Text>
      </Pressable>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <FlatList
        data={targets}
        keyExtractor={(item) => item.ble}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.hint}>
            Введите номера и нажмите «Сканировать»
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
                    ? "Поиск…"
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
