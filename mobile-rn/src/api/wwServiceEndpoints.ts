/**
 * Эндпоинты WW Service (libapp.so v1.0.32, BleDataService / map_ble.dart).
 * @see scripts/extract-apk-strings.mjs dist/incoming/ww_extract/lib/arm64-v8a/libapp.so
 */
export const WW_MOBILE_AUTH_PATH = "/mobile/v1/auth/login";
export const WW_BLE_LIST_PATH = "/api/v1/ble";
export const WW_BLE_INSPECTION_PHOTO_PATH = "/api/v1/ble_inspection_w_photo";

/** RN: только корпоративный контур, без workers.dev / supabase Edge. */
export const WW_NATIVE_TRANSPORTS = ["backend", "proxy"] as const;

export type WwNativeTransport = (typeof WW_NATIVE_TRANSPORTS)[number];
