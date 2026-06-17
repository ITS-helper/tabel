import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchBleRoutes,
  getLastBleFetchDetail,
  deriveRoutesFromRaw,
  deriveRoutesFromMarkers,
  mergeBleRoutes,
} from "../api/bleMapApi";
import type { BleRoute, BleTagMarker, BleZone, RouteRef } from "../ble/types";
import { normalizeBle, normalizeMac } from "../ble/wwAdvert";
import { applyRouteResetOverrides, routeProgressFor, tagMacKeys } from "../field/fieldHelpers";
import { BleService } from "../ble/BleService";
import { BLE_DEFAULT_COMPANY_ID } from "../config";
import {
  loadImmediateBootstrap,
  loadOfflineMarkers,
  loadOfflineMeta,
  loadOfflineRoutes,
  loadOfflineZones,
  saveOfflineMarkersOnly,
  saveOfflineRoutes,
  syncOfflinePack,
  snapshotHint,
  buildStatusLine,
  type OfflineMeta,
} from "../storage/offlineCache";
import { normalizeBleMarkers } from "../storage/markerNormalize";
import {
  applyQueuedEditsToMarkers,
  countPendingMarkerEdits,
} from "../storage/markerEdits";
import {
  getDailyDoneSet,
  getTodayRouteResetMap,
  getTodayPatrolMap,
  loadStore,
  pendingCount,
  resetRoutePatrolToday,
} from "../storage/checkins";
import {
  loadClusterEnabled,
  loadRouteFilter,
  loadShowPassedMarkers,
  saveClusterEnabled,
  saveRouteFilter,
  saveShowPassedMarkers,
} from "../storage/prefs";
import {
  loadPhotoCacheMeta,
  syncFieldPhotosFromRaw,
  type PhotoCacheMeta,
} from "../storage/fieldPhotoCache";
type AppDataContextValue = {
  markers: BleTagMarker[];
  zones: BleZone[];
  routes: BleRoute[];
  route: RouteRef;
  setRoute: (routeId: string, routeTitle: string) => void;
  clusterEnabled: boolean;
  setClusterEnabled: (v: boolean) => void;
  showPassedMarkers: boolean;
  setShowPassedMarkers: (v: boolean) => void;
  loading: boolean;
  error: string | null;
  statusLine: string | null;
  offlineMeta: OfflineMeta | null;
  refresh: () => Promise<boolean>;
  syncOffline: () => Promise<boolean>;
  findTag: (ble: string) => BleTagMarker | undefined;
  routeMarkers: BleTagMarker[];
  routeProgress: { done: number; total: number };
  pendingUploads: number;
  refreshPending: () => Promise<void>;
  dailyDone: Set<string>;
  todayPatrol: Record<string, string[]>;
  routeResetMap: Record<string, boolean>;
  resetRoutePatrol: (routeId: string) => Promise<void>;
  focusBle: string | null;
  setFocusBle: (ble: string | null) => void;
  photoMeta: PhotoCacheMeta | null;
  photoSyncNote: string | null;
  pendingMarkerEdits: number;
  refreshMarkerEditCount: () => Promise<void>;
  patchMarkerCoords: (updates: { id: number; lat: number; lng: number }[]) => Promise<void>;
};

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [markers, setMarkers] = useState<BleTagMarker[]>([]);
  const [zones, setZones] = useState<BleZone[]>([]);
  const [routes, setRoutes] = useState<BleRoute[]>([]);
  const [route, setRouteState] = useState<RouteRef>({
    routeId: "",
    routeTitle: "Все маршруты",
  });
  const [clusterEnabled, setClusterEnabledState] = useState(true);
  const [showPassedMarkers, setShowPassedMarkersState] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [offlineMeta, setOfflineMeta] = useState<OfflineMeta | null>(null);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [focusBle, setFocusBle] = useState<string | null>(null);
  const [dailyDone, setDailyDone] = useState<Set<string>>(new Set());
  const [todayPatrol, setTodayPatrol] = useState<Record<string, string[]>>({});
  const [routeResetMap, setRouteResetMap] = useState<Record<string, boolean>>({});
  const [photoMeta, setPhotoMeta] = useState<PhotoCacheMeta | null>(null);
  const [photoSyncNote, setPhotoSyncNote] = useState<string | null>(null);
  const [pendingMarkerEdits, setPendingMarkerEdits] = useState(0);
  const packBusyRef = useRef(false);

  const refreshMarkerEditCount = useCallback(async () => {
    setPendingMarkerEdits(await countPendingMarkerEdits());
  }, []);

  const syncPhotos = useCallback(async (raw: import("../ble/types").RawBlePoint[]) => {
    if (!raw.length) {
      setPhotoSyncNote(null);
      return;
    }
    setPhotoSyncNote("Фото: 0…");
    let lastUi = 0;
    try {
      const result = await syncFieldPhotosFromRaw(raw, (done, total) => {
        const now = Date.now();
        if (done === total || done % 15 === 0 || now - lastUi > 900) {
          lastUi = now;
          setPhotoSyncNote(`Фото: ${done}/${total}`);
        }
      });
      setPhotoMeta(await loadPhotoCacheMeta());
      if (result.ok > 0) {
        setPhotoSyncNote(`Фото +${result.ok}${result.fail ? `, ошибок ${result.fail}` : ""}`);
      } else if (result.fail > 0) {
        setPhotoSyncNote(`Ошибка загрузки фото (${result.fail})`);
      } else if (result.skipped > 0) {
        setPhotoSyncNote(`Фото в кэше: ${result.skipped}`);
      } else {
        setPhotoSyncNote(null);
      }
    } catch {
      setPhotoSyncNote("Ошибка загрузки фото");
    }
  }, []);

  const refreshPending = useCallback(async () => {
    setPendingUploads(await pendingCount());
    const store = await loadStore();
    setTodayPatrol(getTodayPatrolMap(store));
    setRouteResetMap(getTodayRouteResetMap(store));
    setDailyDone(getDailyDoneSet(store, route.routeId));
  }, [route.routeId]);

  const applyPack = useCallback(async (): Promise<boolean> => {
    const waitStart = Date.now();
    while (packBusyRef.current && Date.now() - waitStart < 120_000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (packBusyRef.current) return false;

    packBusyRef.current = true;
    setLoading(true);
    setError(null);
    setStatusLine(null);
    let apiOk = false;
    let photoRaw: import("../ble/types").RawBlePoint[] = [];

    const bootstrap = await loadImmediateBootstrap(BLE_DEFAULT_COMPANY_ID);
    const cachedRoutes = await loadOfflineRoutes();
    if (cachedRoutes.length) setRoutes(cachedRoutes);
    const localMarkers = await applyQueuedEditsToMarkers(
      bootstrap.markers.length
        ? normalizeBleMarkers(bootstrap.markers)
        : normalizeBleMarkers(await loadOfflineMarkers()),
    );
    const localZones = bootstrap.zones.length
      ? bootstrap.zones
      : await loadOfflineZones(BLE_DEFAULT_COMPANY_ID);

    if (localMarkers.length) {
      setMarkers(localMarkers);
      setZones(localZones);
      setOfflineMeta(await loadOfflineMeta());
      BleService.setKnownTags(localMarkers);
      if (!cachedRoutes.length) {
        setRoutes(deriveRoutesFromMarkers(localMarkers));
      }
    }

    try {
      const pack = await syncOfflinePack(BLE_DEFAULT_COMPANY_ID);
      const withEdits = await applyQueuedEditsToMarkers(pack.markers);
      setMarkers(withEdits);
      setZones(pack.zones);
      setOfflineMeta(pack.meta);
      BleService.setKnownTags(withEdits);
      const rawForRoutes = pack.raw.length ? pack.raw : pack.photoRaw;
      let routeList: BleRoute[] = cachedRoutes;
      try {
        const r = await fetchBleRoutes(withEdits, rawForRoutes);
        routeList = r;
        setRoutes(r);
        if (r.length) await saveOfflineRoutes(r);
      } catch {
        routeList = mergeBleRoutes(
          deriveRoutesFromRaw(rawForRoutes),
          deriveRoutesFromMarkers(withEdits),
          cachedRoutes,
        );
        setRoutes(routeList);
      }
      photoRaw = pack.photoRaw.length ? pack.photoRaw : pack.raw;
      const hint = snapshotHint(
        pack.meta.source,
        pack.meta.savedAt,
        pack.apiRefreshFailed,
        pack.fetchDetail,
      );
      setError(hint);
      setStatusLine(
        buildStatusLine({
          source: pack.meta.source,
          apiFailed: pack.apiRefreshFailed,
          fetchDetail: pack.fetchDetail,
          zonesDetail: pack.zonesDetail,
          markerCount: withEdits.length,
          zoneCount: pack.zones.length,
          routeCount: routeList.length,
          fromApiZones: pack.zonesDetail?.startsWith("API"),
        }),
      );
      apiOk = withEdits.length > 0;
    } catch (e) {
      apiOk = false;
      if (localMarkers.length) {
        const meta = await loadOfflineMeta();
        setError(
          snapshotHint(
            meta?.source ?? "local",
            meta?.savedAt,
            true,
            getLastBleFetchDetail() || (e instanceof Error ? e.message : undefined),
          ) ??
            (e instanceof Error ? e.message : "Не удалось обновить с сервера"),
        );
        setStatusLine(
          getLastBleFetchDetail() ||
            (e instanceof Error ? e.message : "Не удалось обновить с сервера"),
        );
        BleService.setKnownTags(localMarkers);
      } else {
        setError(e instanceof Error ? e.message : "Ошибка загрузки");
        setStatusLine(e instanceof Error ? e.message : "Ошибка загрузки");
        const meta = await loadOfflineMeta();
        setOfflineMeta(meta);
      }
    } finally {
      setLoading(false);
      packBusyRef.current = false;
      await refreshMarkerEditCount();
    }

    if (photoRaw.length) {
      void syncPhotos(photoRaw);
    }

    return apiOk;
  }, [refreshMarkerEditCount, syncPhotos]);

  const patchMarkerCoords = useCallback(
    async (updates: { id: number; lat: number; lng: number }[]) => {
      if (!updates.length) return;
      const byId = new Map(updates.map((u) => [u.id, u]));
      setMarkers((prev) => {
        const next = prev.map((m) => {
          if (m.id == null) return m;
          const u = byId.get(m.id);
          return u ? { ...m, lat: u.lat, lng: u.lng } : m;
        });
        void saveOfflineMarkersOnly(next);
        BleService.setKnownTags(next);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    BleService.setKnownTags(markers);
  }, [markers]);

  const findTag = useCallback(
    (ble: string, mac?: string | null) => {
      const key = normalizeBle(ble);
      const byBle = markers.find((m) => normalizeBle(m.ble) === key);
      if (byBle) return byBle;
      const macKey = normalizeMac(mac);
      if (!macKey) return undefined;
      return markers.find((t) => tagMacKeys(t).includes(macKey));
    },
    [markers],
  );

  useEffect(() => {
    BleService.setFindTag(findTag);
    return () => BleService.setFindTag(null);
  }, [findTag]);

  useEffect(() => {
    void (async () => {
      const [cluster, routePref, showPassed] = await Promise.all([
        loadClusterEnabled(),
        loadRouteFilter(),
        loadShowPassedMarkers(),
      ]);
      setClusterEnabledState(cluster);
      setShowPassedMarkersState(showPassed);
      setRouteState(routePref);
      setPhotoMeta(await loadPhotoCacheMeta());
      const store = await loadStore();
      setTodayPatrol(getTodayPatrolMap(store));
      setRouteResetMap(getTodayRouteResetMap(store));
      setDailyDone(getDailyDoneSet(store, routePref.routeId));
      await applyPack();
    })();
  }, [applyPack]);

  const setRoute = useCallback(async (routeId: string, routeTitle: string) => {
    const ref = { routeId, routeTitle };
    setRouteState(ref);
    await saveRouteFilter(routeId, routeTitle);
    const store = await loadStore();
    setTodayPatrol(getTodayPatrolMap(store));
    setRouteResetMap(getTodayRouteResetMap(store));
    setDailyDone(getDailyDoneSet(store, routeId));
  }, []);

  const resetRoutePatrol = useCallback(
    async (routeId: string) => {
      await resetRoutePatrolToday(routeId);
      const store = await loadStore();
      setTodayPatrol(getTodayPatrolMap(store));
      setRouteResetMap(getTodayRouteResetMap(store));
      setDailyDone(getDailyDoneSet(store, route.routeId));
      setPendingUploads(await pendingCount());
    },
    [route.routeId],
  );

  const setClusterEnabled = useCallback(async (v: boolean) => {
    setClusterEnabledState(v);
    await saveClusterEnabled(v);
  }, []);

  const setShowPassedMarkers = useCallback(async (v: boolean) => {
    setShowPassedMarkersState(v);
    await saveShowPassedMarkers(v);
  }, []);

  const patrolMarkers = useMemo(
    () => applyRouteResetOverrides(markers, todayPatrol, routeResetMap),
    [markers, todayPatrol, routeResetMap],
  );

  const routeMarkers = useMemo(() => {
    if (!route.routeId) return patrolMarkers;
    const rid = Number(route.routeId);
    return patrolMarkers.filter((m) => Number(m.routeId) === rid);
  }, [patrolMarkers, route.routeId]);

  const routeProgress = useMemo(
    () => routeProgressFor(routeMarkers, todayPatrol, route.routeId, routeResetMap),
    [routeMarkers, todayPatrol, route.routeId, routeResetMap],
  );

  const value: AppDataContextValue = {
    markers: patrolMarkers,
    zones,
    routes,
    route,
    setRoute,
    clusterEnabled,
    setClusterEnabled,
    showPassedMarkers,
    setShowPassedMarkers,
    loading,
    error,
    statusLine,
    offlineMeta,
    refresh: applyPack,
    syncOffline: applyPack,
    findTag,
    routeMarkers,
    routeProgress,
    pendingUploads,
    refreshPending,
    dailyDone,
    todayPatrol,
    routeResetMap,
    resetRoutePatrol,
    focusBle,
    setFocusBle,
    photoMeta,
    photoSyncNote,
    pendingMarkerEdits,
    refreshMarkerEditCount,
    patchMarkerCoords,
  };

  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData outside provider");
  return ctx;
}
