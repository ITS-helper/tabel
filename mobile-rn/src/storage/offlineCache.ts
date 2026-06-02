import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
  classifyBle,
  fetchAllBlePaginated,
  fetchBleMapLive,
  getLastBleFetchDetail,
  normalizeWorkerBlePoint,
  parseZonesFromMapPayload,
  type BleMapFetchChannel,
} from "../api/bleMapApi";
import { bleAutoLogin } from "../api/bleClient";
import { formatBundleAge, loadBundledBleCache } from "../api/bleMapCacheBundle";
import { loadBleZonesFull } from "../api/zonesLoader";
import type { BleTagMarker, BleZone, RawBlePoint } from "../ble/types";
import {
  BLE_DEFAULT_COMPANY_ID,
  BLE_OFFLINE_MARKERS_KEY,
  BLE_OFFLINE_META_KEY,
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

/** Живой API: map/ble → paginated ble. Без github/снимков. */
async function loadRawMarkers(companyId: number): Promise<{
  raw: RawBlePoint[];
  source: OfflineMeta["source"];
  channel: BleMapFetchChannel;
  snapshotAt?: string;
  apiFailed?: boolean;
  fetchDetail?: string;
}> {
  let fetchDetail = "";
  try {
    await bleAutoLogin();
  } catch (e) {
    console.warn("[offlineCache] auth before live refresh", e);
  }

  const live = await fetchBleMapLive(companyId);
  fetchDetail = getLastBleFetchDetail();
  if (live.channel === "map_ble" && live.raw.length) {
    return {
      raw: live.raw,
      source: "api",
      channel: live.channel,
      apiFailed: false,
      fetchDetail,
    };
  }

  try {
    const paginated = await fetchAllBlePaginated();
    fetchDetail = getLastBleFetchDetail();
    if (paginated.length) {
      return {
        raw: paginated,
        source: "api",
        channel: "ble_page",
        apiFailed: false,
        fetchDetail,
      };
    }
  } catch (e) {
    fetchDetail = getLastBleFetchDetail() || (e instanceof Error ? e.message : "error");
    console.warn("[offlineCache] paginated ble failed", e);
  }

  const detail = fetchDetail || "нет ответа API";
  throw new Error(`Не удалось обновить с сервера (${detail}). Проверьте интернет.`);
}

async function loadZones(companyId: number, local: BleZone[]): Promise<BleZone[]> {
  return loadBleZonesFull(companyId, local);
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
}> {
  const localMarkers = await loadOfflineMarkers();
  const localZones = await loadOfflineZones(companyId);
  const bundledFallback = () => loadBundledBleCache(companyId)?.raw ?? [];

  // Capacitor всегда пробует API; NetInfo не блокирует refresh.
  try {
    const { raw, source, channel, apiFailed, fetchDetail } = await loadRawMarkers(companyId);
    const fromNetwork = raw.length ? markersFromRaw(raw, localMarkers) : [];
    const markers = fromNetwork.length ? fromNetwork : localMarkers;
    const zones = await loadZones(companyId, localZones);
    const photoRaw = resolvePhotoRaw(raw, markers, bundledFallback());
    const liveRefresh =
      (channel === "map_ble" || channel === "ble_page") &&
      fromNetwork.length > 0 &&
      !apiFailed;

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
    };
  } catch (e) {
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
      return {
        markers: localMarkers,
        zones: localZones,
        meta,
        raw: [],
        photoRaw,
        apiRefreshFailed: true,
        fetchDetail: getLastBleFetchDetail() || (e instanceof Error ? e.message : undefined),
      };
    }

    const bootstrap = await loadBootstrapRaw(companyId);
    if (bootstrap.raw.length) {
      const markers = markersFromRaw(bootstrap.raw);
      const meta = await saveOfflinePack(markers, localZones, companyId, "bundle");
      return {
        markers,
        zones: localZones,
        meta,
        raw: bootstrap.raw,
        photoRaw: bootstrap.raw,
        apiRefreshFailed: true,
        fetchDetail: getLastBleFetchDetail() || (e instanceof Error ? e.message : undefined),
      };
    }

    throw e;
  }
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
    return age ? `Кэш от ${age}.` : "Кэш меток.";
  }
  return age ? `Офлайн — локальный кэш от ${age}.` : "Офлайн — локальный кэш.";
}

/** Быстрые зоны из map_data без отдельных запросов (если API вернёт). */
export function zonesFromRawPayload(raw: unknown): BleZone[] {
  if (!raw || typeof raw !== "object") return [];
  return parseZonesFromMapPayload(raw as { zones?: [] });
}

/** Быстрый bootstrap для UI до сетевого refresh (как loadBleMap в ble-map.js). */
export async function loadImmediateBootstrap(
  companyId = BLE_DEFAULT_COMPANY_ID,
): Promise<{
  markers: BleTagMarker[];
  zones: BleZone[];
  source: OfflineMeta["source"];
}> {
  const localMarkers = await loadOfflineMarkers();
  const localZones = await loadOfflineZones(companyId);
  if (localMarkers.length) {
    return { markers: localMarkers, zones: localZones, source: "local" };
  }
  // Только синхронные источники — без сети, чтобы UI показал метки мгновенно.
  // Свежий снимок (github / Supabase / live) подтянет syncOfflinePack отдельно.
  const bundled = loadBundledBleCache(companyId);
  if (bundled?.raw.length) {
    return {
      markers: markersFromRaw(bundled.raw),
      zones: localZones,
      source: "bundle",
    };
  }
  return { markers: [], zones: localZones, source: "local" };
}
