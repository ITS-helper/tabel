import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  Vibration,
  View,
} from "react-native";
import { SearchField } from "../../src/components/SearchField";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uploadCheckins } from "../../src/api/checkinsUpload";
import { toBlePhotoProxyUrl } from "../../src/api/photoUtils";
import { BleService } from "../../src/ble/BleService";
import type { BleTagMarker, FieldCheckin, ScannedDevice } from "../../src/ble/types";
import { normalizeBle } from "../../src/ble/wwAdvert";
import { useAppData } from "../../src/context/AppDataContext";
import {
  buildNearbyRows,
  countLiveDevices,
  photosForPatrol,
  tagHasPhotos,
  zoneRowStyle,
  zoneShortLabel,
} from "../../src/field/fieldHelpers";
import { LOW_BATTERY_PCT } from "../../src/config";
import { getLocalPhotoUri } from "../../src/storage/fieldPhotoCache";
import {
  getDailyDoneSet,
  getPendingCheckins,
  loadStore,
  saveCheckinRecord,
  exportCheckinsBackup,
} from "../../src/storage/checkins";
import { useTheme } from "../../src/context/ThemeContext";
import type { AppColors } from "../../src/theme/palettes";

export default function FieldScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    route,
    markers,
    routeMarkers,
    routeProgress,
    findTag,
    focusBle,
    setFocusBle,
    pendingUploads,
    refreshPending,
    showPassedMarkers,
    setShowPassedMarkers,
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
  const [photoModalTag, setPhotoModalTag] = useState<BleTagMarker | null>(null);
  const [photoModalItems, setPhotoModalItems] = useState<
    Array<{ label: string; uri: string }>
  >([]);
  const [photoModalLoading, setPhotoModalLoading] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
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
          await BleService.beginFieldScan(true);
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
      void (async () => {
        await BleService.stopScan(true);
        BleService.setFieldPatrolActive(false);
      })();
      sub();
    };
  }, [refreshDaily, route.routeId, route.routeTitle, focusBle]);

  useEffect(() => {
    const patrolActive =
      scanActive ||
      scanPaused ||
      tagPatrolMode ||
      gattBusy ||
      connecting ||
      !!busyBle;
    BleService.setFieldPatrolActive(patrolActive);
  }, [
    scanActive,
    scanPaused,
    tagPatrolMode,
    gattBusy,
    connecting,
    busyBle,
  ]);

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
        showPassedMarkers,
        dailyDone,
        findTag,
      }),
    [devices, routeMarkers, scanPaused, showPassedMarkers, dailyDone, findTag],
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
        await BleService.beginFieldScan(false);
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
      await BleService.beginFieldScan(true);
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
          ? `Обход #${tag.ble} записан (батарея ${charge}%). Внизу «Отправить на сервер».`
          : `Обход #${tag.ble} записан. Внизу «Отправить на сервер».`,
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
      setStatus(`Обход #${focusTag.ble} записан. Внизу «Отправить на сервер».`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Ошибка чтения");
    } finally {
      setGattBusy(false);
    }
  };

  const uploadAll = async () => {
    if (uploadBusy) return;
    const list = await getPendingCheckins();
    if (!list.length) {
      setStatus("Нет обходов для отправки");
      return;
    }
    setUploadBusy(true);
    setUploadProgress(`0 / ${list.length}`);
    setStatus(`Отправка ${list.length} обходов…`);
    try {
      const result = await uploadCheckins(
        list,
        (ble) => findTag(ble),
        (p) => {
          setUploadProgress(`${p.done} / ${p.total}`);
          setStatus(`Отправка ${p.done} / ${p.total} · #${p.currentBle}…`);
        },
        markers,
      );
      await refreshDaily();
      if (result.fail && result.ok) {
        setStatus(
          `Отправлено ${result.ok} из ${list.length}. Осталось ${result.fail} — нажмите ещё раз. ${result.lastErr.slice(0, 80)}`,
        );
      } else if (result.fail) {
        setStatus(
          `Не отправлено (${result.fail}). Обходы сохранены на телефоне — повторите. ${result.lastErr.slice(0, 100)}`,
        );
      } else {
        setStatus(`Все обходы отправлены (${result.ok})`);
        setUploadProgress(null);
      }
    } catch (e) {
      setStatus(
        `Ошибка отправки. ${list.length} обходов сохранены на телефоне — повторите. ${e instanceof Error ? e.message : ""}`.slice(
          0,
          200,
        ),
      );
    } finally {
      setUploadBusy(false);
    }
  };

  const backupCheckins = async () => {
    const list = await getPendingCheckins();
    if (!list.length) {
      setStatus("Нет сохранённых обходов для резервной копии");
      return;
    }
    try {
      const json = await exportCheckinsBackup();
      await Share.share({
        message: json,
        title: `WW обходы ${list.length} шт.`,
      });
      setStatus(`Резервная копия ${list.length} обходов — отправьте себе в Telegram/почту`);
    } catch {
      setStatus(`${list.length} обходов на телефоне — не удаляйте приложение`);
    }
  };

  const closePhotoModal = useCallback(() => {
    setPhotoModalTag(null);
    setPhotoModalItems([]);
    setPhotoModalLoading(false);
  }, []);

  const openPhotosForTag = useCallback(async (tag: BleTagMarker) => {
    const photos = photosForPatrol(tag);
    setPhotoModalTag(tag);
    setPhotoModalItems([]);
    if (!photos.length) {
      setPhotoModalLoading(false);
      return;
    }
    setPhotoModalLoading(true);
    try {
      const items = await Promise.all(
        photos.map(async (p) => {
          const local = await getLocalPhotoUri(p.url);
          const uri = local
            ? local.startsWith("file://")
              ? local
              : `file://${local}`
            : toBlePhotoProxyUrl(p.url) || p.url;
          return { label: p.label, uri };
        }),
      );
      setPhotoModalItems(items);
    } finally {
      setPhotoModalLoading(false);
    }
  }, []);

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
        <SearchField
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
                  ? "Подключено — можно записать обход"
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
              <Text style={styles.saveBtnText}>Записать обход</Text>
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
        <View style={styles.sectionActions}>
          <View style={styles.toggleItem}>
            <Text style={styles.toggleLabel}>Пройденные</Text>
            <Switch
              value={showPassedMarkers}
              onValueChange={setShowPassedMarkers}
              trackColor={{ true: colors.accent, false: colors.surfaceAlt }}
            />
          </View>
          <Pressable style={styles.scanBtn} onPress={toggleScan}>
            <Text style={styles.scanBtnText}>{scanBtnLabel}</Text>
          </Pressable>
        </View>
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
        nearbyRows.map(({ tag, dev, saved }) => {
          const zStyle = zoneRowStyle(tag, colors);
          const isFocus =
            tagPatrolMode &&
            focusBle &&
            normalizeBle(tag.ble) === normalizeBle(focusBle);
          return (
          <View
            key={normalizeBle(tag.ble)}
            style={[
              styles.row,
              zStyle && {
                backgroundColor: zStyle.background,
                borderColor: zStyle.borderColor,
              },
              saved && styles.rowDone,
              isFocus && styles.rowFocus,
            ]}
          >
            <View style={styles.rowMain}>
              <View style={styles.rowHead}>
                <Text style={styles.bleNum}>#{tag.ble}</Text>
                {zoneShortLabel(tag) ? (
                  <View
                    style={[
                      styles.zonePill,
                      zStyle && { backgroundColor: zStyle.zonePillBg },
                    ]}
                  >
                    <Text
                      style={[
                        styles.zonePillText,
                        zStyle && { color: zStyle.zonePillText },
                      ]}
                    >
                      {zoneShortLabel(tag)}
                    </Text>
                  </View>
                ) : null}
              </View>
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
            <View style={styles.rowActions}>
              <Pressable
                style={[styles.photoBtn, !tagHasPhotos(tag) && styles.photoBtnOff]}
                disabled={!tagHasPhotos(tag)}
                onPress={() => openPhotosForTag(tag)}
              >
                <Text
                  style={[
                    styles.photoBtnText,
                    !tagHasPhotos(tag) && styles.photoBtnTextOff,
                  ]}
                >
                  Фото
                </Text>
              </Pressable>
              <Pressable
                style={styles.sendBtn}
                disabled={!!busyBle || gattBusy}
                onPress={() => saveCheckinForBle(tag.ble)}
              >
                {busyBle === tag.ble ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <Text style={styles.sendBtnText}>Отметить</Text>
                )}
              </Pressable>
            </View>
          </View>
          );
        })
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
        style={[styles.uploadBtn, (!pending.length || uploadBusy) && styles.uploadBtnOff]}
        disabled={!pending.length || uploadBusy}
        onPress={uploadAll}
      >
        {uploadBusy ? (
          <View style={styles.uploadBtnInner}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.uploadBtnText}>
              {uploadProgress ? `Отправка ${uploadProgress}…` : "Отправка…"}
            </Text>
          </View>
        ) : (
          <Text style={styles.uploadBtnText}>
            {pending.length
              ? `Отправить на сервер (${pending.length})`
              : "Отправить на сервер"}
          </Text>
        )}
      </Pressable>

      {pending.length > 0 ? (
        <Pressable style={styles.backupBtn} onPress={backupCheckins} disabled={uploadBusy}>
          <Text style={styles.backupBtnText}>
            Резервная копия ({pending.length}) — не потерять обход
          </Text>
        </Pressable>
      ) : null}

      <Modal
        visible={photoModalTag != null}
        transparent
        animationType="fade"
        onRequestClose={closePhotoModal}
      >
        <Pressable style={styles.photoModalBackdrop} onPress={closePhotoModal}>
          <Pressable style={styles.photoModalCard} onPress={() => {}}>
            <View style={styles.photoModalHead}>
              <Text style={styles.photoModalTitle}>
                #{photoModalTag?.ble}
                {photoModalTag && zoneShortLabel(photoModalTag)
                  ? ` · ${zoneShortLabel(photoModalTag)}`
                  : ""}
              </Text>
              <Pressable onPress={closePhotoModal} hitSlop={8}>
                <Text style={styles.photoModalClose}>×</Text>
              </Pressable>
            </View>
            {photoModalLoading ? (
              <ActivityIndicator color={colors.accent} style={styles.photoModalSpinner} />
            ) : photoModalItems.length ? (
              <ScrollView contentContainerStyle={styles.photoModalBody}>
                {photoModalItems.map((item) => (
                  <View key={item.label} style={styles.photoFig}>
                    <Text style={styles.photoFigLabel}>{item.label}</Text>
                    <Image
                      source={{ uri: item.uri }}
                      style={styles.photoFigImg}
                      resizeMode="cover"
                    />
                  </View>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.photoModalEmpty}>
                Нет фото. Обновите карту (↻) на вкладке «Карта».
              </Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
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
    marginTop: 8,
    gap: 8,
  },
  sectionActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  toggleItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
  },
  toggleLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
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
  rowFocus: {
    borderLeftWidth: 3,
    borderLeftColor: "#ff9800",
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  zonePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.surfaceAlt,
  },
  zonePillText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  rowMain: { flex: 1 },
  bleNum: {
    color: colors.neon,
    fontWeight: "800",
    fontSize: 17,
  },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  photoBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    minWidth: 56,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoBtnOff: { opacity: 0.45 },
  photoBtnText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  photoBtnTextOff: { color: colors.textMuted },
  sendBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.accentSoft,
    borderRadius: 8,
    minWidth: 88,
    alignItems: "center",
  },
  sendBtnText: { color: colors.accent, fontWeight: "700", fontSize: 13 },
  photoModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.88)",
    justifyContent: "center",
    padding: 16,
  },
  photoModalCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: "85%",
    overflow: "hidden",
  },
  photoModalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  photoModalTitle: { color: colors.text, fontWeight: "700", fontSize: 16, flex: 1 },
  photoModalClose: { color: colors.textMuted, fontSize: 28, lineHeight: 28 },
  photoModalSpinner: { marginVertical: 32 },
  photoModalBody: { padding: 12, gap: 12 },
  photoFig: { gap: 6 },
  photoFigLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  photoFigImg: {
    width: "100%",
    height: 200,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
  },
  photoModalEmpty: {
    color: colors.textMuted,
    textAlign: "center",
    padding: 24,
    fontSize: 14,
  },
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
  uploadBtnInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  uploadBtnText: { color: "#fff", fontWeight: "700" },
  backupBtn: {
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 4,
  },
  backupBtnText: { color: colors.warning, fontSize: 13, fontWeight: "600" },
  });
