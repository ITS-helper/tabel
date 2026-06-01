import type { BleZone } from "../ble/types";
import {
  fetchBleMapData,
  fetchBleZoneDetail,
  parseZonesFromMapPayload,
} from "./bleMapApi";

const REFINE_CONCURRENCY = 6;

type ZoneMeta = {
  id: number;
  name: string;
  description: string;
  color: string;
  pts: [number, number][];
};

function metasFromMapData(mapData: { zones?: ZoneMeta[] }): ZoneMeta[] {
  if (!mapData?.zones?.length) return [];
  return mapData.zones
    .filter((z) => z?.id != null && !(z as { deleted?: boolean }).deleted)
    .map((z) => ({
      id: z.id,
      name: z.name || "",
      description: z.description || "",
      color: z.color || "#0088cc",
      pts: Array.isArray(z.pts) ? z.pts : [],
    }));
}

async function refineMissingPolygons(
  metas: ZoneMeta[],
  existing: BleZone[],
): Promise<BleZone[]> {
  const byId = new Map<number, BleZone>();
  for (const z of existing) {
    if (z.pts.length >= 3) byId.set(z.id, z);
  }

  for (const m of metas) {
    if (m.pts.length >= 3) {
      byId.set(m.id, {
        id: m.id,
        name: m.name,
        description: m.description,
        color: m.color,
        pts: m.pts,
        ptsSource: "api",
      });
    }
  }

  const missing = metas.filter((m) => {
    const z = byId.get(m.id);
    return !z || z.pts.length < 3;
  });
  if (!missing.length) return [...byId.values()];

  let cursor = 0;
  const worker = async () => {
    while (cursor < missing.length) {
      const idx = cursor++;
      const meta = missing[idx];
      try {
        const pts = await fetchBleZoneDetail(meta.id);
        if (pts.length < 3) continue;
        byId.set(meta.id, {
          id: meta.id,
          name: meta.name,
          description: meta.description,
          color: meta.color,
          pts,
          ptsSource: "api",
        });
      } catch {
        /* skip until next refresh */
      }
    }
  };

  const n = Math.min(REFINE_CONCURRENCY, missing.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return [...byId.values()];
}

/** Как hydrateBleMapZones в ble-map.js: map_data + догрузка ble_zone/{id}. */
export async function loadBleZonesFull(
  companyId: number,
  local: BleZone[],
): Promise<BleZone[]> {
  let mapData: { zones?: ZoneMeta[] } = {};
  try {
    mapData = await fetchBleMapData(companyId);
  } catch {
    return local;
  }

  const fast = parseZonesFromMapPayload(mapData);
  const metas = metasFromMapData(mapData);
  if (!metas.length) return fast.length ? fast : local;

  const refined = await refineMissingPolygons(metas, fast.length ? fast : local);
  if (!refined.length) return local;

  // Если API вернул зоны — всегда сохраняем свежие координаты, не stale local.
  return refined;
}
