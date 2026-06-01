/**
 * Эндпоинты WW Service (libapp.so v1.0.32, BleDataService / map_ble.dart).
 * Worker — прямой канал; Supabase Edge — fallback для auth/POST и мелких GET.
 * Тяжёлые GET (список меток) через Edge на проде дают HTTP 500 (старый деплoy без буферизации).
 */
export const WW_MOBILE_AUTH_PATH = "/mobile/v1/auth/login";
export const WW_BLE_LIST_PATH = "/api/v1/ble";
export const WW_BLE_INSPECTION_PHOTO_PATH = "/api/v1/ble_inspection_w_photo";

/** Облачные каналы (Capacitor / ble-map.js). */
export const BLE_CLOUD_TRANSPORTS = ["worker", "supabase"] as const;

/** @deprecated backend.vsm не обслуживает BLE REST — оставлено для совместимости типов */
export const BLE_SITE_TRANSPORTS = ["worker", "supabase"] as const;

export type WwTransport = (typeof BLE_CLOUD_TRANSPORTS)[number];

/** @deprecated */
export const WW_API_TRANSPORTS = BLE_SITE_TRANSPORTS;

export const BLE_WORKER_ONLY_PATHS = ["/api/v1/map/ble/"] as const;

export const BLE_WORKER_PREFERRED_PATHS = ["/api/v1/ble_zone"] as const;

/** Пути, для которых нужен полный map API (coords, zones, photos). */
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

/** GET со списком меток — Edge ble-map-proxy на проде отдаёт 500 (не задеплоена буферизация). */
export function isHeavyBleListGetPath(path: string, method?: string): boolean {
  const m = (method || "GET").toUpperCase();
  if (m !== "GET" && m !== "HEAD") return false;
  return isWorkerOnlyBlePath(path) || isBleListPagePath(path);
}

/** GET карты/зон — тоже только worker (Edge ломается на ответах > ~1 КБ). */
export function isWorkerOnlyGetPath(path: string, method?: string): boolean {
  const m = (method || "GET").toUpperCase();
  if (m !== "GET" && m !== "HEAD") return false;
  if (isHeavyBleListGetPath(path, method)) return true;
  if (isMapDataBlePath(path)) return true;
  if (isWorkerPreferredBlePath(path)) return true;
  if (path.includes("/api/v1/map/") && !path.includes("/api/v1/ble/route")) return true;
  return false;
}

/** Порядок каналов для RN на объекте (Wi‑Fi без VPN). */
export function transportOrderForPath(path: string, method?: string): WwTransport[] {
  if (path.includes("/token") || path.includes(WW_MOBILE_AUTH_PATH)) {
    return ["supabase", "worker"];
  }
  if (isMutationPath(path, method) || isInspectionPath(path)) {
    return ["supabase", "worker"];
  }
  if (isWorkerOnlyGetPath(path, method)) {
    return ["worker"];
  }
  if (path.includes("/api/v1/ble/route")) {
    return ["worker", "supabase"];
  }
  return ["worker", "supabase"];
}
