import type { BleTagMarker, RawBlePoint } from "./types";
import { ZONE_SHORT } from "../config";

export const ZONE_TYPE_MAX = Math.max(
  ...Object.keys(ZONE_SHORT).map((k) => Number(k)),
);

/** Тип зоны метки (1–14), не movability и не поколение маяка. */
export function isValidZoneTypeNum(value: unknown): value is number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= ZONE_TYPE_MAX;
}

export function parseZoneTypeFromDesc(desc: unknown): number | null {
  const s = String(desc ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d+)\s*[-–—]/);
  if (!m) return null;
  const n = Number(m[1]);
  return isValidZoneTypeNum(n) ? n : null;
}

export function zoneTypeLabel(num: number): string {
  const name = ZONE_SHORT[num];
  return name ? `${num} - ${name}` : `Тип ${num}`;
}

/** Номер и подпись типа зоны из ответа API (snake + camelCase + desc). */
export function resolveZoneTypeFromRawPoint(
  point: RawBlePoint,
  prev?: BleTagMarker,
): { num: number | null; label: string } {
  const row = point as Record<string, unknown>;
  const desc = String(
    point.ble_type_desc ??
      row.bleTypeDesc ??
      row.ble_type_desc ??
      prev?.bleTypeLabel ??
      "",
  ).trim();

  const fromDesc = parseZoneTypeFromDesc(desc);
  if (fromDesc != null) {
    return { num: fromDesc, label: desc || zoneTypeLabel(fromDesc) };
  }

  for (const raw of [point.ble_type, row.ble_type, row.bleType]) {
    if (isValidZoneTypeNum(raw)) {
      const n = Number(raw);
      return { num: n, label: desc || zoneTypeLabel(n) };
    }
  }

  if (prev?.bleTypeNum != null && isValidZoneTypeNum(prev.bleTypeNum)) {
    return {
      num: prev.bleTypeNum,
      label: desc || prev.bleTypeLabel || zoneTypeLabel(prev.bleTypeNum),
    };
  }

  return { num: null, label: desc };
}

export function resolveZoneTypeForMarker(tag: BleTagMarker): number {
  const fromDesc = parseZoneTypeFromDesc(tag.bleTypeLabel);
  if (fromDesc != null) return fromDesc;
  if (isValidZoneTypeNum(tag.bleTypeNum)) return Number(tag.bleTypeNum);
  return 0;
}

export function markerZoneTypeLabel(tag: BleTagMarker): string {
  const fromDesc = parseZoneTypeFromDesc(tag.bleTypeLabel);
  if (tag.bleTypeLabel?.trim()) return tag.bleTypeLabel.trim();
  const n = resolveZoneTypeForMarker(tag);
  return n ? zoneTypeLabel(n) : "";
}

/**
 * power / bleType / frequency для обхода — только из базы меток (карта/API).
 * GATT и реклама могут отдавать другие байты (частота 3 → «тип 3», power=0 и т.д.).
 */
export function inspectionPowerFromTag(tag?: { power?: number } | null): number {
  const n = Number(tag?.power);
  if (Number.isFinite(n) && n >= 1 && n <= 10) return n;
  return 6;
}

export function inspectionFrequencyFromTag(tag?: { frequency?: number } | null): number {
  const n = Number(tag?.frequency);
  if (Number.isFinite(n) && n >= 1 && n <= 20) return n;
  return 3;
}

export function inspectionBleTypeFromTag(tag?: BleTagMarker | null): number {
  if (tag) {
    const fromMarker = resolveZoneTypeForMarker(tag);
    if (fromMarker > 0) return fromMarker;
  }
  return 10;
}
