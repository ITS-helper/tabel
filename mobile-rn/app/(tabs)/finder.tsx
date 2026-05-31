import { Audio } from "expo-av";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BleService } from "../../src/ble/BleService";
import type { ScannedDevice } from "../../src/ble/types";
import { normalizeBle } from "../../src/ble/wwAdvert";
import { FOUND_SOUND_COOLDOWN_MS } from "../../src/config";
import { colors } from "../../src/theme/colors";

type Target = { ble: string; foundAt?: number };

function parseTargets(raw: string): Target[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => normalizeBle(s))
    .filter(Boolean)
    .map((ble) => ({ ble }));
}

export default function FinderScreen() {
  const [input, setInput] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [tab, setTab] = useState<"tags" | "watch">("tags");
  const soundRef = useRef<Audio.Sound | null>(null);
  const lastAlertRef = useRef<Map<string, number>>(new Map());

  const loadSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await Audio.Sound.createAsync(
        require("../../assets/sounds/technologia-found.mp3"),
      );
      soundRef.current = sound;
    } catch {
      /* звук опционален на первом этапе */
    }
  }, []);

  useEffect(() => {
    loadSound();
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, [loadSound]);

  useEffect(() => {
    BleService.onScanUpdate(setDevices);
    return () => BleService.onScanUpdate(null);
  }, []);

  const foundMap = useMemo(() => {
    const map = new Map<string, ScannedDevice>();
    for (const d of devices) {
      const ble = normalizeBle(d.bleFromAdv);
      if (ble) map.set(ble, d);
    }
    return map;
  }, [devices]);

  const playFound = useCallback(async () => {
    try {
      await soundRef.current?.replayAsync();
    } catch {
      /* ignore */
    }
  }, []);

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
    const list = parseTargets(input);
    if (list.length === 0) return;
    lastAlertRef.current = new Map();
    setTargets(list);
    BleService.suspendScan();
    try {
      await BleService.startScan();
      setScanning(true);
    } catch {
      setScanning(false);
    }
  };

  const stopScan = async () => {
    await BleService.stopScan();
    setScanning(false);
    await BleService.resumeScan();
  };

  return (
    <View style={styles.root}>
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
            : "Номера часов через пробел"
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
              <Text style={styles.ble}>BLE {item.ble}</Text>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 16 },
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
  tabActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
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
  },
  scanBtnStop: { backgroundColor: colors.danger },
  scanBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
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
