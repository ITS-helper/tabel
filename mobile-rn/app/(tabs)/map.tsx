import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { flushMarkerEditQueue, sessionEntryFromMove } from "../../src/api/markerEditsApi";
import { BleLeafletMap } from "../../src/components/BleLeafletMap";
import { RoutePickerModal } from "../../src/components/RoutePickerModal";
import { useAppData } from "../../src/context/AppDataContext";
import { APP_BUILD } from "../../src/config";
import { zonesForRouteMarkers } from "../../src/map/mapHelpers";
import { countMappableMarkers } from "../../src/storage/markerNormalize";
import {
  mergeSessionEdits,
  type MarkerEditEntry,
} from "../../src/storage/markerEdits";
import { useTheme } from "../../src/context/ThemeContext";
import type { AppColors } from "../../src/theme/palettes";

export default function MapScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    routeMarkers,
    markers,
    zones,
    routes,
    route,
    setRoute,
    clusterEnabled,
    setClusterEnabled,
    loading,
    error,
    offlineMeta,
    refresh,
    routeProgress,
    setFocusBle,
    photoMeta,
    photoSyncNote,
    findTag,
    pendingMarkerEdits,
    refreshMarkerEditCount,
    patchMarkerCoords,
  } = useAppData();
  const [query, setQuery] = useState("");
  const [routeOpen, setRouteOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshPhase, setRefreshPhase] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [sessionDirty, setSessionDirty] = useState<Map<number, MarkerEditEntry>>(
    () => new Map(),
  );
  const [editBusy, setEditBusy] = useState(false);
  const [editNote, setEditNote] = useState<string | null>(null);

  const sessionDirtyIds = useMemo(
    () => [...sessionDirty.keys()],
    [sessionDirty],
  );

  const displayMarkers = useMemo(() => {
    if (!sessionDirty.size) return routeMarkers;
    return routeMarkers.map((m) => {
      if (m.id == null) return m;
      const e = sessionDirty.get(m.id);
      return e ? { ...m, lat: e.lat, lng: e.lng } : m;
    });
  }, [routeMarkers, sessionDirty]);

  const mappableCount = useMemo(
    () => countMappableMarkers(displayMarkers),
    [displayMarkers],
  );

  const routeZones = useMemo(
    () => zonesForRouteMarkers(displayMarkers, zones, route.routeId),
    [displayMarkers, zones, route.routeId],
  );

  const cacheLabel = useMemo(() => {
    if (!offlineMeta?.savedAt) return "нет кэша";
    const d = new Date(offlineMeta.savedAt);
    return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  }, [offlineMeta]);

  const onRefresh = useCallback(async () => {
    if (refreshing) return;
    Vibration.vibrate(16);
    setRefreshing(true);
    setRefreshPhase("Подключение к API…");
    try {
      setRefreshPhase("Загрузка меток, зон и фото…");
      const ok = await refresh();
      if (ok) {
        Vibration.vibrate([18, 36, 18]);
        setRefreshPhase("Готово");
      } else {
        Vibration.vibrate([28, 48, 28]);
        setRefreshPhase("Частично: показан кэш — проверьте Wi‑Fi");
      }
      setTimeout(() => setRefreshPhase(null), ok ? 1400 : 3200);
    } catch {
      Vibration.vibrate([28, 48, 28]);
      setRefreshPhase("Не удалось обновить — проверьте Wi‑Fi");
      setTimeout(() => setRefreshPhase(null), 3200);
    } finally {
      setRefreshing(false);
    }
  }, [refresh, refreshing]);

  const onPatrol = useCallback(
    (tag: { ble: string }) => {
      setFocusBle(tag.ble);
      router.push("/(tabs)/field");
    },
    [router, setFocusBle],
  );

  const enterEditMode = useCallback(() => {
    Alert.alert(
      "Редактирование меток",
      "Удержите метку 1 сек., затем перетащите.\n\n«Запомнить» — сохранить на устройстве.\n«Отправить» — на сервер (вне режима правки).",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Продолжить",
          onPress: () => {
            setSessionDirty(new Map());
            setEditNote(null);
            setEditMode(true);
          },
        },
      ],
    );
  }, []);

  const exitEditMode = useCallback((discardSession = false) => {
    if (!discardSession && sessionDirty.size) {
      Alert.alert(
        "Выйти из правки?",
        "Несохранённые сдвиги меток будут отменены.",
        [
          { text: "Остаться", style: "cancel" },
          {
            text: "Выйти",
            style: "destructive",
            onPress: () => {
              setSessionDirty(new Map());
              setEditMode(false);
              setEditNote(null);
            },
          },
        ],
      );
      return;
    }
    if (discardSession) setSessionDirty(new Map());
    setEditMode(false);
    setEditNote(null);
  }, [sessionDirty.size]);

  const onMarkerMoved = useCallback(
    (id: number, ble: string, lat: number, lng: number) => {
      const marker = markers.find((m) => m.id === id) ?? findTag(ble);
      if (!marker) return;
      setSessionDirty((prev) => {
        const next = new Map(prev);
        const prevEntry = prev.get(id);
        const entry = sessionEntryFromMove(marker, lat, lng, {
          lat: prevEntry?.origLat ?? marker.lat,
          lng: prevEntry?.origLng ?? marker.lng,
        });
        if (!entry) return prev;
        next.set(id, entry);
        setEditNote(`Изменено: ${next.size} ${next.size === 1 ? "метка" : "меток"}`);
        return next;
      });
    },
    [markers, findTag],
  );

  const rememberEdits = useCallback(async () => {
    if (!sessionDirty.size) {
      exitEditMode(true);
      return;
    }
    setEditBusy(true);
    try {
      const n = await mergeSessionEdits(sessionDirty);
      await patchMarkerCoords(
        [...sessionDirty.values()].map((e) => ({
          id: e.id,
          lat: e.lat,
          lng: e.lng,
        })),
      );
      await refreshMarkerEditCount();
      setSessionDirty(new Map());
      setEditMode(false);
      setEditNote(`Запомнено на устройстве: ${n} ${n === 1 ? "метка" : "меток"}. Отправка — «Отправить».`);
    } finally {
      setEditBusy(false);
    }
  }, [sessionDirty, patchMarkerCoords, refreshMarkerEditCount, exitEditMode]);

  const sendPendingEdits = useCallback(async () => {
    setEditBusy(true);
    setEditNote(null);
    try {
      const n = await flushMarkerEditQueue();
      await refreshMarkerEditCount();
      await refresh();
      setEditNote(n ? `Отправлено на сервер: ${n} ${n === 1 ? "метка" : "меток"}` : "Нечего отправлять");
    } catch (e) {
      setEditNote(e instanceof Error ? e.message : "Ошибка отправки");
    } finally {
      setEditBusy(false);
    }
  }, [refresh, refreshMarkerEditCount]);

  const sourceLabel =
    offlineMeta?.source === "api"
      ? "API"
      : offlineMeta?.source === "cache"
        ? "кэш Supabase"
        : offlineMeta?.source === "bundle"
          ? "снимок"
          : offlineMeta?.source === "local"
            ? "локально"
            : "—";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.toolbar}>
        <Pressable style={styles.routePill} onPress={() => setRouteOpen(true)}>
          <Text style={styles.routeText} numberOfLines={1}>
            {route.routeTitle}
          </Text>
        </Pressable>
        <TextInput
          style={styles.search}
          placeholder="№ метки"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          editable={!editMode}
        />
        <Pressable
          style={[styles.iconBtn, editMode && styles.iconBtnActive]}
          onPress={() => (editMode ? exitEditMode() : enterEditMode())}
          disabled={editBusy}
        >
          <Text style={[styles.iconBtnText, editMode && styles.iconBtnTextActive]}>✎</Text>
        </Pressable>
        <Pressable
          style={[styles.iconBtn, refreshing && styles.iconBtnRefreshing]}
          onPress={onRefresh}
          disabled={loading || refreshing || editMode}
        >
          {refreshing ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Text style={styles.iconBtnText}>↻</Text>
          )}
        </Pressable>
      </View>

      {refreshing || refreshPhase ? (
        <View style={styles.refreshBar}>
          {refreshing ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : null}
          <Text style={styles.refreshBarText}>
            {refreshPhase ?? "Обновление…"}
          </Text>
        </View>
      ) : null}

      <View style={styles.subbar}>
        <Text style={styles.subText} numberOfLines={2}>
          {editMode
            ? "Удержите метку 1 сек., перетащите"
            : `${routeProgress.done}/${routeProgress.total} · ${mappableCount} на карте · ${route.routeId ? `${routeZones.length} зон` : `${zones.length} зон`}${query.trim() ? ` · «${query.trim()}»` : ""}`}
        </Text>
        {!editMode ? (
          <View style={styles.clusterRow}>
            <Text style={styles.subText}>Кластеры</Text>
            <Switch
              value={clusterEnabled}
              onValueChange={setClusterEnabled}
              trackColor={{ true: colors.accent, false: colors.surfaceAlt }}
            />
          </View>
        ) : null}
      </View>

      {editMode ? (
        <View style={styles.editBar}>
          <Pressable
            style={[styles.editBtn, styles.editBtnPrimary, (!sessionDirty.size || editBusy) && styles.editBtnOff]}
            onPress={rememberEdits}
            disabled={!sessionDirty.size || editBusy}
          >
            <Text style={styles.editBtnText}>
              {editBusy ? "…" : `Запомнить${sessionDirty.size ? ` (${sessionDirty.size})` : ""}`}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.editBtn, styles.editBtnGhost]}
            onPress={() => exitEditMode()}
            disabled={editBusy}
          >
            <Text style={styles.editBtnGhostText}>Отмена</Text>
          </Pressable>
        </View>
      ) : pendingMarkerEdits > 0 ? (
        <View style={styles.editBar}>
          <Pressable
            style={[styles.editBtn, styles.editBtnSend, editBusy && styles.editBtnOff]}
            onPress={sendPendingEdits}
            disabled={editBusy}
          >
            <Text style={styles.editBtnText}>
              {editBusy ? "Отправка…" : `Отправить (${pendingMarkerEdits})`}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {editNote ? (
        <View style={styles.noteBar}>
          <Text style={styles.noteText}>{editNote}</Text>
        </View>
      ) : null}

      {loading && !routeMarkers.length ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Загрузка меток и зон…</Text>
        </View>
      ) : error && !routeMarkers.length ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={onRefresh}>
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {error && routeMarkers.length ? (
            <View style={styles.noteBar}>
              <Text style={styles.noteText}>{error}</Text>
            </View>
          ) : null}
          <BleLeafletMap
          markers={displayMarkers}
          zones={routeZones}
          query={query}
          findTag={findTag}
          clusterEnabled={clusterEnabled}
          editMode={editMode}
          dirtyIds={sessionDirtyIds}
          onMarkerMoved={onMarkerMoved}
          onPatrol={onPatrol}
          photoCacheTick={photoMeta?.lastSyncAt ?? null}
        />
        </>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {refreshing || refreshPhase
            ? refreshPhase ?? "Обновление: метки, зоны, фото…"
            : photoSyncNote
              ? photoSyncNote
              : `Загружено: ${offlineMeta?.markerCount ?? routeMarkers.length} меток (${mappableCount} GPS), ${offlineMeta?.zoneCount ?? zones.length} зон, ${photoMeta?.photoCount ?? 0} фото · ${sourceLabel} · ${cacheLabel}`}
        </Text>
        <Text style={styles.footerSub}>
          ↻ — метки, полигоны и новые фото в кэш · {APP_BUILD}
        </Text>
      </View>

      <RoutePickerModal
        visible={routeOpen}
        routes={routes}
        selectedId={route.routeId}
        onSelect={setRoute}
        onClose={() => setRouteOpen(false)}
      />
    </View>
  );
}

const createStyles = (colors: AppColors) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: "center",
  },
  routePill: {
    maxWidth: 120,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.neon,
  },
  routeText: { color: colors.neon, fontWeight: "600", fontSize: 13 },
  search: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconBtnActive: { backgroundColor: colors.warning, borderColor: colors.warning },
  iconBtnRefreshing: { backgroundColor: colors.accent, borderColor: colors.neon },
  iconBtnText: { color: colors.accent, fontSize: 18 },
  iconBtnTextActive: { color: "#fff" },
  refreshBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: colors.accentSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.neon,
  },
  refreshBarText: {
    color: colors.neon,
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  subbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subText: { color: colors.textMuted, fontSize: 12, flex: 1 },
  clusterRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  editBar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  editBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  editBtnPrimary: {
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.neon,
  },
  editBtnSend: { backgroundColor: colors.neonDim, borderWidth: 1, borderColor: colors.neon },
  editBtnGhost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  editBtnOff: { opacity: 0.45 },
  editBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  editBtnGhostText: { color: colors.textMuted, fontWeight: "600", fontSize: 14 },
  noteBar: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(21,101,192,0.15)",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  noteText: { color: colors.text, fontSize: 12, textAlign: "center" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  muted: { color: colors.textMuted },
  error: { color: colors.danger, textAlign: "center" },
  retry: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.accent,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.neon,
  },
  retryText: { color: "#fff", fontWeight: "600" },
  footer: {
    padding: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 2,
  },
  footerText: { color: colors.textMuted, fontSize: 11, textAlign: "center" },
  footerSub: { color: colors.textMuted, fontSize: 10, textAlign: "center", opacity: 0.85 },
  });
