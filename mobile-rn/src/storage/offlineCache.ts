import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
  classifyBle,
  getLastBleFetchDetail,
  normalizeWorkerBlePoint,
  parseZonesFromMapPayload,
  type BleMapFetchChannel,
} from "../api/bleMapApi";
import { formatBundleAge, loadBundledBleCache } from "../api/bleMapCacheBundle";
import { fetchBleListOffline } from "../api/bleMapCacheRemote";
import { loadBleZonesFull } from "../api/zonesLoader";
import { loadRawMarkers } from "./loadRawMarkers";
import type { BleRoute, BleTagMarker, BleZone, RawBlePoint } from "../ble/types";
import {
  BLE_DEFAULT_COMPANY_ID,
  BLE_OFFLINE_MARKERS_KEY,
  BLE_OFFLINE_META_KEY,
  BLE_OFFLINE_ROUTES_KEY,
  BLE_ZONES_LS_KEY,
} from "../config";
import { normalizeBle } from "../ble/wwAdvert";
import {
  countMappableMarkers,
  normalizeBleMarkers,
} from "./markerNormalize";

export type OfflineMeta = {
  companyId: number;
  savedAt: number;
  markerCount: number;
  mappableCount: number;
  zoneCount: number;
  fromNetwork: boolean;
  source?: "api" | "cache" | "local" | "bundle";
  refreshedAt?: number;
};

/** Wi‑Fi на объекте часто без «интернета» в NetInfo — не блокируем API только из‑за этого. */
export async function isOnline(): Promise<boolean> {
  const s = await NetInfo.fetch();
  return s.isConnected === true;
}

export async function saveOfflineMarkersOnly(markers: BleTagMarker[]): Promise<void> {
  const normalized = normalizeBleMarkers(markers);
  await AsyncStorage.setItem(BLE_OFFLINE_MARKERS_KEY, JSON.stringify(normalized));
}

export async function loadOfflineMarkers(): Promise<BleTagMarker[]> {
  const raw = await AsyncStorage.getItem(BLE_OFFLINE_MARKERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as BleTagMarker[];
    return Array.isArray(parsed) ? normalizeBleMarkers(parsed) : [];
  } catch {
    return [];
  }
}

export async function loadOfflineZones(companyId: number): Promise<BleZone[]> {
  const raw = await AsyncStorage.getItem(BLE_ZONES_LS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as {
      companyId: number;
      zones: BleZone[];
    };
    if (Number(parsed.companyId) !== Number(companyId)) return [];
    return Array.isArray(parsed.zones) ? parsed.zones : [];
  } catch {
    return [];
  }
}

export async function loadOfflineMeta(): Promise<OfflineMeta | null> {
  const raw = await AsyncStorage.getItem(BLE_OFFLINE_META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OfflineMeta;
  } catch {
    return null;
  }
}

async function saveOfflinePack(
  markers: BleTagMarker[],
  zones: BleZone[],
  companyId: number,
  source: OfflineMeta["source"] = "api",
): Promise<OfflineMeta> {
  const normalized = normalizeBleMarkers(markers);
  await AsyncStorage.setItem(BLE_OFFLINE_MARKERS_KEY, JSON.stringify(normalized));
  await AsyncStorage.setItem(
    BLE_ZONES_LS_KEY,
    JSON.stringify({ companyId, savedAt: Date.now(), zones }),
  );
  const meta: OfflineMeta = {
    companyId,
    savedAt: Date.now(),
    refreshedAt: Date.now(),
    markerCount: normalized.length,
    mappableCount: countMappableMarkers(normalized),
    zoneCount: zones.length,
    fromNetwork: source !== "local",
    source,
  };
  await AsyncStorage.setItem(BLE_OFFLINE_META_KEY, JSON.stringify(meta));
  return meta;
}

function markersFromRaw(raw: RawBlePoint[], prev: BleTagMarker[] = []): BleTagMarker[] {
  const prevById = new Map<number, BleTagMarker>();
  const prevByBle = new Map<string, BleTagMarker>();
  for (const m of prev) {
    if (m.id != null) prevById.set(m.id, m);
    prevByBle.set(normalizeBle(m.ble), m);
  }
  return normalizeBleMarkers(
    raw
      .map((p) => normalizeWorkerBlePoint(p))
      .map((p) => {
        const row = p as Record<string, unknown>;
        const bleKey = normalizeBle(String(p.ble_number ?? row.bleNumber ?? ""));
        const prevMarker =
          (p.id != null ? prevById.get(p.id) : undefined) ??
          prevByBle.get(bleKey);
        return classifyBle(p, prevMarker);
      })
      .filter((m) => m.lat != null && m.lng != null),
  );
}

function rawHasPhotoFields(raw: RawBlePoint[]): boolean {
  return raw.some((p) => {
    const row = p as Record<string, unknown>;
    return !!(
      p.ble_image_url ||
      p.location_image_url ||
      row.bleImageUrl ||
      row.locationImageUrl
    );
  });
}

function photoRawFromMarkers(markers: BleTagMarker[]): RawBlePoint[] {
  return markers
    .filter((m) => m.photoTag || m.photoPlace)
    .map((m) => ({
      id: m.id,
      ble_number: Number(m.ble) || undefined,
      ble_image_url: m.photoTag,
      location_image_url: m.photoPlace,
    }));
}

function resolvePhotoRaw(
  raw: RawBlePoint[],
  markers: BleTagMarker[],
  bundled: RawBlePoint[],
): RawBlePoint[] {
  if (rawHasPhotoFields(raw)) return raw;
  const fromMarkers = photoRawFromMarkers(markers);
  if (fromMarkers.length) return fromMarkers;
  return bundled;
}

function rawHasCoords(point: RawBlePoint): boolean {
  const lat = point.latitude ?? point.lat;
  const lng = point.longitude ?? point.lng;
  return (
    lat != null &&
    lng != null &&
    Math.abs(Number(lat)) <= 90 &&
    Math.abs(Number(lng)) <= 180 &&
    !(Number(lat) === 0 && Number(lng) === 0)
  );
}

/** Первый запуск без кэша: только bundled APK, без github/Supabase-снимков. */
async function loadBootstrapRaw(
  companyId: number,
): Promise<{
  raw: RawBlePoint[];
  source: OfflineMeta["source"];
  channel?: BleMapFetchChannel;
  snapshotAt?: string;
}> {
  const bundled = loadBundledBleCache(companyId);
  if (bundled?.raw.some(rawHasCoords)) {
    return {
      raw: bundled.raw,
      source: "bundle",
      channel: "none",
      snapshotAt: bundled.updatedAt,
    };
  }
  return { raw: [], source: "bundle" };
}

export async function loadOfflineRoutes(): Promise<BleRoute[]> {
  const raw = await AsyncStorage.getItem(BLE_OFFLINE_ROUTES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as BleRoute[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveOfflineRoutes(routes: BleRoute[]): Promise<void> {
  await AsyncStorage.setItem(BLE_OFFLINE_ROUTES_KEY, JSON.stringify(routes));
}

async function loadZones(companyId: number, local: BleZone[]) {
  return loadBleZonesFull(companyId, local, { tryApi: true, awaitPolygons: true });
}

export async function syncOfflinePack(
  companyId = BLE_DEFAULT_COMPANY_ID,
): Promise<{
  markers: BleTagMarker[];
  zones: BleZone[];
  meta: OfflineMeta;
  raw: RawBlePoint[];
  photoRaw: RawBlePoint[];
  apiRefreshFailed: boolean;
  fetchDetail?: string;
  didRefresh: boolean;
  statusLine?: string;
  routes?: BleRoute[];
  zonesDetail?: string;
}> {
  const localMarkers = await loadOfflineMarkers();
  const localZones = await loadOfflineZones(companyId);
  const bundledFallback = () => loadBundledBleCache(companyId)?.raw ?? [];

  // Capacitor всегда пробует API; NetInfo не блокирует refresh.
  try {
    const { raw, source, channel, apiFailed, fetchDetail } = await loadRawMarkers(companyId);
    const fromNetwork = raw.length
      ? markersFromRaw(raw, localMarkers)
      : [];
    const markers = fromNetwork.length ? fromNetwork : localMarkers;
    const zoneResult = await loadZones(companyId, localZones);
    const zones = zoneResult.zones.length ? zoneResult.zones : localZones;
    const photoRaw = resolvePhotoRaw(raw, markers, bundledFallback());
    const liveRefresh =
      (channel === "map_ble" || channel === "ble_page") &&
      fromNetwork.length > 0 &&
      !apiFailed &&
      source === "api";
    const didRefresh = fromNetwork.length > 0;
    const statusLine = buildStatusLine({
      source,
      apiFailed: !!apiFailed || !liveRefresh,
      fetchDetail,
      zonesDetail: zoneResult.detail,
      markerCount: markers.length,
      zoneCount: zones.length,
      fromApiZones: zoneResult.fromApi,
    });

    if (!fromNetwork.length && localMarkers.length > 0) {
      const meta = (await loadOfflineMeta()) ?? {
        companyId,
        savedAt: 0,
        markerCount: localMarkers.length,
        mappableCount: countMappableMarkers(localMarkers),
        zoneCount: localZones.length,
        fromNetwork: false,
        source: "local" as const,
      };
      const mergedZones = zones.length ? zones : localZones;
      if (mergedZones.length && mergedZones !== localZones) {
        await AsyncStorage.setItem(
          BLE_ZONES_LS_KEY,
          JSON.stringify({ companyId, savedAt: Date.now(), zones: mergedZones }),
        );
      }
      return {
        markers: localMarkers,
        zones: mergedZones,
        meta,
        raw: photoRaw.length ? photoRaw : [],
        photoRaw,
        apiRefreshFailed: true,
        fetchDetail: fetchDetail || "API вернул метки без координат",
        didRefresh: false,
        statusLine,
        zonesDetail: zoneResult.detail,
      };
    }

    const meta = await saveOfflinePack(
      markers.length ? markers : localMarkers,
      zones.length ? zones : localZones,
      companyId,
      source,
    );
    return {
      markers: markers.length ? markers : localMarkers,
      zones: zones.length ? zones : localZones,
      meta,
      raw,
      photoRaw,
      apiRefreshFailed: !!apiFailed || !liveRefresh,
      fetchDetail,
      didRefresh,
      statusLine,
      zonesDetail: zoneResult.detail,
    };
  } catch (e) {
    const errDetail =
      getLastBleFetchDetail() || (e instanceof Error ? e.message : String(e));

    try {
      const offline = await fetchBleListOffline(companyId);
      if (offline?.raw.length) {
        const fromNetwork = markersFromRaw(offline.raw, localMarkers);
        const zoneResult = await loadZones(companyId, localZones);
        const zones = zoneResult.zones.length ? zoneResult.zones : localZones;
        const photoRaw = resolvePhotoRaw(offline.raw, fromNetwork, bundledFallback());
        const meta = await saveOfflinePack(
          fromNetwork,
          zones,
          companyId,
          "cache",
        );
        const statusLine = buildStatusLine({
          source: "cache",
          apiFailed: true,
          fetchDetail: errDetail,
          zonesDetail: zoneResult.detail,
          markerCount: fromNetwork.length,
          zoneCount: zones.length,
          fromApiZones: zoneResult.fromApi,
        });
        return {
          markers: fromNetwork,
          zones,
          meta,
          raw: offline.raw,
          photoRaw,
          apiRefreshFailed: true,
          fetchDetail: errDetail,
          didRefresh: fromNetwork.length > 0,
          statusLine,
          zonesDetail: zoneResult.detail,
        };
      }
    } catch {
      /* ignore */
    }

    if (localMarkers.length) {
      const meta = (await loadOfflineMeta()) ?? {
        companyId,
        savedAt: 0,
        markerCount: localMarkers.length,
        mappableCount: countMappableMarkers(localMarkers),
        zoneCount: localZones.length,
        fromNetwork: false,
        source: "local" as const,
      };
      const photoRaw = bundledFallback();
      const statusLine = buildStatusLine({
        source: meta.source ?? "local",
        apiFailed: true,
        fetchDetail: errDetail,
        zonesDetail: localZones.length ? `кэш ${localZones.length} зон` : "зоны не загружены",
        markerCount: localMarkers.length,
        zoneCount: localZones.length,
        fromApiZones: false,
      });
      return {
        markers: localMarkers,
        zones: localZones,
        meta,
        raw: [],
        photoRaw,
        apiRefreshFailed: true,
        fetchDetail: errDetail,
        didRefresh: false,
        statusLine,
      };
    }

    const bootstrap = await loadBootstrapRaw(companyId);
    if (bootstrap.raw.length) {
      const markers = markersFromRaw(bootstrap.raw, localMarkers);
      const meta = await saveOfflinePack(markers, localZones, companyId, "bundle");
      const statusLine = buildStatusLine({
        source: "bundle",
        apiFailed: true,
        fetchDetail: errDetail,
        zonesDetail: localZones.length ? `кэш ${localZones.length} зон` : "зоны не загружены",
        markerCount: markers.length,
        zoneCount: localZones.length,
        fromApiZones: false,
      });
      return {
        markers,
        zones: localZones,
        meta,
        raw: bootstrap.raw,
        photoRaw: bootstrap.raw,
        apiRefreshFailed: true,
        fetchDetail: errDetail,
        didRefresh: bootstrap.raw.length > 0,
        statusLine,
      };
    }

    throw e;
  }
}

export function buildStatusLine(opts: {
  source?: OfflineMeta["source"];
  apiFailed?: boolean;
  fetchDetail?: string;
  zonesDetail?: string;
  markerCount: number;
  zoneCount: number;
  routeCount?: number;
  fromApiZones?: boolean;
}): string {
  const parts: string[] = [];
  if (opts.source === "api" && !opts.apiFailed) {
    parts.push("Живой API");
  } else if (opts.source === "cache") {
    parts.push("Снимок сайта (API недоступен)");
  } else if (opts.source === "bundle") {
    parts.push("Офлайн-снимок APK");
  } else if (opts.source === "local") {
    parts.push("Локальный кэш");
  }
  parts.push(`${opts.markerCount} меток`);
  parts.push(`${opts.zoneCount} зон`);
  if (opts.routeCount != null) parts.push(`${opts.routeCount} маршрутов`);
  if (opts.zonesDetail) parts.push(opts.zonesDetail);
  if (opts.fetchDetail?.trim()) parts.push(opts.fetchDetail.trim());
  if (opts.apiFailed && opts.source === "cache") {
    parts.push("обходы/маршруты — от даты снимка");
  }
  return parts.join(" · ");
}

export function snapshotHint(
  source: OfflineMeta["source"],
  savedAt?: number,
  apiRefreshFailed?: boolean,
  fetchDetail?: string,
): string | null {
  if (source === "api" && !apiRefreshFailed) return null;
  const detail = fetchDetail?.trim();
  const detailSuffix = detail ? ` (${detail})` : "";
  const age =
    savedAt && savedAt > 0
      ? formatBundleAge(new Date(savedAt).toISOString())
      : "";
  if (source === "api" && apiRefreshFailed) {
    const workerHint = detail?.includes("supabase_500")
      ? " Supabase-прокси не отдаёт список меток — нужен worker или VPN."
      : detail?.includes("worker_")
        ? " Worker (*.workers.dev) недоступен с Wi‑Fi объекта."
        : "";
    return `Обновление с сервера не удалось — показан последний кэш.${workerHint}${detailSuffix}`;
  }
  if (source !== "bundle" && source !== "cache" && source !== "local") return null;
  if (source === "bundle") {
    const base = age
      ? `Офлайн-снимок от ${age}.`
      : "Офлайн-снимок меток.";
    return apiRefreshFailed
      ? `${base} Не удалось обновить с API — нажмите ↻.${detailSuffix}`
      : `${base} Обновите ↻ на объекте.`;
  }
  if (source === "cache") {
    return apiRefreshFailed
      ? `Живой API недоступен — загружен снимок сайта.${detailSuffix}`
      : age
        ? `Кэш от ${age}.`
        : "Кэш меток.";
  }
  return age ? `Офлайн — локальный кэш от ${age}.` : "Офлайн — локальный кэш.";
}

/** Быстрые зоны из map_data без отдельных запросов (если API вернёт). */
export function zonesFromRawPayload(raw: unknown): BleZone[] {
  if (!raw || typeof raw !== "object") return [];
  return parseZonesFromMapPayload(raw as { zones?: [] });
}

/** Bootstrap как loadBleMap в ble-map.js: локальный кэш → github/supabase → bundled. */
export async function loadImmediateBootstrap(
  companyId = BLE_DEFAULT_COMPANY_ID,
): Promise<{
  markers: BleTagMarker[];
  zones: BleZone[];
  source: OfflineMeta["source"];
}> {
  const localZones = await loadOfflineZones(companyId);
  const localMarkers = await loadOfflineMarkers();
  if (localMarkers.length) {
    return { markers: localMarkers, zones: localZones, source: "local" };
  }

  try {
    const offline = await fetchBleListOffline(companyId);
    if (offline?.raw.length) {
      return {
        markers: markersFromRaw(offline.raw, []),
        zones: localZones,
        source: "cache",
      };
    }
  } catch {
    /* ignore */
  }

  const bundled = loadBundledBleCache(companyId);
  if (bundled?.raw.length) {
    return {
      markers: markersFromRaw(bundled.raw, []),
      zones: localZones,
      source: "bundle",
    };
  }
  return { markers: [], zones: localZones, source: "local" };
}
