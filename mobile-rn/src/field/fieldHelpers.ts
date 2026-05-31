import type { BleTagMarker, ScannedDevice } from "../ble/types";
import { ZONE_SHORT } from "../config";
import { bleFromDeviceName, normalizeBle, normalizeMac } from "../ble/wwAdvert";

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
  return Number(tag.bleTypeNum) || 0;
}

export function zoneShortLabel(tag: BleTagMarker): string {
  const n = zoneTypeNum(tag);
  return ZONE_SHORT[n] || (n ? `Тип ${n}` : "");
}

export type NearbyRow = {
  tag: BleTagMarker;
  dev: ScannedDevice;
  saved: boolean;
};

export function buildNearbyRows(
  devices: ScannedDevice[],
  scopeMarkers: BleTagMarker[],
  opts: {
    scanPaused: boolean;
    tagPatrolMode: boolean;
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
  if (!opts.tagPatrolMode) {
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
