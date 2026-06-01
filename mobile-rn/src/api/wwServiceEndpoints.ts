/**
 * Эндпоинты WW Service (libapp.so v1.0.32, BleDataService / map_ble.dart).
 * @see scripts/extract-apk-strings.mjs dist/incoming/ww_extract/lib/arm64-v8a/libapp.so
 */
export const WW_MOBILE_AUTH_PATH = "/mobile/v1/auth/login";
export const WW_BLE_LIST_PATH = "/api/v1/ble";
export const WW_BLE_INSPECTION_PHOTO_PATH = "/api/v1/ble_inspection_w_photo";

/** Auth и список обхода — только корпоративный контур. */
export const WW_CORPORATE_TRANSPORTS = ["backend", "proxy"] as const;

/** Карта/зоны/маршруты — сначала backend, затем cloud (как ble-map.js). */
export const WW_MAP_TRANSPORTS = ["backend", "proxy", "worker", "supabase"] as const;

export type WwCorporateTransport = (typeof WW_CORPORATE_TRANSPORTS)[number];
export type WwMapTransport = (typeof WW_MAP_TRANSPORTS)[number];

/** Пути, для которых нужен полный map API (coords, zones, photos). */
export const MAP_CLOUD_PATH_MARKERS = [
  "/api/v1/map/ble/",
  "/api/v1/map/",
  "/map_data",
  "/api/v1/ble_zone/",
  "/api/v1/ble/route",
] as const;

export function isMapApiPath(path: string): boolean {
  return MAP_CLOUD_PATH_MARKERS.some((p) => path.includes(p));
}
