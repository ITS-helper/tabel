import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uploadCheckins } from "../../src/api/checkinsUpload";
import { BleService } from "../../src/ble/BleService";
import type { BleTagMarker, FieldCheckin, ScannedDevice } from "../../src/ble/types";
import { normalizeBle } from "../../src/ble/wwAdvert";
import { useAppData } from "../../src/context/AppDataContext";
import {
  buildNearbyRows,
  countLiveDevices,
  zoneShortLabel,
} from "../../src/field/fieldHelpers";
import { LOW_BATTERY_PCT } from "../../src/config";
import {
  getDailyDoneSet,
  getPendingCheckins,
  loadStore,
  markCheckinsUploaded,
  saveCheckinRecord,
} from "../../src/storage/checkins";
import { useTheme } from "../../src/context/ThemeContext";
import type { AppColors } from "../../src/theme/palettes";

export default function FieldScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
  const [scanActive, setScanActive] = useState(false);
  const [scanPaused, setScanPaused] = useState(false);
  const [busyBle, setBusyBle] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [patrolQuery, setPatrolQuery] = useState("");
  const [tagPatrolMode, setTagPatrolMode] = useState(false);
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [gattBusy, setGattBusy] = useState(false);
  const [dailyDone, setDailyDone] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<FieldCheckin[]>([]);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const autoConnectRef = useRef(false);

  const refreshDaily = useCallback(async () => {
    const store = await loadStore();
    setDailyDone(getDailyDoneSet(store, route.routeId));
    setPending(await getPendingCheckins());
    await refreshPending();
  }, [route.routeId, refreshPending]);

  const focusHandledRef = useRef<string | null>(null);

  const openTagPatrol = useCallback(
    async (ble: string, fromSearch = false) => {
      const tag = findTag(ble);
      if (!tag) {
        setStatus(`Метка #${ble} не в базе`);
        return;
      }
      if (route.routeId && String(tag.routeId ?? "") !== String(route.routeId)) {
        setStatus(`Метка #${ble} на другом маршруте: «${tag.routeTitle ?? "—"}»`);
        return;
      }
      await BleService.disconnect();
      setTagPatrolMode(true);
      if (fromSearch) setFocusBle(ble);
      setPatrolQuery(ble);
      setConnectedId(null);
      autoConnectRef.current = false;
      setStatus(`Метка #${ble}. Идёт сканирование…`);
      try {
        if (!BleService.isScanning()) {
          await BleService.beginScanOnly(true);
          setScanActive(true);
          setScanPaused(false);
        }
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "BLE ошибка");
      }
    },
    [findTag, route.routeId, setFocusBle],
  );

  useEffect(() => {
    BleService.onScanUpdate(setDevices);
    refreshDaily();
    void NetInfo.fetch().then((s) => setOnline(!!s.isConnected));
    const sub = NetInfo.addEventListener((s) => setOnline(!!s.isConnected));
    if (!focusBle) {
      setStatus(
        route.routeId
          ? `Маршрут «${route.routeTitle}». Нажмите «Сканировать».`
          : "Все маршруты. Нажмите «Сканировать».",
      );
    }
    return () => {
      BleService.onScanUpdate(null);
      void BleService.stopScan(true);
      sub();
    };
  }, [refreshDaily, route.routeId, route.routeTitle, focusBle]);

  useEffect(() => {
    if (!focusBle) {
      focusHandledRef.current = null;
      return;
    }
    if (focusHandledRef.current === focusBle) return;
    focusHandledRef.current = focusBle;
    void openTagPatrol(focusBle, false);
  }, [focusBle, openTagPatrol]);

  const focusTag = focusBle ? findTag(focusBle) : null;

  const nearbyRows = useMemo(
    () =>
      buildNearbyRows(devices, routeMarkers, {
        scanPaused,
        tagPatrolMode,
        dailyDone,
        findTag,
      }),
    [devices, routeMarkers, scanPaused, tagPatrolMode, dailyDone, findTag],
  );

  const liveCount = useMemo(
    () => countLiveDevices(devices, scanPaused),
    [devices, scanPaused],
  );

  const scanBtnLabel = scanActive ? "Пауза" : scanPaused ? "Продолжить" : "Сканировать";

  const onSearchSubmit = () => {
    const ble = normalizeBle(patrolQuery);
    if (!ble) return;
    void openTagPatrol(ble, true);
  };

  const toggleScan = async () => {
    try {
      if (scanActive) {
        await BleService.pauseScan();
        setScanActive(false);
        setScanPaused(true);
        setStatus(`Пауза — ${nearbyRows.length} меток в списке`);
        return;
      }
      if (scanPaused) {
        await BleService.beginScanOnly(false);
        setScanActive(true);
        setScanPaused(false);
        setStatus(
          tagPatrolMode && focusBle
            ? `Сканирование метки #${focusBle}…`
            : route.routeId
              ? `Сканирование «${route.routeTitle}»…`
              : "Сканирование всех меток…",
        );
        return;
      }
      await BleService.beginScanOnly(true);
      setScanActive(true);
      setScanPaused(false);
      setStatus("Сканирование…");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "BLE ошибка");
    }
  };

  const tryAutoConnect = useCallback(
    async (dev: ScannedDevice, tag: BleTagMarker) => {
      if (!tagPatrolMode || connecting || connectedId || autoConnectRef.current) return;
      if (normalizeBle(tag.ble) !== normalizeBle(focusBle ?? "")) return;
      autoConnectRef.current = true;
      setConnecting(true);
      setStatus(`Подключение к метке #${tag.ble}…`);
      try {
        await BleService.connectToTag(dev.id);
        setConnectedId(dev.id);
        setStatus(`Метка #${tag.ble} подключена. Нажмите «Отправить обход».`);
      } catch (e) {
        autoConnectRef.current = false;
        setStatus(e instanceof Error ? e.message : "Ошибка подключения");
      } finally {
        setConnecting(false);
      }
    },
    [tagPatrolMode, connecting, connectedId, focusBle],
  );

  useEffect(() => {
    if (!tagPatrolMode || !focusTag || connectedId || connecting) return;
    const dev = BleService.findDeviceForTag(focusTag);
    if (dev && (scanActive || scanPaused)) {
      void tryAutoConnect(dev, focusTag);
    }
  }, [devices, tagPatrolMode, focusTag, connectedId, connecting, scanActive, scanPaused, tryAutoConnect]);

  const saveCheckinForBle = async (bleNum: string) => {
    if (gattBusy) return;
    const tag =
      routeMarkers.find((t) => normalizeBle(t.ble) === normalizeBle(bleNum)) ||
      findTag(bleNum);
    if (!tag) {
      setStatus("Метка не найдена в данных карты");
      return;
    }
    const dev = BleService.findDeviceForTag(tag);
    if (!dev) {
      setStatus(
        scanPaused
          ? "Метки нет в списке. Нажмите «Продолжить» и поднесите телефон."
          : "Метка не видна по Bluetooth. Подойдите ближе.",
      );
      return;
    }
    setBusyBle(tag.ble);
    setGattBusy(true);
    setStatus(`Подключение к метке #${tag.ble}…`);
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
      Vibration.vibrate([22, 36, 28]);
      setPendingOpen(true);
      await refreshDaily();
      const charge = live.chargeValue ?? 100;
      setStatus(
        charge <= LOW_BATTERY_PCT
          ? `Обход #${tag.ble} сохранён. Батарейки ${charge}%!`
          : `Обход #${tag.ble} сохранён (${charge}%)`,
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка GATT");
    } finally {
      setBusyBle(null);
      setGattBusy(false);
      setScanActive(BleService.isScanning());
    }
  };

  const saveCheckinForFocus = async () => {
    if (!tagPatrolMode || !focusTag || !connectedId || gattBusy) return;
    setGattBusy(true);
    setStatus(`Читаем данные метки #${focusTag.ble}…`);
    try {
      const dev = devices.find((d) => d.id === connectedId);
      const live = await BleService.readTagGattTelemetry(connectedId, {
        rssi: dev?.rssi,
        advTelemetry: dev?.advTelemetry,
      });
      if (!live.fromGatt) {
        setStatus(`GATT: данных нет (#${focusTag.ble})`);
        return;
      }
      await saveCheckinRecord(
        focusTag,
        { deviceId: connectedId, rssi: dev?.rssi ?? null },
        live,
        route,
      );
      Vibration.vibrate([22, 36, 28]);
      await BleService.disconnect();
      setConnectedId(null);
      setTagPatrolMode(false);
      setFocusBle(null);
      autoConnectRef.current = false;
      await BleService.stopScan(true);
      setScanActive(false);
      setScanPaused(false);
      setPendingOpen(true);
      await refreshDaily();
      setStatus(`Обход #${focusTag.ble} сохранён. Отправьте на сервер.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка чтения");
    } finally {
      setGattBusy(false);
    }
  };

  const uploadAll = async () => {
    if (!online) {
      setStatus("Нужен интернет");
      return;
    }
    const list = await getPendingCheckins();
    if (!list.length) {
      setStatus("Нет обходов для отправки");
      return;
    }
    setStatus(`Отправка ${list.length}…`);
    const result = await uploadCheckins(list, (ble) => findTag(ble));
    if (result.uploaded.length) await markCheckinsUploaded(result.uploaded);
    await refreshDaily();
    if (result.fail && result.ok) {
      setStatus(`Отправлено ${result.ok}, ошибок ${result.fail}`);
    } else if (result.fail) {
      setStatus(`Ошибка: ${result.lastErr.slice(0, 120)}`);
    } else {
      setStatus(`Все обходы отправлены (${result.ok})`);
    }
  };

  const progressPct =
    routeProgress.total > 0
      ? Math.round((routeProgress.done / routeProgress.total) * 100)
      : 0;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 14 }]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>
          {tagPatrolMode && focusBle
            ? `Обход · #${focusBle}`
            : "Обход маршрута"}
        </Text>
        <Text style={styles.route}>
          {route.routeId ? route.routeTitle : "все маршруты"}
        </Text>
      </View>

      {route.routeId ? (
        <View style={styles.progressBox}>
          <Text style={styles.progressText}>
            Пройдено {routeProgress.done} / {routeProgress.total}
          </Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>
        </View>
      ) : pendingUploads > 0 ? (
        <Text style={styles.progressText}>К отправке: {pendingUploads}</Text>
      ) : null}

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="№ метки для обхода"
          placeholderTextColor={colors.textMuted}
          value={patrolQuery}
          onChangeText={setPatrolQuery}
          keyboardType="number-pad"
          onSubmitEditing={onSearchSubmit}
        />
        <Pressable style={styles.searchGo} onPress={onSearchSubmit}>
          <Text style={styles.searchGoText}>Найти</Text>
        </Pressable>
      </View>

      {tagPatrolMode && focusTag ? (
        <View style={styles.focusBox}>
          <Text style={styles.focusTitle}>
            Метка #{focusTag.ble}
            {zoneShortLabel(focusTag) ? ` · ${zoneShortLabel(focusTag)}` : ""}
          </Text>
          <Text style={styles.focusSub}>
            {connecting
              ? "Подключение…"
              : gattBusy
                ? "Читаем GATT…"
                : connectedId
                  ? "Подключено — можно отправить обход"
                  : scanActive
                    ? "Сканирование… поднесите телефон"
                    : "Пауза или ожидание метки"}
          </Text>
          <Pressable
            style={[styles.saveBtn, (!connectedId || gattBusy) && styles.saveBtnOff]}
            disabled={!connectedId || gattBusy}
            onPress={saveCheckinForFocus}
          >
            {gattBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>Отправить обход</Text>
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

      <View style={styles.sectionHead}>
        <Text style={styles.sectionLabel}>Метки рядом (BLE)</Text>
        <Pressable style={styles.scanBtn} onPress={toggleScan}>
          <Text style={styles.scanBtnText}>{scanBtnLabel}</Text>
        </Pressable>
      </View>

      {nearbyRows.length === 0 ? (
        <Text style={styles.empty}>
          {!scanActive && !scanPaused
            ? "Нажмите «Сканировать» и подойдите к метке."
            : scanPaused
              ? "Список пуст. «Продолжить» и поднесите телефон."
              : `BLE в эфире: ${liveCount}. Сопоставленных меток нет.`}
        </Text>
      ) : (
        nearbyRows.map(({ tag, dev, saved }) => (
          <View key={normalizeBle(tag.ble)} style={[styles.row, saved && styles.rowDone]}>
            <View style={styles.rowMain}>
              <Text style={styles.ble}>
                #{tag.ble}
                {zoneShortLabel(tag) ? ` · ${zoneShortLabel(tag)}` : ""}
              </Text>
              {tag.title ? <Text style={styles.sub}>{tag.title}</Text> : null}
              <Text style={styles.meta}>
                {dev.rssi ?? "—"} dBm ·{" "}
                {dev.advTelemetry?.chargeValue != null
                  ? `${dev.advTelemetry.chargeValue}%`
                  : tag.charge != null
                    ? `${tag.charge}%`
                    : "—"}
              </Text>
            </View>
            <Pressable
              style={styles.sendBtn}
              disabled={!!busyBle || gattBusy}
              onPress={() => saveCheckinForBle(tag.ble)}
            >
              {busyBle === tag.ble ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Text style={styles.sendBtnText}>Отправить</Text>
              )}
            </Pressable>
          </View>
        ))
      )}

      <Pressable
        style={styles.pendingHead}
        onPress={() => pending.length && setPendingOpen((v) => !v)}
      >
        <Text style={styles.pendingLabel}>
          Сохранено · {pending.length}
        </Text>
        <Text style={styles.pendingChev}>{pendingOpen ? "▴" : "▾"}</Text>
      </Pressable>

      {pendingOpen && pending.length > 0 ? (
        <View style={styles.pendingList}>
          {pending.map((c) => (
            <View key={c.id} style={styles.pendingRow}>
              <Text style={styles.pendingBle}>#{c.bleNumber}</Text>
              <Text style={styles.pendingMeta}>
                {c.routeTitle}{" "}
                {c.checkedAt
                  ? new Date(c.checkedAt).toLocaleString("ru-RU")
                  : ""}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        style={[styles.uploadBtn, (!pending.length || !online) && styles.uploadBtnOff]}
        disabled={!pending.length || !online}
        onPress={uploadAll}
      >
        <Text style={styles.uploadBtnText}>
          {pending.length
            ? `Отправить на сервер (${pending.length})`
            : "Отправить на сервер"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const createStyles = (colors: AppColors) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 14, paddingBottom: 32, gap: 10 },
  header: { gap: 4 },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  route: { color: colors.textMuted, fontSize: 14 },
  progressBox: { gap: 6 },
  progressText: { color: colors.textMuted, fontSize: 13 },
  progressBar: {
    height: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.success },
  status: { color: colors.warning, fontSize: 13 },
  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchGo: {
    justifyContent: "center",
    paddingHorizontal: 14,
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
  },
  searchGoText: { color: colors.accent, fontWeight: "700" },
  focusBox: {
    padding: 14,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    gap: 8,
  },
  focusTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  focusSub: { color: colors.textMuted },
  saveBtn: {
    backgroundColor: colors.success,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  saveBtnOff: { opacity: 0.45 },
  saveBtnText: { color: "#fff", fontWeight: "700" },
  cancel: { color: colors.textMuted, textAlign: "center" },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  sectionLabel: { color: colors.text, fontWeight: "600" },
  scanBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.accent,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.neon,
  },
  scanBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  empty: { color: colors.textMuted, textAlign: "center", marginVertical: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  rowDone: { opacity: 0.55 },
  rowMain: { flex: 1 },
  ble: { color: colors.text, fontSize: 16, fontWeight: "600" },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  sendBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.accentSoft,
    borderRadius: 8,
    minWidth: 88,
    alignItems: "center",
  },
  sendBtnText: { color: colors.accent, fontWeight: "700", fontSize: 13 },
  pendingHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 8,
  },
  pendingLabel: { color: colors.text, fontWeight: "600" },
  pendingChev: { color: colors.textMuted },
  pendingList: { gap: 6 },
  pendingRow: {
    backgroundColor: colors.surface,
    padding: 10,
    borderRadius: 8,
  },
  pendingBle: { color: colors.text, fontWeight: "600" },
  pendingMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  uploadBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 8,
  },
  uploadBtnOff: { opacity: 0.45 },
  uploadBtnText: { color: "#fff", fontWeight: "700" },
  });
