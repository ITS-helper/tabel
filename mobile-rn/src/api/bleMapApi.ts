import type { BleRoute, BleTagMarker, BleZone, RawBlePoint } from "../ble/types";
import { BLE_DEFAULT_COMPANY_ID, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config";
import { coordsFromRaw } from "../storage/markerNormalize";
import { resolvePhotoUrl } from "./photoUtils";
import { bleApiFetch, ensureBleTokenForField } from "./bleClient";

function supabaseHeaders(): HeadersInit {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    Accept: "application/json",
  };
}

export function classifyBle(point: RawBlePoint, prev?: BleTagMarker): BleTagMarker {
  const LOW = 15;
  const inspectionDays = 1;
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  let isInspected = false;
  let recordDt = "Не обходилась";
  if (point.record_dt) {
    const d = new Date(point.record_dt);
    const inspDate = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
    isInspected = (today.getTime() - inspDate.getTime()) / 86_400_000 <= inspectionDays;
    recordDt = inspDate.toISOString().slice(0, 10);
  }
  const charge = point.charge_value ?? prev?.charge ?? null;
  const isLowBattery = charge != null && charge <= LOW;
  let status: BleTagMarker["status"] = "ok";
  if (isLowBattery) status = "battery";
  else if (!isInspected) status = "inspection";

  const { lat, lng } = coordsFromRaw(point);

  return {
    id: point.id,
    ble: String(point.ble_number || ""),
    title: point.name_extended || "",
    lat,
    lng,
    charge,
    movabilityType: point.movability_type ?? 1,
    power: point.power ?? 6,
    frequency: point.frequency ?? 3,
    statusCode: point.status ?? 4,
    bleTypeNum: point.ble_type ?? null,
    firmwareVersion: point.firmware_version || point.hardware_version || "bt1",
    mac: point.mac_address || "",
    chipUuid: point.chip_uuid || "",
    isInspected,
    isLowBattery,
    recordDt,
    status,
    photoTag: resolvePhotoUrl(point, ["ble_image_url", "bleImageUrl", "ble_image"], prev?.photoTag),
    photoPlace: resolvePhotoUrl(
      point,
      ["location_image_url", "locationImageUrl", "location_image"],
      prev?.photoPlace,
    ),
    locationDesc: point.location_desc || "",
    bleTypeLabel: point.ble_type_desc || "",
    routeId: point.bleRoute?.id ?? null,
    routeTitle: point.bleRoute?.title || "",
    zoneId: point.ble_zone_id ?? point.ble_zoneId ?? null,
  };
}

export async function fetchBleMapRaw(
  companyId = BLE_DEFAULT_COMPANY_ID,
): Promise<RawBlePoint[]> {
  await ensureBleTokenForField();
  const raw = await bleApiFetch<RawBlePoint[]>(`/api/v1/map/ble/${companyId}`);
  return Array.isArray(raw) ? raw : [];
}

export async function fetchBleMapMarkers(
  companyId = BLE_DEFAULT_COMPANY_ID,
): Promise<BleTagMarker[]> {
  const raw = await fetchBleMapRaw(companyId);
  return raw.map((p) => classifyBle(p)).filter((m) => m.lat != null && m.lng != null);
}

export async function fetchBleRoutes(): Promise<BleRoute[]> {
  await ensureBleTokenForField();
  const data = await bleApiFetch<BleRoute[]>("/api/v1/ble/route");
  return Array.isArray(data) ? data : [];
}

function apiPointsToPts(points: unknown): [number, number][] {
  if (!Array.isArray(points)) return [];
  return points
    .map((p) => {
      const row = p as { latitude?: number; lat?: number; longitude?: number; lng?: number };
      const lat = Number(row.latitude ?? row.lat);
      const lng = Number(row.longitude ?? row.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lat, lng] as [number, number];
    })
    .filter(Boolean) as [number, number][];
}

export async function fetchBleZoneDetail(zoneId: number): Promise<[number, number][]> {
  const data = await bleApiFetch<{ points?: unknown }>(`/api/v1/ble_zone/${zoneId}`);
  return apiPointsToPts(data?.points);
}

export function parseZonesFromMapPayload(mapData: {
  zones?: Array<{
    id: number;
    name?: string;
    description?: string;
    color?: string;
    points?: unknown;
    deleted?: boolean;
  }>;
}): BleZone[] {
  if (!mapData?.zones?.length) return [];
  return mapData.zones
    .filter((z) => z?.id != null && !z.deleted)
    .map((z) => ({
      id: z.id,
      name: z.name || "",
      description: z.description || "",
      color: z.color || "#0088cc",
      pts: apiPointsToPts(z.points),
      ptsSource: "api" as const,
    }))
    .filter((z) => z.pts.length >= 3);
}

export async function fetchBleMapCache(
  companyId = BLE_DEFAULT_COMPANY_ID,
): Promise<RawBlePoint[] | null> {
  const url = `${SUPABASE_URL}/rest/v1/ble_map_cache?company_id=eq.${companyId}&select=payload,updated_at`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, { headers: supabaseHeaders(), signal: ctrl.signal });
    if (!res.ok) throw new Error(`Кэш карты: HTTP ${res.status}`);
    const rows = (await res.json()) as { payload?: RawBlePoint[] }[];
    const payload = rows[0]?.payload;
    return Array.isArray(payload) && payload.length ? payload : null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBleMapData(
  companyId = BLE_DEFAULT_COMPANY_ID,
): Promise<{ zones?: [] }> {
  await ensureBleTokenForField();
  return bleApiFetch<{ zones?: [] }>(`/api/v1/map/${companyId}/map_data`);
}

export async function fetchBleMapConfig(): Promise<{
  defaultView?: { latitude: number; longitude: number };
  defaultZoom?: number;
}> {
  await ensureBleTokenForField();
  return bleApiFetch("/api/v1/map/config");
}

export function buildInspectionBody(
  checkin: import("../ble/types").FieldCheckin,
  tag?: BleTagMarker | null,
) {
  const recordDt = checkin.checkedAt || new Date().toISOString();
  const bleNum = Number(tag?.ble ?? checkin.bleNumber ?? 0);
  return {
    bleId: tag?.id ?? checkin.ble_id ?? null,
    ble_number: bleNum,
    bleNumber: bleNum,
    mac_address: checkin.mac_address || tag?.mac || "",
    macAddress: checkin.mac_address || tag?.mac || "",
    latitude: tag?.lat ?? checkin.latitude ?? null,
    longitude: tag?.lng ?? checkin.longitude ?? null,
    movabilityType: tag?.movabilityType ?? checkin.movabilityType ?? 1,
    recordDt,
    chargeValue: checkin.chargeValue ?? tag?.charge ?? 100,
    status: tag?.statusCode ?? checkin.statusCode ?? 4,
    power: checkin.power ?? tag?.power ?? 6,
    frequency: checkin.frequency ?? tag?.frequency ?? 3,
    bleType: checkin.bleType ?? tag?.bleTypeNum ?? 10,
    firmwareVersion: tag?.firmwareVersion || checkin.firmwareVersion || "bt1",
    rssi: checkin.rssi ?? null,
  };
}
