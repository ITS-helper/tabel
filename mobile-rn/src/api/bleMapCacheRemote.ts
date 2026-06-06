import type { RawBlePoint } from "../ble/types";
import {
  BLE_REMOTE_CACHE_TIMEOUT_MS,
  BLE_REMOTE_CACHE_URLS,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "../config";

/**
 * Свежий снимок меток с github.io (как сайт берёт data/ble-map-cache.json).
 * Работает на сети объекта, где worker (*.workers.dev) заблокирован.
 */
export async function fetchBleMapCacheFromGithub(
  companyId: number,
): Promise<{ raw: RawBlePoint[]; updatedAt: string } | null> {
  for (const url of BLE_REMOTE_CACHE_URLS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), BLE_REMOTE_CACHE_TIMEOUT_MS);
    try {
      const res = await fetch(`${url}?t=${Date.now()}`, {
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        signal: ctrl.signal,
      });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        company_id?: number;
        companyId?: number;
        updated_at?: string;
        updatedAt?: string;
        payload?: RawBlePoint[];
      };
      const cid = body.company_id ?? body.companyId;
      if (companyId != null && cid != null && Number(cid) !== Number(companyId)) {
        continue;
      }
      const payload = body.payload;
      if (!Array.isArray(payload) || !payload.length) continue;
      return { raw: payload, updatedAt: body.updated_at ?? body.updatedAt ?? "" };
    } catch {
      /* пробуем следующий URL */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Как fetchBleListOffline в ble-map.js: github.io → Supabase REST. */
export async function fetchBleListOffline(
  companyId: number,
): Promise<{ raw: RawBlePoint[]; updatedAt: string } | null> {
  const fromSite = await fetchBleMapCacheFromGithub(companyId);
  if (fromSite?.raw.length) {
    return { raw: fromSite.raw, updatedAt: fromSite.updatedAt };
  }
  const fromDb = await fetchBleMapCacheFromSupabase(companyId);
  if (fromDb?.raw.length) {
    return { raw: fromDb.raw, updatedAt: fromDb.updatedAt };
  }
  return null;
}

/** Кэш из Supabase REST (как fetchBleListCached в ble-map.js). */
export async function fetchBleMapCacheFromSupabase(
  companyId: number,
): Promise<{ raw: RawBlePoint[]; updatedAt: string } | null> {
  const url = `${SUPABASE_URL}/rest/v1/ble_map_cache?company_id=eq.${companyId}&select=payload,updated_at`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BLE_REMOTE_CACHE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{
      payload?: RawBlePoint[];
      updated_at?: string;
    }>;
    if (!rows?.length || !Array.isArray(rows[0].payload) || !rows[0].payload.length) {
      return null;
    }
    return { raw: rows[0].payload, updatedAt: rows[0].updated_at ?? "" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
