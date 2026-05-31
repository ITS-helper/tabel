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
import { BLE_DEFAULT_COMPANY_ID } from "../config";
import {
  loadOfflineMeta,
  syncOfflinePack,
  type OfflineMeta,
} from "../storage/offlineCache";
import {
  loadClusterEnabled,
  loadRouteFilter,
  saveClusterEnabled,
  saveRouteFilter,
} from "../storage/prefs";
import { getDailyDoneSet, loadStore, pendingCount } from "../storage/checkins";

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

  const refreshPending = useCallback(async () => {
    setPendingUploads(await pendingCount());
    const store = await loadStore();
    setDailyDone(getDailyDoneSet(store, route.routeId));
  }, [route.routeId]);

  const applyPack = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pack = await syncOfflinePack(BLE_DEFAULT_COMPANY_ID);
      setMarkers(pack.markers);
      setZones(pack.zones);
      setOfflineMeta(pack.meta);
      try {
        const r = await fetchBleRoutes();
        setRoutes(r);
      } catch {
        /* routes optional offline */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
      const meta = await loadOfflineMeta();
      setOfflineMeta(meta);
    } finally {
      setLoading(false);
      await refreshPending();
    }
  }, [refreshPending]);

  useEffect(() => {
    void (async () => {
      const [cluster, routePref] = await Promise.all([
        loadClusterEnabled(),
        loadRouteFilter(),
      ]);
      setClusterEnabledState(cluster);
      setRouteState(routePref);
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
