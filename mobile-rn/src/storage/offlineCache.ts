import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
  classifyBle,
  fetchBleMapRaw,
  fetchBleZoneDetail,
  parseZonesFromMapPayload,
} from "../api/bleMapApi";
import type { BleTagMarker, BleZone } from "../ble/types";
import {
  BLE_DEFAULT_COMPANY_ID,
  BLE_OFFLINE_MARKERS_KEY,
  BLE_OFFLINE_META_KEY,
  BLE_ZONES_LS_KEY,
} from "../config";

export type OfflineMeta = {
  companyId: number;
  savedAt: number;
  markerCount: number;
  zoneCount: number;
  fromNetwork: boolean;
};

export async function isOnline(): Promise<boolean> {
  const s = await NetInfo.fetch();
  return s.isConnected === true && s.isInternetReachable !== false;
}

export async function loadOfflineMarkers(): Promise<BleTagMarker[]> {
  const raw = await AsyncStorage.getItem(BLE_OFFLINE_MARKERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as BleTagMarker[];
    return Array.isArray(parsed) ? parsed : [];
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
): Promise<OfflineMeta> {
  await AsyncStorage.setItem(BLE_OFFLINE_MARKERS_KEY, JSON.stringify(markers));
  await AsyncStorage.setItem(
    BLE_ZONES_LS_KEY,
    JSON.stringify({ companyId, savedAt: Date.now(), zones }),
  );
  const meta: OfflineMeta = {
    companyId,
    savedAt: Date.now(),
    markerCount: markers.length,
    zoneCount: zones.length,
    fromNetwork: true,
  };
  await AsyncStorage.setItem(BLE_OFFLINE_META_KEY, JSON.stringify(meta));
  return meta;
}

export async function syncOfflinePack(
  companyId = BLE_DEFAULT_COMPANY_ID,
): Promise<{ markers: BleTagMarker[]; zones: BleZone[]; meta: OfflineMeta }> {
  const online = await isOnline();
  if (!online) {
    const markers = await loadOfflineMarkers();
    const zones = await loadOfflineZones(companyId);
    const meta = (await loadOfflineMeta()) ?? {
      companyId,
      savedAt: 0,
      markerCount: markers.length,
      zoneCount: zones.length,
      fromNetwork: false,
    };
    return { markers, zones, meta };
  }

  const raw = await fetchBleMapRaw(companyId);
  const withCoords = raw
    .map((p) => classifyBle(p))
    .filter((m) => m.lat != null && m.lng != null);

  const zoneIds = [
    ...new Set(withCoords.map((m) => m.zoneId).filter((id): id is number => id != null)),
  ];
  const loadedZones: BleZone[] = [];
  for (const id of zoneIds.slice(0, 48)) {
    try {
      const pts = await fetchBleZoneDetail(id);
      if (pts.length >= 3) {
        loadedZones.push({
          id,
          name: `Зона ${id}`,
          description: "",
          color: "#0088cc",
          pts,
          ptsSource: "api",
        });
      }
    } catch {
      /* skip */
    }
  }

  const meta = await saveOfflinePack(withCoords, loadedZones, companyId);
  return { markers: withCoords, zones: loadedZones, meta };
}

/** Быстрые зоны из map_data без отдельных запросов (если API вернёт). */
export function zonesFromRawPayload(raw: unknown): BleZone[] {
  if (!raw || typeof raw !== "object") return [];
  return parseZonesFromMapPayload(raw as { zones?: [] });
}
