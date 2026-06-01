import { bleApiMutate, ensureBleTokenForField } from "./bleClient";
import { buildInspectionBody } from "./bleMapApi";
import type { BleTagMarker, FieldCheckin } from "../ble/types";

export type UploadResult = {
  ok: number;
  fail: number;
  lastErr: string;
  uploaded: FieldCheckin[];
};

const INSPECTION_PATHS = ["/api/v2/ble_inspection", "/api/v1/ble_inspection"] as const;

function formatUploadError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("bleId") || msg.includes("ble_id")) {
    return "Нет ID метки в базе — обновите карту (↻) и повторите";
  }
  if (msg.includes("HTTP 422")) {
    return msg.replace(/^HTTP 422:\s*/, "Сервер отклонил: ").slice(0, 160);
  }
  if (msg.includes("worker_") || msg.includes("supabase_") || msg.includes("Failed to fetch")) {
    return "Нет связи с API обходов (worker). Проверьте Wi‑Fi / VPN";
  }
  return msg.slice(0, 160);
}

async function postInspection(body: unknown): Promise<void> {
  let lastErr: unknown = null;
  for (const path of INSPECTION_PATHS) {
    try {
      await bleApiMutate("POST", path, body);
      return;
    } catch (e) {
      lastErr = e;
      console.warn("[checkinsUpload]", path, e);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "upload_failed"));
}

function resolveTagForCheckin(
  checkin: FieldCheckin,
  findTag: (ble: string) => BleTagMarker | undefined,
): BleTagMarker | null {
  const tag = findTag(String(checkin.bleNumber));
  if (tag?.id != null) return tag;
  if (checkin.ble_id != null) {
    return {
      ble: String(checkin.bleNumber),
      id: checkin.ble_id,
      lat: checkin.latitude ?? undefined,
      lng: checkin.longitude ?? undefined,
      movabilityType: checkin.movabilityType,
      charge: checkin.chargeValue ?? null,
      statusCode: checkin.statusCode,
      power: checkin.power,
      frequency: checkin.frequency,
      bleTypeNum: checkin.bleType ?? null,
      firmwareVersion: checkin.firmwareVersion,
    };
  }
  return tag ?? null;
}

export async function uploadCheckins(
  pending: FieldCheckin[],
  findTag: (ble: string) => BleTagMarker | undefined,
): Promise<UploadResult> {
  if (!(await ensureBleTokenForField())) {
    return { ok: 0, fail: pending.length, lastErr: "Не удалось войти в API", uploaded: [] };
  }
  let ok = 0;
  let fail = 0;
  let lastErr = "";
  const uploaded: FieldCheckin[] = [];
  for (const c of pending) {
    const tag = resolveTagForCheckin(c, findTag);
    if (tag?.id == null) {
      fail++;
      lastErr = `Метка #${c.bleNumber}: нет bleId (обновите карту)`;
      console.warn("[checkinsUpload] missing bleId", c.bleNumber, c.ble_id);
      continue;
    }
    const body = buildInspectionBody(c, tag);
    try {
      await postInspection(body);
      c.uploaded = true;
      c.uploadedAt = new Date().toISOString();
      uploaded.push(c);
      ok++;
    } catch (e) {
      fail++;
      lastErr = formatUploadError(e);
      console.warn("[checkinsUpload] fail", c.bleNumber, lastErr);
    }
  }
  return { ok, fail, lastErr, uploaded };
}

export async function uploadOneCheckin(
  checkin: FieldCheckin,
  findTag: (ble: string) => BleTagMarker | undefined,
): Promise<{ ok: boolean; err?: string }> {
  const result = await uploadCheckins([checkin], findTag);
  if (result.ok) return { ok: true };
  return { ok: false, err: result.lastErr || "upload_failed" };
}
