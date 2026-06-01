import type { RawBlePoint } from "../ble/types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config";

/** Кэш из Supabase REST (как fetchBleListCached в ble-map.js). */
export async function fetchBleMapCacheFromSupabase(
  companyId: number,
): Promise<{ raw: RawBlePoint[]; updatedAt: string } | null> {
  const url = `${SUPABASE_URL}/rest/v1/ble_map_cache?company_id=eq.${companyId}&select=payload,updated_at`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
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
}
