import type { BleRoute, BleTagMarker, BleZone, RawBlePoint } from "../ble/types";
import { BLE_DEFAULT_COMPANY_ID } from "../config";
import { coordsFromRaw } from "../storage/markerNormalize";
import { resolvePhotoUrl } from "./photoUtils";
import { bleApiFetch, ensureBleTokenForField } from "./bleClient";
import { WW_BLE_LIST_PATH } from "./wwServiceEndpoints";

const WW_BLE_PAGE_MAX = 120;

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
  const row = point as Record<string, unknown>;

  return {
    id: point.id,
    ble: String(point.ble_number ?? row.bleNumber ?? ""),
    title: point.name_extended || String(row.nameExtended ?? row.name ?? ""),
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
    routeId: point.bleRoute?.id ?? (row.bleRouteId as number | undefined) ?? null,
    routeTitle: point.bleRoute?.title || String(row.bleRouteTitle ?? ""),
    zoneId: point.ble_zone_id ?? point.ble_zoneId ?? (row.bleZoneId as number | undefined) ?? null,
  };
}

function extractBlePageItems(data: unknown): RawBlePoint[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  for (const key of ["items", "content", "results"]) {
    if (Array.isArray(o[key])) return o[key] as RawBlePoint[];
  }
  if (Array.isArray(o.data)) return o.data as RawBlePoint[];
  if (o.data && typeof o.data === "object") {
    const nested = o.data as Record<string, unknown>;
    for (const key of ["items", "content", "results"]) {
      if (Array.isArray(nested[key])) return nested[key] as RawBlePoint[];
    }
  }
  return [];
}

function pageHasNext(data: unknown, page: number, batchLen: number): boolean {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  if (typeof o.hasNextPage === "boolean") return o.hasNextPage;
  if (typeof o.hasNext === "boolean") return o.hasNext;
  if (typeof o.totalPages === "number") return page < o.totalPages;
  if (typeof o.last === "boolean") return !o.last;
  return batchLen >= 50;
}

/** WW Service: GET /api/v1/ble?page=N (BleDataService.getAllBleTags). */
export async function fetchAllBlePaginated(): Promise<RawBlePoint[]> {
  await ensureBleTokenForField();
  const all: RawBlePoint[] = [];
  let page = 1;
  while (page <= WW_BLE_PAGE_MAX) {
    const data = await bleApiFetch<unknown>(`${WW_BLE_LIST_PATH}?page=${page}`);
    const batch = extractBlePageItems(data);
    if (!batch.length) break;
    all.push(...batch);
    if (!pageHasNext(data, page, batch.length)) break;
    page += 1;
  }
  return all;
}

export async function fetchBleMapRaw(
  companyId = BLE_DEFAULT_COMPANY_ID,
): Promise<RawBlePoint[]> {
  await ensureBleTokenForField();

  try {
    const paginated = await fetchAllBlePaginated();
    if (paginated.length) return paginated;
  } catch (e) {
    console.warn("[bleMapApi] WW paginated /api/v1/ble failed", e);
  }

  try {
    const raw = await bleApiFetch<RawBlePoint[]>(`/api/v1/map/ble/${companyId}`);
    if (Array.isArray(raw) && raw.length) return raw;
  } catch (e) {
    console.warn("[bleMapApi] /api/v1/map/ble fallback failed", e);
  }

  return [];
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
