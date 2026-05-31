import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchBleRoutes } from "../api/bleMapApi";
import type { BleRoute, BleTagMarker, BleZone, RouteRef } from "../ble/types";
import { normalizeBle } from "../ble/wwAdvert";
import { BleService } from "../ble/BleService";
import { BLE_DEFAULT_COMPANY_ID } from "../config";
import {
  loadOfflineMarkers,
  loadOfflineMeta,
  loadOfflineZones,
  saveOfflineMarkersOnly,
  syncOfflinePack,
  type OfflineMeta,
} from "../storage/offlineCache";
import { normalizeBleMarkers } from "../storage/markerNormalize";
import {
  applyQueuedEditsToMarkers,
  countPendingMarkerEdits,
} from "../storage/markerEdits";
import {
  getDailyDoneSet,
  loadStore,
  pendingCount,
} from "../storage/checkins";
import {
  loadClusterEnabled,
  loadRouteFilter,
  saveClusterEnabled,
  saveRouteFilter,
} from "../storage/prefs";
import {
  loadPhotoCacheMeta,
  syncFieldPhotosFromRaw,
  type PhotoCacheMeta,
} from "../storage/fieldPhotoCache";
import { isOnline } from "../storage/offlineCache";

type AppDataContextValue = {
  markers: BleTagMarker[];
  zones: BleZone[];
  routes: BleRoute[];
  route: RouteRef;
  setRoute: (routeId: string, routeTitle: string) => void;
  clusterEnabled: boolean;
  setClusterEnabled: (v: boolean) => void;
  loading: boolean;
  error: string | null;
  offlineMeta: OfflineMeta | null;
  refresh: () => Promise<void>;
  syncOffline: () => Promise<void>;
  findTag: (ble: string) => BleTagMarker | undefined;
  routeMarkers: BleTagMarker[];
  routeProgress: { done: number; total: number };
  pendingUploads: number;
  refreshPending: () => Promise<void>;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offlineMeta, setOfflineMeta] = useState<OfflineMeta | null>(null);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [focusBle, setFocusBle] = useState<string | null>(null);
  const [dailyDone, setDailyDone] = useState<Set<string>>(new Set());
  const [photoMeta, setPhotoMeta] = useState<PhotoCacheMeta | null>(null);
  const [photoSyncNote, setPhotoSyncNote] = useState<string | null>(null);
  const [pendingMarkerEdits, setPendingMarkerEdits] = useState(0);

  const refreshMarkerEditCount = useCallback(async () => {
    setPendingMarkerEdits(await countPendingMarkerEdits());
  }, []);

  const syncPhotos = useCallback(async (raw: import("../ble/types").RawBlePoint[]) => {
    if (!raw.length || !(await isOnline())) return;
    setPhotoSyncNote("Фото: 0%");
    try {
      const result = await syncFieldPhotosFromRaw(raw, (done, total) => {
        setPhotoSyncNote(`Фото: ${done}/${total}`);
      });
      setPhotoMeta(await loadPhotoCacheMeta());
      if (result.ok > 0) {
        setPhotoSyncNote(`Фото +${result.ok}${result.fail ? `, ошибок ${result.fail}` : ""}`);
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
    setDailyDone(getDailyDoneSet(store, route.routeId));
  }, [route.routeId]);

  const applyPack = useCallback(async () => {
    setLoading(true);
    setError(null);

    const localMarkers = await applyQueuedEditsToMarkers(
      normalizeBleMarkers(await loadOfflineMarkers()),
    );
    const localZones = await loadOfflineZones(BLE_DEFAULT_COMPANY_ID);
    if (localMarkers.length) {
      setMarkers(localMarkers);
      setZones(localZones);
      setOfflineMeta(await loadOfflineMeta());
    }

    try {
      const pack = await syncOfflinePack(BLE_DEFAULT_COMPANY_ID);
      const withEdits = await applyQueuedEditsToMarkers(pack.markers);
      setMarkers(withEdits);
      setZones(pack.zones);
      setOfflineMeta(pack.meta);
      BleService.setKnownTags(withEdits);
      try {
        const r = await fetchBleRoutes();
        setRoutes(r);
      } catch {
        /* routes optional offline */
      }
      void syncPhotos(pack.raw);
    } catch (e) {
      if (localMarkers.length) {
        setError(
          e instanceof Error
            ? `${e.message} · показан локальный кэш`
            : "Ошибка загрузки · показан локальный кэш",
        );
        BleService.setKnownTags(localMarkers);
      } else {
        setError(e instanceof Error ? e.message : "Ошибка загрузки");
        const meta = await loadOfflineMeta();
        setOfflineMeta(meta);
      }
    } finally {
      setLoading(false);
      await refreshMarkerEditCount();
    }
  }, [refreshPending, refreshMarkerEditCount]);

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

  useEffect(() => {
    void (async () => {
      const [cluster, routePref] = await Promise.all([
        loadClusterEnabled(),
        loadRouteFilter(),
      ]);
      setClusterEnabledState(cluster);
      setRouteState(routePref);
      setPhotoMeta(await loadPhotoCacheMeta());
      await applyPack();
    })();
  }, [applyPack]);

  const setRoute = useCallback(async (routeId: string, routeTitle: string) => {
    const ref = { routeId, routeTitle };
    setRouteState(ref);
    await saveRouteFilter(routeId, routeTitle);
    const store = await loadStore();
    setDailyDone(getDailyDoneSet(store, routeId));
  }, []);

  const setClusterEnabled = useCallback(async (v: boolean) => {
    setClusterEnabledState(v);
    await saveClusterEnabled(v);
  }, []);

  const findTag = useCallback(
    (ble: string) => {
      const key = normalizeBle(ble);
      return markers.find((m) => normalizeBle(m.ble) === key);
    },
    [markers],
  );

  const routeMarkers = useMemo(() => {
    if (!route.routeId) return markers;
    const rid = Number(route.routeId);
    return markers.filter((m) => Number(m.routeId) === rid);
  }, [markers, route.routeId]);

  const routeProgress = useMemo(() => {
    const total = routeMarkers.length;
    let done = 0;
    for (const m of routeMarkers) {
      if (dailyDone.has(normalizeBle(m.ble)) || m.isInspected) done++;
    }
    return { done, total };
  }, [routeMarkers, dailyDone]);

  const value: AppDataContextValue = {
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
    refresh: applyPack,
    syncOffline: applyPack,
    findTag,
    routeMarkers,
    routeProgress,
    pendingUploads,
    refreshPending,
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
