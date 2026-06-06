/** Утилиты URL фото — как pickFirstUrl / collectPhotoUrlsFromRaw в ble-map.js */
import type { RawBlePoint } from "../ble/types";
import { BLE_SUPABASE_BASE, SUPABASE_PUBLISHABLE_KEY } from "../config";

const TAG_KEYS = ["ble_image_url", "bleImageUrl", "ble_image"] as const;
const PLACE_KEYS = [
  "location_image_url",
  "locationImageUrl",
  "location_image",
] as const;

export function pickFirstUrl(
  point: Record<string, unknown>,
  keys: readonly string[],
): string {
  for (const k of keys) {
    const v = point[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function isPhotoUrlExpired(url: string): boolean {
  if (!url) return true;
  const dateM = String(url).match(/[?&]X-Amz-Date=([^&]+)/);
  const expM = String(url).match(/[?&]X-Amz-Expires=(\d+)/);
  if (dateM && expM) {
    const d = dateM[1];
    const t0 = Date.UTC(
      +d.slice(0, 4),
      +d.slice(4, 6) - 1,
      +d.slice(6, 8),
      +d.slice(9, 11),
      +d.slice(11, 13),
      +d.slice(13, 15),
    );
    return Date.now() > t0 + parseInt(expM[1], 10) * 1000;
  }
  const m = url.match(/[?&]Expires=(\d+)/i);
  if (!m) return false;
  return Date.now() > Number(m[1]) * 1000;
}

export function resolvePhotoUrl(
  rawPoint: RawBlePoint,
  keys: readonly string[],
  prevUrl?: string,
): string {
  const row = rawPoint as Record<string, unknown>;
  const fromApi = pickFirstUrl(row, keys);
  if (fromApi && !isPhotoUrlExpired(fromApi)) return fromApi;
  if (prevUrl && !isPhotoUrlExpired(prevUrl)) return prevUrl;
  if (fromApi) return fromApi;
  if (prevUrl) return prevUrl;
  return "";
}

export function collectPhotoUrlsFromRaw(
  raw: RawBlePoint[],
  opts: { tagOnly?: boolean; allowExpired?: boolean } = {},
): string[] {
  const tagOnly = !!opts.tagOnly;
  const allowExpired = !!opts.allowExpired;
  const urls = new Set<string>();
  for (const p of raw) {
    const row = p as Record<string, unknown>;
    const tag = pickFirstUrl(row, TAG_KEYS);
    if (tag && (allowExpired || !isPhotoUrlExpired(tag))) urls.add(tag);
    if (!tagOnly) {
      const place = pickFirstUrl(row, PLACE_KEYS);
      if (place && (allowExpired || !isPhotoUrlExpired(place))) urls.add(place);
    }
  }
  return [...urls];
}

export function photoUrlPathnameKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.toLowerCase();
  } catch {
    return url.split("?")[0].toLowerCase();
  }
}

export function isYandexPhotoUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes("storage.yandexcloud.net");
  } catch {
    return false;
  }
}

/** Прокси через Supabase Edge (ble-map.js → /ble-image). */
export function toBlePhotoProxyUrl(url: string): string {
  if (!url || !isYandexPhotoUrl(url)) return url;
  const proxy = new URL(BLE_SUPABASE_BASE);
  proxy.searchParams.set("path", "/ble-image");
  proxy.searchParams.set("url", url);
  proxy.searchParams.set("apikey", SUPABASE_PUBLISHABLE_KEY);
  return proxy.toString();
}
