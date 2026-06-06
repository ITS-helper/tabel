import type { BleTagMarker, ScannedDevice } from "../ble/types";
import {
  markerZoneTypeLabel,
  resolveZoneTypeForMarker,
} from "../ble/zoneType";
import { ZONE_SHORT } from "../config";
import { bleFromDeviceName, normalizeBle, normalizeMac } from "../ble/wwAdvert";
import { darkCyber, lightCyber, type AppColors } from "../theme/palettes";

export function tagMacKeys(tag: BleTagMarker): string[] {
  const mac = normalizeMac(tag.mac);
  const chip = normalizeMac(tag.chipUuid);
  const keys: string[] = [];
  if (mac) keys.push(mac);
  if (chip && chip !== mac) keys.push(chip);
  return keys;
}

export function resolveTagForDevice(
  dev: ScannedDevice,
  scopeMarkers: BleTagMarker[],
  findTag?: (ble: string) => BleTagMarker | undefined,
): BleTagMarker | null {
  const devMac = normalizeMac(dev.id);
  if (devMac) {
    for (const tag of scopeMarkers) {
      if (tagMacKeys(tag).includes(devMac)) return tag;
    }
  }
  const bleHints = [dev.bleFromAdv, bleFromDeviceName(dev.name)].filter(Boolean);
  for (const b of bleHints) {
    const tag = scopeMarkers.find((t) => normalizeBle(t.ble) === normalizeBle(b));
    if (tag) return tag;
    const found = findTag?.(b);
    if (
      found &&
      scopeMarkers.some((t) => normalizeBle(t.ble) === normalizeBle(found.ble))
    ) {
      return found;
    }
  }
  return null;
}

export function zoneTypeNum(tag: BleTagMarker): number {
  return resolveZoneTypeForMarker(tag);
}

export type ZoneRowStyle = {
  background: string;
  borderColor: string;
  zonePillBg: string;
  zonePillText: string;
};

function isLightTheme(colors: AppColors): boolean {
  return colors.bg === lightCyber.bg;
}

/** Читаемые цвета строк «Метки рядом» — тёмная тема: приглушённые тints, светлая: как ble-field.css */
export function zoneRowStyle(
  tag: BleTagMarker,
  colors: AppColors,
): ZoneRowStyle | null {
  const n = zoneTypeNum(tag);
  const light = isLightTheme(colors);

  if (light) {
    switch (n) {
      case 1:
        return {
          background: "#e3f2fd",
          borderColor: "#90caf9",
          zonePillBg: "rgba(255,255,255,0.72)",
          zonePillText: "#1565c0",
        };
      case 2:
        return {
          background: "#e8f5e9",
          borderColor: "#a5d6a7",
          zonePillBg: "rgba(255,255,255,0.72)",
          zonePillText: "#2e7d32",
        };
      case 4:
        return {
          background: "#eceff1",
          borderColor: "#b0bec5",
          zonePillBg: "rgba(255,255,255,0.72)",
          zonePillText: "#455a64",
        };
      case 5:
      case 12:
        return {
          background: "#ffcdd2",
          borderColor: "#ef9a9a",
          zonePillBg: "rgba(255,255,255,0.72)",
          zonePillText: "#b71c1c",
        };
      case 7:
        return {
          background: "#d7ccc8",
          borderColor: "#bcaaa4",
          zonePillBg: "rgba(255,255,255,0.72)",
          zonePillText: "#5d4037",
        };
      default:
        if (n > 0) {
          return {
            background: "#fffde7",
            borderColor: "#fff59d",
            zonePillBg: "rgba(255,255,255,0.72)",
            zonePillText: "#f57f17",
          };
        }
        return null;
    }
  }

  switch (n) {
    case 1:
      return {
        background: "rgba(21, 101, 192, 0.28)",
        borderColor: "rgba(100, 181, 246, 0.55)",
        zonePillBg: "rgba(21, 101, 192, 0.55)",
        zonePillText: "#e3f2fd",
      };
    case 2:
      return {
        background: "rgba(46, 125, 50, 0.28)",
        borderColor: "rgba(129, 199, 132, 0.55)",
        zonePillBg: "rgba(46, 125, 50, 0.55)",
        zonePillText: "#c8e6c9",
      };
    case 4:
      return {
        background: "rgba(69, 90, 100, 0.32)",
        borderColor: "rgba(144, 164, 174, 0.5)",
        zonePillBg: "rgba(55, 71, 79, 0.65)",
        zonePillText: "#cfd8dc",
      };
    case 5:
    case 12:
      return {
        background: "rgba(183, 28, 28, 0.26)",
        borderColor: "rgba(239, 83, 80, 0.55)",
        zonePillBg: "rgba(183, 28, 28, 0.55)",
        zonePillText: "#ffcdd2",
      };
    case 7:
      return {
        background: "rgba(93, 64, 55, 0.32)",
        borderColor: "rgba(161, 136, 127, 0.55)",
        zonePillBg: "rgba(93, 64, 55, 0.58)",
        zonePillText: "#d7ccc8",
      };
    default:
      if (n > 0) {
        return {
          background: "rgba(245, 127, 23, 0.22)",
          borderColor: "rgba(255, 183, 77, 0.5)",
          zonePillBg: "rgba(245, 127, 23, 0.48)",
          zonePillText: "#fff8e1",
        };
      }
      return null;
  }
}

/** @deprecated */
export type ZoneRowColors = ZoneRowStyle;

/** @deprecated */
export function zoneRowColors(tag: BleTagMarker): ZoneRowStyle | null {
  return zoneRowStyle(tag, darkCyber);
}

export function zoneShortLabel(tag: BleTagMarker): string {
  const text = markerZoneTypeLabel(tag);
  if (text) {
    const m = text.match(/^(\d+)\s*[-–—]\s*(.+)$/);
    return m ? m[2].trim() : text;
  }
  const n = zoneTypeNum(tag);
  return ZONE_SHORT[n] || "";
}

export type NearbyRow = {
  tag: BleTagMarker;
  dev: ScannedDevice;
  saved: boolean;
};

export type PatrolPhoto = { label: string; url: string };

export function photosForPatrol(tag: BleTagMarker): PatrolPhoto[] {
  const list: PatrolPhoto[] = [];
  if (tag.photoPlace) list.push({ label: "Место", url: tag.photoPlace });
  if (tag.photoTag) list.push({ label: "Метка", url: tag.photoTag });
  return list;
}

export function tagHasPhotos(tag: BleTagMarker): boolean {
  return photosForPatrol(tag).length > 0;
}

export function isPatrolDone(tag: BleTagMarker, dailyDone: Set<string>): boolean {
  return dailyDone.has(normalizeBle(tag.ble)) || !!tag.isInspected;
}

function patrolDoneForRoute(
  tag: BleTagMarker,
  todayPatrol: Record<string, string[]>,
  filterRouteId: string,
): boolean {
  if (tag.isInspected) return true;
  const ble = normalizeBle(tag.ble);
  const markerRouteId = String(tag.routeId ?? "") || "all";
  const buckets = new Set<string>(["all"]);
  if (filterRouteId) buckets.add(filterRouteId);
  else buckets.add(markerRouteId);

  for (const bucket of buckets) {
    const list = todayPatrol[bucket] ?? [];
    if (list.some((b) => normalizeBle(b) === ble)) return true;
  }
  return false;
}

export function routeProgressFor(
  markers: BleTagMarker[],
  todayPatrol: Record<string, string[]>,
  filterRouteId = "",
): { done: number; total: number } {
  const list = filterRouteId
    ? markers.filter((m) => String(m.routeId ?? "") === filterRouteId)
    : markers;
  let done = 0;
  for (const m of list) {
    if (patrolDoneForRoute(m, todayPatrol, filterRouteId)) done++;
  }
  return { done, total: list.length };
}

export function buildNearbyRows(
  devices: ScannedDevice[],
  scopeMarkers: BleTagMarker[],
  opts: {
    scanPaused: boolean;
    showPassedMarkers: boolean;
    dailyDone: Set<string>;
    findTag?: (ble: string) => BleTagMarker | undefined;
  },
): NearbyRow[] {
  const byBle = new Map<string, NearbyRow>();
  const now = Date.now();
  for (const dev of devices) {
    if (!opts.scanPaused && now - dev.lastSeen > 20_000) continue;
    const tag = resolveTagForDevice(dev, scopeMarkers, opts.findTag);
    if (!tag) continue;
    const key = normalizeBle(tag.ble);
    const saved =
      opts.dailyDone.has(key) ||
      !!tag.isInspected;
    const prev = byBle.get(key);
    if (!prev || (dev.rssi ?? -999) > (prev.dev.rssi ?? -999)) {
      byBle.set(key, { tag, dev, saved });
    }
  }
  let rows = [...byBle.values()];
  if (!opts.showPassedMarkers) {
    rows = rows.filter((r) => !r.saved);
  }
  rows.sort((a, b) => (b.dev.rssi ?? -999) - (a.dev.rssi ?? -999));
  return rows;
}

export function countLiveDevices(devices: ScannedDevice[], scanPaused: boolean): number {
  const now = Date.now();
  let n = 0;
  for (const d of devices) {
    if (!scanPaused && now - d.lastSeen > 20_000) continue;
    n++;
  }
  return n;
}
