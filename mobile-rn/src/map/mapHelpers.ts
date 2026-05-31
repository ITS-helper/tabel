import type { BleTagMarker, BleZone } from "../ble/types";
import { normalizeBle } from "../ble/wwAdvert";

/** Зоны маршрута: по zoneId меток или если метка внутри полигона. */
export function zonesForRouteMarkers(
  markers: BleTagMarker[],
  allZones: BleZone[],
  routeId: string,
): BleZone[] {
  if (!routeId || !markers.length) return allZones;
  const zoneIds = new Set<number>();
  for (const m of markers) {
    if (m.zoneId != null) zoneIds.add(Number(m.zoneId));
  }
  if (zoneIds.size) {
    const matched = allZones.filter((z) => zoneIds.has(z.id));
    if (matched.length) return matched;
  }
  return allZones.filter((z) =>
    markers.some(
      (m) =>
        m.lat != null &&
        m.lng != null &&
        pointInPolygon(m.lat, m.lng, z.pts),
    ),
  );
}

function pointInPolygon(lat: number, lng: number, ring: [number, number][]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0];
    const xi = ring[i][1];
    const yj = ring[j][0];
    const xj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function resolveSearchFocus(
  query: string,
  routeMarkers: BleTagMarker[],
  findTag: (ble: string) => BleTagMarker | undefined,
): BleTagMarker | null {
  const q = query.trim().toLowerCase().replace(/^ble/i, "");
  if (!q) return null;
  const inRoute = routeMarkers.find((m) => normalizeBle(m.ble) === normalizeBle(q));
  if (inRoute) return inRoute;
  return findTag(q) ?? null;
}
