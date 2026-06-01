/**
 * Эндпоинты WW Service (libapp.so v1.0.32, BleDataService / map_ble.dart).
 * @see scripts/extract-apk-strings.mjs dist/incoming/ww_extract/lib/arm64-v8a/libapp.so
 */
export const WW_MOBILE_AUTH_PATH = "/mobile/v1/auth/login";
export const WW_BLE_LIST_PATH = "/api/v1/ble";
export const WW_BLE_INSPECTION_PHOTO_PATH = "/api/v1/ble_inspection_w_photo";

/** Auth и список — только backend (proxy.backend: SSL CN=backend.vsm, Android отклоняет). */
export const WW_CORPORATE_TRANSPORTS = ["backend"] as const;

/** Список меток WW Service — GET /api/v1/ble?page=N */
export const WW_BLE_LIST_TRANSPORTS = ["backend"] as const;

/** map/ble, зоны — backend, затем cloud */
export const WW_MAP_TRANSPORTS = ["backend", "supabase", "worker"] as const;

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

export function isBleListPagePath(path: string): boolean {
  return path.includes(`${WW_BLE_LIST_PATH}?page=`);
}

export function isMapApiPath(path: string): boolean {
  if (isBleListPagePath(path)) return false;
  return MAP_CLOUD_PATH_MARKERS.some((p) => path.includes(p));
}
