/**
 * Эндпоинты WW Service (libapp.so v1.0.32, BleDataService / map_ble.dart).
 * @see scripts/extract-apk-strings.mjs dist/incoming/ww_extract/lib/arm64-v8a/libapp.so
 */
export const WW_MOBILE_AUTH_PATH = "/mobile/v1/auth/login";
export const WW_BLE_LIST_PATH = "/api/v1/ble";
export const WW_BLE_INSPECTION_PHOTO_PATH = "/api/v1/ble_inspection_w_photo";

/** backend на объекте; worker/supabase — с интернетом (ble-map.js). proxy.backend — SSL mismatch. */
export const WW_API_TRANSPORTS = ["backend", "worker", "supabase"] as const;

export type WwTransport = (typeof WW_API_TRANSPORTS)[number];

/** @deprecated alias */
export const WW_CORPORATE_TRANSPORTS = WW_API_TRANSPORTS;
export const WW_BLE_LIST_TRANSPORTS = WW_API_TRANSPORTS;
export const WW_MAP_TRANSPORTS = WW_API_TRANSPORTS;

/** Пути, для которых нужен полный map API (coords, zones, photos). */
export const MAP_CLOUD_PATH_MARKERS = [
  "/api/v1/map/ble/",
  "/api/v1/map/",
  "/map_data",
  "/api/v1/ble_zone/",
  "/api/v1/ble/route",
] as const;

export function isBleListPagePath(path: string): boolean {
  return path.includes(`${WW_BLE_LIST_PATH}?page=`);
}

export function isMapApiPath(path: string): boolean {
  if (isBleListPagePath(path)) return false;
  return MAP_CLOUD_PATH_MARKERS.some((p) => path.includes(p));
}
