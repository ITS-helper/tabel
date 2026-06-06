/**
 * Эндпоинты WW Service — порядок каналов как isBleNativeApp() в ble-map.js (Capacitor APK).
 */
export const WW_MOBILE_AUTH_PATH = "/mobile/v1/auth/login";
export const WW_BLE_LIST_PATH = "/api/v1/ble";
export const WW_BLE_INSPECTION_PHOTO_PATH = "/api/v1/ble_inspection_w_photo";

export const BLE_CLOUD_TRANSPORTS = ["worker", "supabase"] as const;
export const BLE_SITE_TRANSPORTS = ["worker", "supabase"] as const;
export type WwTransport = (typeof BLE_CLOUD_TRANSPORTS)[number];
export const WW_API_TRANSPORTS = BLE_SITE_TRANSPORTS;

export const BLE_WORKER_ONLY_PATHS = ["/api/v1/map/ble/"] as const;
export const BLE_WORKER_PREFERRED_PATHS = ["/api/v1/ble_zone", "/api/v1/ble/route"] as const;

export const MAP_CLOUD_PATH_MARKERS = [
  "/api/v1/map/ble/",
  "/api/v1/map/",
  "/map_data",
  "/api/v1/ble_zone/",
  "/api/v1/ble/route",
  "/api/v2/ble_inspection",
  "/api/v1/ble_inspection",
] as const;

export function isBleListPagePath(path: string): boolean {
  return path.includes(`${WW_BLE_LIST_PATH}?page=`);
}

export function isMapDataBlePath(path: string): boolean {
  return path.includes("/map_data");
}

export function isWorkerOnlyBlePath(path: string): boolean {
  return BLE_WORKER_ONLY_PATHS.some(
    (prefix) => path === prefix || path.startsWith(prefix),
  );
}

export function isWorkerPreferredBlePath(path: string): boolean {
  return BLE_WORKER_PREFERRED_PATHS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function isMapApiPath(path: string): boolean {
  if (isBleListPagePath(path)) return false;
  return MAP_CLOUD_PATH_MARKERS.some((p) => path.includes(p));
}

export function isInspectionPath(path: string): boolean {
  return path.includes("/ble_inspection");
}

export function isMutationPath(path: string, method?: string): boolean {
  const m = (method || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD") return false;
  return isInspectionPath(path) || /\/api\/v1\/ble\/\d+/.test(path);
}

export function isHeavyBleListGetPath(path: string, method?: string): boolean {
  const m = (method || "GET").toUpperCase();
  if (m !== "GET" && m !== "HEAD") return false;
  return isWorkerOnlyBlePath(path) || isBleListPagePath(path);
}

export function isWorkerOnlyGetPath(path: string, method?: string): boolean {
  const m = (method || "GET").toUpperCase();
  if (m !== "GET" && m !== "HEAD") return false;
  if (isHeavyBleListGetPath(path, method)) return true;
  if (isMapDataBlePath(path)) return true;
  if (isWorkerPreferredBlePath(path)) return true;
  if (path.includes("/api/v1/map/") && !path.includes("/api/v1/ble/route")) return true;
  return false;
}

/** Capacitor native (isBleNativeApp): worker → supabase для map/ble и map_data. */
export function transportOrderForPath(path: string, method?: string): WwTransport[] {
  if (path.includes("/token") || path.includes(WW_MOBILE_AUTH_PATH)) {
    return ["supabase", "worker"];
  }
  if (isMutationPath(path, method) || isInspectionPath(path)) {
    return ["worker", "supabase"];
  }
  if (isWorkerOnlyBlePath(path)) {
    return ["worker", "supabase"];
  }
  if (isWorkerPreferredBlePath(path) || isMapDataBlePath(path)) {
    return ["worker", "supabase"];
  }
  return ["supabase", "worker"];
}
