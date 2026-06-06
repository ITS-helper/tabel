/**
 * Живое обновление меток — как retryBleMapRefresh + refreshBleMapFromApi в ble-map.js.
 */
import {
  extractMapBleRaw,
  fetchBleMapLive,
  getLastBleFetchDetail,
  normalizeWorkerBlePoint,
  type BleMapFetchChannel,
} from "../api/bleMapApi";
import { ensureBleTokenForField } from "../api/bleClient";
import { fetchBleListOffline } from "../api/bleMapCacheRemote";
import type { RawBlePoint } from "../ble/types";
import type { OfflineMeta } from "./offlineCache";

export type LiveRawLoadResult = {
  raw: RawBlePoint[];
  source: OfflineMeta["source"];
  channel: BleMapFetchChannel;
  apiFailed?: boolean;
  fetchDetail?: string;
};

function cacheResult(
  raw: RawBlePoint[],
  channel: BleMapFetchChannel,
  updatedAt: string,
  reason: string,
): LiveRawLoadResult {
  return {
    raw,
    source: "cache",
    channel,
    apiFailed: true,
    fetchDetail: `${reason} · снимок ${updatedAt || "offline"}`,
  };
}

/** Как retryBleMapRefresh → refreshBleMapFromApi / refreshBleMapFromCacheSnapshot. */
export async function loadRawMarkers(companyId: number): Promise<LiveRawLoadResult> {
  if (!(await ensureBleTokenForField())) {
    const offline = await fetchBleListOffline(companyId);
    if (offline?.raw.length) {
      return cacheResult(offline.raw, "github_cache", offline.updatedAt, "нет auth");
    }
    throw new Error("auto_auth_failed · нет снимка меток");
  }

  try {
    const live = await fetchBleMapLive(companyId);
    const raw = live.raw.map(normalizeWorkerBlePoint);
    if (!raw.length) {
      throw new Error("map_ble пустой");
    }
    return {
      raw,
      source: "api",
      channel: live.channel,
      apiFailed: false,
      fetchDetail: `API ${raw.length} меток`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const offline = await fetchBleListOffline(companyId);
    if (offline?.raw.length) {
      return cacheResult(offline.raw, "github_cache", offline.updatedAt, msg);
    }
    throw new Error(`${msg} · ${getLastBleFetchDetail() || "нет снимка"}`);
  }
}

export { extractMapBleRaw };
