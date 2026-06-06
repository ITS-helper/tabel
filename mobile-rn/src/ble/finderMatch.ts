import type { ScannedDevice } from "./types";
import { normalizeBle } from "./wwAdvert";

export function matchWatchTarget(dev: ScannedDevice, key: string): boolean {
  const name = String(dev.name ?? "").toLowerCase();
  const id = String(dev.id ?? "").toLowerCase();
  const idCompact = id.replace(/[^a-f0-9]/g, "");
  const keyCompact = key.replace(/[^a-f0-9]/g, "");
  if (name && name.includes(key)) return true;
  if (keyCompact.length >= 4 && idCompact.includes(keyCompact)) return true;
  return id.includes(key);
}

export function matchTagTarget(dev: ScannedDevice, key: string): boolean {
  if (normalizeBle(dev.bleFromAdv) === normalizeBle(key)) return true;
  const mac = dev.id.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  return mac.includes(key.toUpperCase());
}

export function matchFinderTarget(
  dev: ScannedDevice,
  key: string,
  watchMode: boolean,
): boolean {
  return watchMode ? matchWatchTarget(dev, key) : matchTagTarget(dev, key);
}
