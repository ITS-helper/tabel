import type { BleTagMarker, RawBlePoint } from "../ble/types";

function toCoord(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** API/worker иногда отдаёт lat/lng, иногда latitude/longitude. */
export function coordsFromRaw(point: RawBlePoint | BleTagMarker): {
  lat?: number;
  lng?: number;
} {
  const p = point as Record<string, unknown>;
  const lat = toCoord(p.latitude ?? p.lat);
  const lng = toCoord(p.longitude ?? p.lng);
  return { lat, lng };
}

export function normalizeBleMarker(m: BleTagMarker): BleTagMarker {
  const { lat, lng } = coordsFromRaw(m);
  return { ...m, lat, lng };
}

export function normalizeBleMarkers(list: BleTagMarker[]): BleTagMarker[] {
  return list.map(normalizeBleMarker);
}

export function countMappableMarkers(list: BleTagMarker[]): number {
  let n = 0;
  for (const m of list) {
    const { lat, lng } = coordsFromRaw(m);
    if (
      lat != null &&
      lng != null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180 &&
      !(lat === 0 && lng === 0)
    ) {
      n++;
    }
  }
  return n;
}
