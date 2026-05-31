import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { BleMapView } from "../../src/components/BleMapView";
import { RoutePickerModal } from "../../src/components/RoutePickerModal";
import { useAppData } from "../../src/context/AppDataContext";
import { APP_BUILD } from "../../src/config";
import { colors } from "../../src/theme/colors";

export default function MapScreen() {
  const router = useRouter();
  const {
    routeMarkers,
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
  } = useAppData();
  const [query, setQuery] = useState("");
  const [routeOpen, setRouteOpen] = useState(false);

  const cacheLabel = useMemo(() => {
    if (!offlineMeta?.savedAt) return "нет кэша";
    const d = new Date(offlineMeta.savedAt);
    return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  }, [offlineMeta]);

  const onMarkerPress = useCallback(
    (tag: { ble: string }) => {
      setFocusBle(tag.ble);
      router.push("/(tabs)/field");
    },
    [router, setFocusBle],
  );

  return (
    <View style={styles.root}>
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
        />
        <Pressable style={styles.iconBtn} onPress={refresh}>
          <Text style={styles.iconBtnText}>↻</Text>
        </Pressable>
      </View>

      <View style={styles.subbar}>
        <Text style={styles.subText}>
          {routeProgress.done}/{routeProgress.total} · {routeMarkers.length} меток
        </Text>
        <View style={styles.clusterRow}>
          <Text style={styles.subText}>Кластеры</Text>
          <Switch
            value={clusterEnabled}
            onValueChange={setClusterEnabled}
            trackColor={{ true: colors.accent, false: colors.surfaceAlt }}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Загрузка…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={refresh}>
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <BleMapView
          markers={routeMarkers}
          zones={zones}
          clusterEnabled={clusterEnabled}
          query={query}
          onMarkerPress={onMarkerPress}
        />
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Офлайн: {offlineMeta?.markerCount ?? 0} меток, {offlineMeta?.zoneCount ?? 0} зон · {cacheLabel} · {APP_BUILD}
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

const styles = StyleSheet.create({
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
  },
  routeText: { color: colors.accent, fontWeight: "600", fontSize: 13 },
  search: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
  },
  iconBtnText: { color: colors.accent, fontSize: 18 },
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
  subText: { color: colors.textMuted, fontSize: 12 },
  clusterRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  map: { flex: 1 },
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
  },
  retryText: { color: "#fff", fontWeight: "600" },
  footer: {
    padding: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerText: { color: colors.textMuted, fontSize: 11, textAlign: "center" },
});
