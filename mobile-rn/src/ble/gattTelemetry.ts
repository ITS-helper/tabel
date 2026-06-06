import type { GattLiveTelemetry } from "./types";
import { isValidZoneTypeNum } from "./zoneType";
import { GATT_WW_READ_SUFFIXES } from "../config";

function base64ToBytes(value: string): number[] {
  try {
    const binary = atob(value);
    const out: number[] = [];
    for (let i = 0; i < binary.length; i++) {
      out.push(binary.charCodeAt(i) & 0xff);
    }
    return out;
  } catch {
    const hex = value.replace(/[^0-9a-fA-F]/g, "");
    const out: number[] = [];
    for (let i = 0; i + 1 < hex.length; i += 2) {
      out.push(parseInt(hex.slice(i, i + 2), 16));
    }
    return out;
  }
}

function applyByteCandidates(
  out: GattLiveTelemetry,
  suffix: string,
  bytes: number[],
): void {
  if (!bytes.length) return;
  const b0 = bytes[0] & 0xff;
  if (
    out.chargeValue == null &&
    b0 <= 100 &&
    (suffix === "2a19" || suffix === "fff2" || suffix === "fff3" || bytes.length === 1)
  ) {
    out.chargeValue = b0;
  }
  if (out.power == null && b0 <= 10 && (suffix === "fff6" || suffix === "fff5")) {
    out.power = b0;
  }
  if (out.frequency == null && b0 <= 20 && suffix === "fff8") {
    out.frequency = b0;
  }
  /** Тип зоны — только fff3 (на v4 fff4/fff5 дают мусор: 10, 17…). */
  if (out.bleType == null && suffix === "fff3" && isValidZoneTypeNum(b0)) {
    out.bleType = b0;
  }
}

export function parseGattReads(
  reads: Array<{ suffix: string; value: string }>,
  rssi?: number | null,
): GattLiveTelemetry {
  const out: GattLiveTelemetry = {
    chargeValue: null,
    power: null,
    frequency: null,
    bleType: null,
    rssi: rssi ?? null,
    fromGatt: false,
  };

  for (const { suffix, value } of reads) {
    const bytes = base64ToBytes(value);
    applyByteCandidates(out, suffix, bytes);
  }

  if (out.chargeValue != null && out.chargeValue > 100) out.chargeValue = null;

  out.fromGatt =
    reads.length > 0 ||
    out.chargeValue != null ||
    out.power != null ||
    out.bleType != null ||
    out.frequency != null;

  return out;
}

export const GATT_READ_ORDER = ["2a19", ...GATT_WW_READ_SUFFIXES] as const;
