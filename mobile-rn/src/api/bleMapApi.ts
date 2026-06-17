import type { BleRoute, BleTagMarker, BleZone, RawBlePoint } from "../ble/types";
import {
  resolveZoneTypeFromRawPoint,
  inspectionBleTypeFromTag,
  inspectionFrequencyFromTag,
  inspectionPowerFromTag,
} from "../ble/zoneType";
import { normalizeBle } from "../ble/wwAdvert";
import { BLE_DEFAULT_COMPANY_ID } from "../config";
import { coordsFromRaw } from "../storage/markerNormalize";
import { resolvePhotoUrl } from "./photoUtils";
import {
  bleApiFetch,
  type BleHttpOptions,
} from "./bleClient";
import { WW_BLE_LIST_PATH } from "./wwServiceEndpoints";

const WW_BLE_PAGE_MAX = 120;

/** API v2 ble_inspection: movabilityType только 1 | 2 | 3 (маяки v4 в поле часто приходят как 4). */
export function clampInspectionMovabilityType(v: unknown): 1 | 2 | 3 {
  const n = Number(v);
  if (n === 2 || n === 3) return n;
  return 1;
}

function rawPointId(point: RawBlePoint): number | undefined {
  const row = point as Record<string, unknown>;
  const raw = point.id ?? row.bleId ?? row.ble_id;
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export type BleMapFetchChannel =
  | "map_ble"
  | "ble_page"
  | "github_cache"
  | "supabase_cache"
  | "none";

let lastBleFetchDetail = "";

export function getLastBleFetchDetail(): string {
  return lastBleFetchDetail;
}

function noteFetch(step: string, err?: unknown): void {
  const msg = err instanceof Error ? err.message : err ? String(err) : "empty";
  lastBleFetchDetail = lastBleFetchDetail
    ? `${lastBleFetchDetail}; ${step}: ${msg}`
    : `${step}: ${msg}`;
}

/** Как rawPointRouteId / rawPointRouteTitle в ble-map.js. */
export function rawPointRouteId(p: RawBlePoint): number | null {
  const row = p as Record<string, unknown>;
  const r = p.bleRoute ?? p.ble_route ?? row.bleRoute;
  if (r != null && typeof r === "object" && (r as { id?: number }).id != null) {
    return Number((r as { id?: number }).id);
  }
  const rid = p.ble_route_id ?? row.bleRouteId ?? row.ble_route_id;
  if (rid != null && Number.isFinite(Number(rid))) return Number(rid);
  if (typeof r === "number" || typeof r === "string") {
    const n = Number(r);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function rawPointRouteTitle(p: RawBlePoint): string {
  const row = p as Record<string, unknown>;
  const r = p.bleRoute ?? p.ble_route ?? row.bleRoute;
  if (r && typeof r === "object" && (r as { title?: string }).title) {
    return String((r as { title?: string }).title);
  }
  return String(row.route_title ?? row.bleRouteTitle ?? row.ble_route_title ?? "");
}

function extractRouteList(data: unknown): BleRoute[] {
  if (Array.isArray(data)) return data as BleRoute[];
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  for (const key of ["items", "content", "data", "results"]) {
    if (Array.isArray(o[key])) return o[key] as BleRoute[];
  }
  return [];
}

export function mergeBleRoutes(...lists: BleRoute[][]): BleRoute[] {
  const byId = new Map<number, BleRoute>();
  for (const list of lists) {
    for (const r of list) {
      if (r?.id == null) continue;
      const id = Number(r.id);
      if (!Number.isFinite(id)) continue;
      const prev = byId.get(id);
      byId.set(id, {
        id,
        title: r.title?.trim() || prev?.title || `Маршрут ${id}`,
      });
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.title.localeCompare(b.title, "ru"),
  );
}

function rawHasCoords(point: RawBlePoint): boolean {
  const { lat, lng } = coordsFromRaw(point);
  return (
    lat != null &&
    lng != null &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
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
  const row = point as Record<string, unknown>;
  const zone = resolveZoneTypeFromRawPoint(point, prev);

  return {
    id: rawPointId(point) ?? prev?.id,
    ble: String(point.ble_number ?? row.bleNumber ?? ""),
    title: point.name_extended || String(row.nameExtended ?? row.name ?? ""),
    lat,
    lng,
    charge,
    movabilityType: clampInspectionMovabilityType(
      point.movability_type ?? row.movabilityType ?? prev?.movabilityType ?? 1,
    ),
    power: point.power ?? 6,
    frequency: point.frequency ?? 3,
    statusCode: point.status ?? 4,
    bleTypeNum: zone.num,
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
    locationDesc: point.location_desc || String(row.locationDesc ?? ""),
    bleTypeLabel: zone.label,
    routeId: rawPointRouteId(point) ?? prev?.routeId ?? null,
    routeTitle: rawPointRouteTitle(point) || prev?.routeTitle || "",
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
  if (typeof o.total === "number" && typeof o.page === "number") {
    const size = Number(o.size) || batchLen || 1;
    return Number(o.page) * size < Number(o.total);
  }
  if (typeof o.hasNextPage === "boolean") return o.hasNextPage;
  if (typeof o.hasNext === "boolean") return o.hasNext;
  if (typeof o.totalPages === "number") return page < o.totalPages;
  if (typeof o.last === "boolean") return !o.last;
  if (typeof o.totalElements === "number" && typeof o.number === "number") {
    const size = Number(o.size) || batchLen || 1;
    return (Number(o.number) + 1) * size < Number(o.totalElements);
  }
  return batchLen >= 50;
}

/** Worker отдаёт camelCase — приводим к полям RawBlePoint. */
export function normalizeWorkerBlePoint(point: RawBlePoint): RawBlePoint {
  const row = point as Record<string, unknown>;
  const bleRouteRaw = point.bleRoute ?? point.ble_route ?? row.bleRoute;
  const routeTitle = rawPointRouteTitle(point);
  const routeId = rawPointRouteId(point);
  let bleRoute = point.bleRoute;
  if (typeof bleRouteRaw === "object" && bleRouteRaw) {
    bleRoute = bleRouteRaw as { id?: number; title?: string };
  } else if (routeId != null) {
    bleRoute = { id: routeId, title: routeTitle };
  }
  const id = rawPointId(point);
  const zone = resolveZoneTypeFromRawPoint(point);
  return {
    ...point,
    ...(id != null ? { id } : {}),
    ...(zone.num != null ? { ble_type: zone.num } : {}),
    ble_number: point.ble_number ?? (row.bleNumber as number | undefined),
    mac_address: point.mac_address || String(row.macAddress ?? ""),
    charge_value:
      point.charge_value ??
      (row.chargeValue as number | undefined) ??
      (row.charge_value as number | undefined),
    record_dt: point.record_dt || String(row.recordDt ?? row.record_dt ?? ""),
    location_desc: point.location_desc || String(row.locationDesc ?? ""),
    ble_image_url:
      point.ble_image_url || String(row.bleImageUrl ?? row.ble_image_url ?? ""),
    location_image_url:
      point.location_image_url ||
      String(row.locationImageUrl ?? row.location_image_url ?? ""),
    ble_type_desc: point.ble_type_desc || String(row.bleTypeDesc ?? ""),
    bleRoute,
  };
}

/** WW Service: GET /api/v1/ble?page=N&size=100. */
export async function fetchAllBlePaginated(
  opts: BleHttpOptions = {},
): Promise<RawBlePoint[]> {
  const fetchOpts: BleHttpOptions = { skipRemember: true, ...opts };
  const all: RawBlePoint[] = [];
  for (let page = 1; page <= WW_BLE_PAGE_MAX; page += 1) {
    const data = await bleApiFetch<unknown>(
      `${WW_BLE_LIST_PATH}?page=${page}&size=100`,
      false,
      fetchOpts,
    );
    const batch = extractBlePageItems(data).map(normalizeWorkerBlePoint);
    if (!batch.length) break;
    all.push(...batch);
    if (!pageHasNext(data, page, batch.length)) break;
  }
  return all;
}

export function extractMapBleRaw(data: unknown): RawBlePoint[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  for (const key of ["payload", "items", "content", "data", "results"]) {
    const v = o[key];
    if (Array.isArray(v)) return v as RawBlePoint[];
    if (v && typeof v === "object") {
      const nested = v as Record<string, unknown>;
      for (const nk of ["items", "content", "results"]) {
        if (Array.isArray(nested[nk])) return nested[nk] as RawBlePoint[];
      }
    }
  }
  return [];
}

/** Живой refresh — GET /api/v1/map/ble/{id}, worker→supabase (Capacitor native). */
export async function fetchBleMapLive(
  companyId = BLE_DEFAULT_COMPANY_ID,
): Promise<{ raw: RawBlePoint[]; channel: BleMapFetchChannel }> {
  lastBleFetchDetail = "";
  const data = await bleApiFetch<unknown>(`/api/v1/map/ble/${companyId}`);
  const raw = (
    Array.isArray(data)
      ? (data as RawBlePoint[])
      : extractMapBleRaw(data)
  ).map(normalizeWorkerBlePoint);
  if (raw.length) {
    noteFetch("map_ble", `${raw.length} markers`);
    return { raw, channel: "map_ble" };
  }
  noteFetch("map_ble", "empty");
  throw new Error("map_ble_empty");
}

export async function fetchBleMapRaw(
  companyId = BLE_DEFAULT_COMPANY_ID,
): Promise<RawBlePoint[]> {
  try {
    const live = await fetchBleMapLive(companyId);
    if (live.raw.length) return live.raw;
  } catch {
    /* fallback paginated */
  }

  try {
    const paginated = await fetchAllBlePaginated();
    if (paginated.length) return paginated;
  } catch {
    /* ignore */
  }

  return [];
}

/** Маршруты из сырого списка меток (bleRoute в каждой точке). */
export function deriveRoutesFromRaw(raw: RawBlePoint[]): BleRoute[] {
  const byId = new Map<number, BleRoute>();
  for (const p of raw) {
    const id = rawPointRouteId(p);
    if (id == null) continue;
    const title = rawPointRouteTitle(p).trim() || `Маршрут ${id}`;
    byId.set(id, { id, title });
  }
  return [...byId.values()].sort((a, b) =>
    a.title.localeCompare(b.title, "ru"),
  );
}

/** Маршруты из bleRoute в классифицированных метках. */
export function deriveRoutesFromMarkers(markers: BleTagMarker[]): BleRoute[] {
  const byId = new Map<number, BleRoute>();
  for (const m of markers) {
    if (m.routeId == null) continue;
    const id = Number(m.routeId);
    if (!Number.isFinite(id)) continue;
    byId.set(id, {
      id,
      title: m.routeTitle?.trim() || `Маршрут ${id}`,
    });
  }
  return [...byId.values()].sort((a, b) =>
    a.title.localeCompare(b.title, "ru"),
  );
}

export async function fetchBleRoutes(
  markers: BleTagMarker[] = [],
  raw: RawBlePoint[] = [],
): Promise<BleRoute[]> {
  const fromRaw = deriveRoutesFromRaw(raw);
  const fromMarkers = deriveRoutesFromMarkers(markers);
  try {
    const data = await bleApiFetch<unknown>("/api/v1/ble/route");
    const fromApi = extractRouteList(data);
    if (fromApi.length) {
      noteFetch("ble_route", `${fromApi.length} routes`);
      return mergeBleRoutes(fromApi, fromRaw, fromMarkers);
    }
    noteFetch("ble_route", "empty");
  } catch (e) {
    noteFetch("ble_route", e);
    console.warn("[bleMapApi] /api/v1/ble/route failed", e);
  }
  return mergeBleRoutes(fromRaw, fromMarkers);
}

export async function fetchBleMapMarkers(
  companyId = BLE_DEFAULT_COMPANY_ID,
): Promise<BleTagMarker[]> {
  const raw = await fetchBleMapRaw(companyId);
  return raw.map((p) => classifyBle(p)).filter((m) => m.lat != null && m.lng != null);
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
  return bleApiFetch<{ zones?: [] }>(`/api/v1/map/${companyId}/map_data`);
}

export async function fetchBleMapConfig(): Promise<{
  defaultView?: { latitude: number; longitude: number };
  defaultZoom?: number;
}> {
  return bleApiFetch("/api/v1/map/config");
}

/** Найти bleId по номеру метки (для новых маяков, если кэш карты устарел). */
export async function fetchBleIdByNumber(
  bleNum: string | number,
): Promise<number | null> {
  const key = normalizeBle(bleNum);
  if (!key) return null;
  try {
    const live = await fetchBleMapLive(BLE_DEFAULT_COMPANY_ID);
    for (const p of live.raw) {
      const row = p as Record<string, unknown>;
      if (normalizeBle(String(p.ble_number ?? row.bleNumber ?? "")) === key) {
        const id = rawPointId(p);
        if (id != null) return id;
      }
    }
  } catch {
    /* paginated fallback */
  }
  for (let page = 1; page <= WW_BLE_PAGE_MAX; page += 1) {
    const data = await bleApiFetch<unknown>(
      `${WW_BLE_LIST_PATH}?page=${page}&size=100`,
      false,
      { skipRemember: true },
    );
    const batch = extractBlePageItems(data).map(normalizeWorkerBlePoint);
    if (!batch.length) break;
    for (const p of batch) {
      const row = p as Record<string, unknown>;
      if (normalizeBle(String(p.ble_number ?? row.bleNumber ?? "")) === key) {
        const id = rawPointId(p);
        if (id != null) return id;
      }
    }
    if (!pageHasNext(data, page, batch.length)) break;
  }
  return null;
}

export function buildInspectionBody(
  checkin: import("../ble/types").FieldCheckin,
  tag?: BleTagMarker | null,
) {
  const recordDt = checkin.checkedAt || new Date().toISOString();
  const bleNum = Number(tag?.ble ?? checkin.bleNumber ?? 0);
  const bleId = tag?.id ?? checkin.ble_id ?? null;
  if (bleId == null) {
    throw new Error(`bleId missing for #${bleNum}`);
  }
  const fw = tag?.firmwareVersion || checkin.firmwareVersion || "bt1";
  return {
    bleId,
    ble_number: bleNum,
    bleNumber: bleNum,
    mac_address: checkin.mac_address || tag?.mac || "",
    macAddress: checkin.mac_address || tag?.mac || "",
    latitude: tag?.lat ?? checkin.latitude ?? null,
    longitude: tag?.lng ?? checkin.longitude ?? null,
    movabilityType: clampInspectionMovabilityType(
      tag?.movabilityType ?? checkin.movabilityType ?? 1,
    ),
    recordDt,
    chargeValue: checkin.chargeValue ?? tag?.charge ?? 100,
    status: tag?.statusCode ?? checkin.statusCode ?? 4,
    power: inspectionPowerFromTag(tag),
    frequency: inspectionFrequencyFromTag(tag),
    bleType: inspectionBleTypeFromTag(tag),
    firmwareVersion: fw,
    rssi: checkin.rssi ?? null,
    passUid: checkin.passUid,
    pass_uid: checkin.passUid,
    passCardUid: checkin.passUid,
    pass_card_uid: checkin.passUid,
    passUidReversed: checkin.passUidReversed,
    pass_uid_reversed: checkin.passUidReversed,
    passScannedAt: checkin.passScannedAt,
    pass_scanned_at: checkin.passScannedAt,
  };
}
