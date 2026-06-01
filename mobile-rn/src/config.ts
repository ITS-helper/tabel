/** Конфиг API — auth через backend.vsm; map/zones через backend + cloud fallback. */
export const SUPABASE_URL = "https://owcuvcshwtivqueftiuk.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_zMRDhywx67zYK6SLGAyg-A_4KXV_Ujc";
/** Прямые хосты WW Service (libapp.so). */
export const BLE_BACKEND_BASE = "https://backend.vsm.workwatch.pro";
export const BLE_PROXY_BACKEND_BASE = "https://proxy.backend.vsm.workwatch.pro";
/** Только для веб ble-map.js — в RN не используется. */
export const BLE_WORKER_BASE =
  "https://raspy-sound-6f18.kejexu8hem1.workers.dev/proxy";
export const BLE_SUPABASE_BASE = `${SUPABASE_URL}/functions/v1/ble-map-proxy`;

export const BLE_DEFAULT_COMPANY_ID = 1;
export const APP_BUILD = "rn-20260601l";
export const APP_VERSION = "1.0.20";

export const BLE_AUTO_USER = "impl_dept";
export const BLE_AUTO_PASS = "impl_dept_vsm_2024";
export const BLE_TOKEN_KEY = "accessToken";

export const BLE_CLUSTER_TOGGLE_KEY = "ww-ble-cluster-enabled";
export const THEME_STORAGE_KEY = "ww-ble-rn-theme";
export const BLE_ZONES_LS_KEY = "ww-ble-zones-v2";
export const BLE_OFFLINE_MARKERS_KEY = "ww-ble-rn-offline-markers";
export const BLE_OFFLINE_META_KEY = "ww-ble-rn-offline-meta";
export const BLE_OFFLINE_MARKER_EDITS_KEY = "ww-ble-rn-offline-marker-edits";
export const BLE_MARKER_HOLD_MS = 1000;

export const GATT_BATTERY_SERVICE = "0000180f-0000-1000-8000-00805f9b34fb";
export const GATT_BATTERY_CHAR = "00002a19-0000-1000-8000-00805f9b34fb";
export const GATT_WW_SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb";
export const GATT_WW_READ_SUFFIXES = ["fff2", "fff3", "fff4", "fff5"] as const;

export const WW_MANUFACTURER_MAGIC = [0xa5, 0x08, 0x00, 0x01] as const;

export const CHECKINS_STORAGE_KEY = "ww-ble-field-checkins-v1";
export const FOUND_SOUND_COOLDOWN_MS = 10_000;
export const DAILY_KEEP_DAYS = 14;
export const LOW_BATTERY_PCT = 20;
export const NEARBY_TTL_MS = 20_000;

export const BLE_DEFAULT_CENTER_BLE = "7";
export const BLE_DEFAULT_CENTER_ZOOM = 18;
export const BLE_ZONE_NEON = "#00e5ff";
export const BLE_ZONE_NEON_FILL = "#66f0ff";
export const BLE_DOT_PX = 20;

/** Тот же слой спутника, что Leaflet + ArcGIS в ble-map.js */
export const ARCGIS_SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export function gattCharUuid(shortSuffix: string): string {
  const s = shortSuffix.replace(/^0x/i, "").toLowerCase().padStart(4, "0");
  return `0000${s}-0000-1000-8000-00805f9b34fb`;
}

export const ZONE_SHORT: Record<number, string> = {
  1: "Работы",
  2: "Столовая",
  3: "Опасная",
  4: "Курилка",
  5: "Отдых",
  6: "ВЖГ",
  7: "Туалет",
  8: "Остановка",
  9: "Админ",
  10: "WW",
  11: "Склад",
  12: "Мастерская",
  13: "КПП",
  14: "Стройгородок",
};
