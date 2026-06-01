import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
  classifyBle,
  fetchBleMapRaw,
  parseZonesFromMapPayload,
} from "../api/bleMapApi";
import { formatBundleAge, loadBundledBleCache } from "../api/bleMapCacheBundle";
import { loadBleZonesFull } from "../api/zonesLoader";
import type { BleTagMarker, BleZone, RawBlePoint } from "../ble/types";
import {
  BLE_DEFAULT_COMPANY_ID,
  BLE_OFFLINE_MARKERS_KEY,
  BLE_OFFLINE_META_KEY,
  BLE_ZONES_LS_KEY,
} from "../config";
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

export async function isOnline(): Promise<boolean> {
  const s = await NetInfo.fetch();
  return s.isConnected === true && s.isInternetReachable !== false;
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

function markersFromRaw(raw: RawBlePoint[]): BleTagMarker[] {
  return normalizeBleMarkers(
    raw.map((p) => classifyBle(p)).filter((m) => m.lat != null && m.lng != null),
  );
}

async function loadRawMarkers(companyId: number): Promise<{
  raw: RawBlePoint[];
  source: OfflineMeta["source"];
  snapshotAt?: string;
}> {
  try {
    const raw = await fetchBleMapRaw(companyId);
    if (raw.length) return { raw, source: "api" };
  } catch {
    /* bundled snapshot */
  }

  const bundled = loadBundledBleCache(companyId);
  if (bundled?.raw.length) {
    return { raw: bundled.raw, source: "bundle", snapshotAt: bundled.updatedAt };
  }

  throw new Error(
    "Нет связи с backend.vsm.workwatch.pro. Проверьте Wi‑Fi на объекте и нажмите ↻.",
  );
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
}> {
  const localMarkers = await loadOfflineMarkers();
  const localZones = await loadOfflineZones(companyId);
  const online = await isOnline();

  if (!online) {
    if (!localMarkers.length) {
      const bundled = loadBundledBleCache(companyId);
      if (bundled?.raw.length) {
        const markers = markersFromRaw(bundled.raw);
        const meta = await saveOfflinePack(markers, localZones, companyId, "bundle");
        return { markers, zones: localZones, meta, raw: bundled.raw };
      }
    }
    const meta = (await loadOfflineMeta()) ?? {
      companyId,
      savedAt: 0,
      markerCount: localMarkers.length,
      mappableCount: countMappableMarkers(localMarkers),
      zoneCount: localZones.length,
      fromNetwork: false,
      source: "local" as const,
    };
    return { markers: localMarkers, zones: localZones, meta, raw: [] };
  }

  try {
    const { raw, source } = await loadRawMarkers(companyId);
    const markers = markersFromRaw(raw);
    const zones = await loadZones(companyId, localZones);

    if (!markers.length && localMarkers.length > 0) {
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
        raw: raw.some((p) => p.ble_image_url || p.location_image_url) ? raw : [],
      };
    }

    const meta = await saveOfflinePack(markers, zones, companyId, source);
    return { markers, zones, meta, raw };
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
      return { markers: localMarkers, zones: localZones, meta, raw: [] };
    }
    throw e;
  }
}

export function snapshotHint(source: OfflineMeta["source"], savedAt?: number): string | null {
  if (source !== "bundle" && source !== "cache" && source !== "local") return null;
  const age =
    savedAt && savedAt > 0
      ? formatBundleAge(new Date(savedAt).toISOString())
      : "";
  if (source === "bundle") {
    return age
      ? `Офлайн-снимок от ${age}. Обновите ↻ на объекте.`
      : "Офлайн-снимок меток. Обновите ↻ на объекте.";
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
