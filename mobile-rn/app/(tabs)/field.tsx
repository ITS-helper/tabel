import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { uploadCheckins } from "../../src/api/checkinsUpload";
import { BleService } from "../../src/ble/BleService";
import type { BleTagMarker, ScannedDevice } from "../../src/ble/types";
import { normalizeBle } from "../../src/ble/wwAdvert";
import { useAppData } from "../../src/context/AppDataContext";
import { LOW_BATTERY_PCT } from "../../src/config";
import {
  getDailyDoneSet,
  loadStore,
  markCheckinsUploaded,
  saveCheckinRecord,
} from "../../src/storage/checkins";
import { colors } from "../../src/theme/colors";

type NearbyRow = {
  tag: BleTagMarker;
  dev: ScannedDevice;
  done: boolean;
};

export default function FieldScreen() {
  const {
    route,
    routeMarkers,
    routeProgress,
    findTag,
    focusBle,
    setFocusBle,
    pendingUploads,
    refreshPending,
  } = useAppData();

  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [busyBle, setBusyBle] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [patrolQuery, setPatrolQuery] = useState("");
  const [tagPatrolMode, setTagPatrolMode] = useState(false);
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [dailyDone, setDailyDone] = useState<Set<string>>(new Set());
  const autoConnectRef = useRef(false);

  const refreshDaily = useCallback(async () => {
    const store = await loadStore();
    setDailyDone(getDailyDoneSet(store, route.routeId));
    await refreshPending();
  }, [route.routeId, refreshPending]);

  useEffect(() => {
    BleService.onScanUpdate(setDevices);
    refreshDaily();
    return () => {
      BleService.onScanUpdate(null);
      void BleService.stopScan();
    };
  }, [refreshDaily]);

  useEffect(() => {
    if (focusBle) {
      setTagPatrolMode(true);
      setPatrolQuery(focusBle);
    }
  }, [focusBle]);

  const scopeMarkers = routeMarkers;

  const nearbyRows = useMemo((): NearbyRow[] => {
    const rows: NearbyRow[] = [];
    const seen = new Set<string>();
    for (const dev of devices) {
      if (!dev.isWw && !dev.bleFromAdv) continue;
      for (const tag of scopeMarkers) {
        const match =
          BleService.findDeviceForTag(tag)?.id === dev.id ||
          normalizeBle(tag.ble) === normalizeBle(dev.bleFromAdv);
        if (!match) continue;
        const key = normalizeBle(tag.ble);
        if (seen.has(key)) continue;
        seen.add(key);
        const done = dailyDone.has(key) || !!tag.isInspected;
        if (done && !tagPatrolMode) continue;
        rows.push({ tag, dev, done });
        break;
      }
    }
    return rows.sort((a, b) => (b.dev.rssi ?? -999) - (a.dev.rssi ?? -999));
  }, [devices, scopeMarkers, dailyDone, tagPatrolMode]);

  const focusTag = focusBle ? findTag(focusBle) : null;

  useEffect(() => {
    if (!tagPatrolMode || !focusTag || connectedId || autoConnectRef.current) return;
    const dev = BleService.findDeviceForTag(focusTag);
    if (!dev || !scanning) return;
    autoConnectRef.current = true;
    void (async () => {
      try {
        setStatus(`Подключение к #${focusTag.ble}…`);
        await BleService.connectToTag(dev.id);
        setConnectedId(dev.id);
        setStatus(`Метка #${focusTag.ble} подключена — нажмите «Сохранить»`);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Ошибка подключения");
        autoConnectRef.current = false;
      }
    })();
  }, [tagPatrolMode, focusTag, connectedId, scanning, devices]);

  const toggleScan = async () => {
    try {
      if (scanning) {
        await BleService.pauseScanKeepList();
        setScanning(false);
        setPaused(true);
        setStatus("Список заморожен");
      } else if (paused) {
        setPaused(false);
        autoConnectRef.current = false;
        await BleService.startScan();
        setScanning(true);
        setStatus("Сканирование…");
      } else {
        autoConnectRef.current = false;
        setConnectedId(null);
        await BleService.startScan();
        setScanning(true);
        setStatus(
          route.routeId
            ? `Маршрут «${route.routeTitle}»`
            : "Все маршруты",
        );
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "BLE ошибка");
    }
  };

  const saveCheckin = async (tag: BleTagMarker, dev: ScannedDevice) => {
    if (busyBle) return;
    setBusyBle(tag.ble);
    setStatus(`GATT #${tag.ble}…`);
    try {
      const live = await BleService.withGattSession(dev.id, () =>
        BleService.readTagGattTelemetry(dev.id, {
          rssi: dev.rssi,
          advTelemetry: dev.advTelemetry,
        }),
      );
      if (!live.fromGatt) {
        setStatus(`GATT: данных нет (#${tag.ble})`);
        return;
      }
      await saveCheckinRecord(tag, { deviceId: dev.id, rssi: dev.rssi }, live, route);
      const charge = live.chargeValue ?? 100;
      if (charge <= LOW_BATTERY_PCT) {
        setStatus(`#${tag.ble} сохранён · батарейки ${charge}%`);
      } else {
        setStatus(`#${tag.ble} сохранён (${charge}%)`);
      }
      if (tagPatrolMode) {
        setTagPatrolMode(false);
        setFocusBle(null);
        setConnectedId(null);
        autoConnectRef.current = false;
        await BleService.stopScan();
        setScanning(false);
      }
      await refreshDaily();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка GATT");
    } finally {
      setBusyBle(null);
    }
  };

  const saveFocus = async () => {
    if (!focusTag || !connectedId) return;
    const dev =
      devices.find((d) => d.id === connectedId) ??
      ({ id: connectedId, rssi: null, lastSeen: Date.now(), bleFromAdv: focusTag.ble, isWw: true, name: null } as ScannedDevice);
    await saveCheckin(focusTag, dev);
  };

  const startPatrolSearch = () => {
    const ble = normalizeBle(patrolQuery);
    if (!ble) return;
    const tag = findTag(ble);
    if (!tag) {
      setStatus(`Метка #${ble} не в базе`);
      return;
    }
    setFocusBle(ble);
    setTagPatrolMode(true);
    autoConnectRef.current = false;
    setConnectedId(null);
    setStatus(`Обход метки #${ble}`);
    if (!scanning) void toggleScan();
  };

  const uploadAll = async () => {
    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      setStatus("Нужен интернет");
      return;
    }
    const store = await loadStore();
    const pending = store.checkins.filter((c) => !c.uploaded);
    if (!pending.length) {
      setStatus("Нет обходов для отправки");
      return;
    }
    setStatus(`Отправка ${pending.length}…`);
    const result = await uploadCheckins(pending, (ble) => findTag(ble));
    if (result.uploaded.length) await markCheckinsUploaded(result.uploaded);
    await refreshDaily();
    if (result.fail && result.ok) {
      setStatus(`Отправлено ${result.ok}, ошибок ${result.fail}`);
    } else if (result.fail) {
      setStatus(`Ошибка: ${result.lastErr.slice(0, 120)}`);
    } else {
      setStatus(`Отправлено ${result.ok}`);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.route}>{route.routeTitle}</Text>
        <Text style={styles.progress}>
          {routeProgress.done}/{routeProgress.total} · очередь {pendingUploads}
        </Text>
        <View style={styles.btnRow}>
          <Pressable
            style={[styles.primaryBtn, scanning && !paused && styles.stopBtn]}
            onPress={toggleScan}
          >
            <Text style={styles.primaryBtnText}>
              {scanning ? "Стоп" : paused ? "Продолжить" : "Сканировать"}
            </Text>
          </Pressable>
          <Pressable style={styles.uploadBtn} onPress={uploadAll}>
            <Text style={styles.uploadBtnText}>Отправить</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.patrolRow}>
        <TextInput
          style={styles.patrolInput}
          placeholder="№ метки для обхода"
          placeholderTextColor={colors.textMuted}
          value={patrolQuery}
          onChangeText={setPatrolQuery}
          keyboardType="number-pad"
        />
        <Pressable style={styles.patrolGo} onPress={startPatrolSearch}>
          <Text style={styles.patrolGoText}>→</Text>
        </Pressable>
      </View>

      {tagPatrolMode && focusTag ? (
        <View style={styles.focusBox}>
          <Text style={styles.focusTitle}>Метка #{focusTag.ble}</Text>
          <Text style={styles.focusSub}>
            {connectedId ? "Подключено" : "Ищем по BLE…"}
          </Text>
          <Pressable
            style={[styles.saveBtn, !connectedId && styles.saveBtnDisabled]}
            onPress={saveFocus}
            disabled={!connectedId || !!busyBle}
          >
            {busyBle ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>Сохранить обход</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => {
              setTagPatrolMode(false);
              setFocusBle(null);
              setConnectedId(null);
              autoConnectRef.current = false;
            }}
          >
            <Text style={styles.cancel}>Отмена</Text>
          </Pressable>
        </View>
      ) : null}

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <FlatList
        data={nearbyRows}
        keyExtractor={(item) => normalizeBle(item.tag.ble)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {scanning
              ? "Поднесите телефон к метке…"
              : "Нажмите «Сканировать»"}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, item.done && styles.rowDone]}
            onPress={() => saveCheckin(item.tag, item.dev)}
            disabled={!!busyBle}
          >
            <View style={styles.rowMain}>
              <Text style={styles.ble}>BLE {item.tag.ble}</Text>
              <Text style={styles.sub}>
                RSSI {item.dev.rssi ?? "?"} · {item.tag.routeTitle || "—"}
              </Text>
            </View>
            {busyBle === item.tag.ble ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.action}>{item.done ? "✓" : "GATT"}</Text>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    padding: 14,
    gap: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  route: { color: colors.text, fontWeight: "700", fontSize: 16 },
  progress: { color: colors.textMuted, fontSize: 13 },
  btnRow: { flexDirection: "row", gap: 8 },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  stopBtn: { backgroundColor: colors.danger },
  primaryBtnText: { color: "#fff", fontWeight: "700" },
  uploadBtn: {
    paddingHorizontal: 16,
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  uploadBtnText: { color: colors.accent, fontWeight: "700" },
  patrolRow: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    paddingBottom: 0,
  },
  patrolInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  patrolGo: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
  },
  patrolGoText: { color: colors.accent, fontSize: 20, fontWeight: "700" },
  focusBox: {
    margin: 12,
    padding: 14,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    gap: 8,
  },
  focusTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  focusSub: { color: colors.textMuted },
  saveBtn: {
    backgroundColor: colors.success,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: { color: "#fff", fontWeight: "700" },
  cancel: { color: colors.textMuted, textAlign: "center", marginTop: 4 },
  status: { color: colors.warning, paddingHorizontal: 14, paddingVertical: 6, fontSize: 13 },
  list: { padding: 12 },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: 40 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowDone: { opacity: 0.55 },
  rowMain: { flex: 1 },
  ble: { color: colors.text, fontSize: 16, fontWeight: "600" },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  action: { color: colors.accent, fontWeight: "700" },
});
