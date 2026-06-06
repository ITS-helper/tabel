import { bleApiMutate, bleAutoLogin, getBleToken } from "./bleClient";
import {
  buildInspectionBody,
  clampInspectionMovabilityType,
  fetchBleIdByNumber,
} from "./bleMapApi";
import { markCheckinsUploaded } from "../storage/checkins";
import { tagMacKeys } from "../field/fieldHelpers";
import { normalizeBle, normalizeMac } from "../ble/wwAdvert";
import type { BleTagMarker, FieldCheckin } from "../ble/types";

export type UploadResult = {
  ok: number;
  fail: number;
  lastErr: string;
  uploaded: FieldCheckin[];
};

export type UploadProgress = {
  done: number;
  total: number;
  currentBle: string;
};

const INSPECTION_PATHS = ["/api/v2/ble_inspection", "/api/v1/ble_inspection"] as const;

function formatUploadError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("bleId") || msg.includes("ble_id")) {
    return "Нет ID метки в базе — обновите карту (↻) и повторите";
  }
  if (msg.includes("movabilityType") || msg.includes("enumeration member")) {
    return "Сервер отклонил тип маяка — обновите приложение и повторите";
  }
  if (
    msg.includes("power") &&
    (msg.includes("greater than") ||
      msg.includes("not_ge") ||
      msg.includes('"power"'))
  ) {
    return "Сервер отклонил: мощность (power) должна быть 1–10. Перезапишите обход или обновите приложение.";
  }
  if (msg.includes("HTTP 422")) {
    return msg.replace(/^HTTP 422:\s*/, "Сервер отклонил: ").slice(0, 160);
  }
  if (msg.includes("auth_failed") || msg.includes("HTTP 401")) {
    return "Ошибка входа в API — проверьте интернет и повторите";
  }
  if (msg.includes("supabase_") || msg.includes("Failed to fetch") || msg.includes("Таймаут")) {
    return "Нет связи с сервером обходов — проверьте Wi‑Fi / мобильный интернет";
  }
  if (msg.includes("worker_")) {
    return "Сервер обходов недоступен — проверьте интернет";
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

function findTagInMarkers(
  ble: string,
  markers: BleTagMarker[],
  mac?: string | null,
): BleTagMarker | undefined {
  const key = normalizeBle(ble);
  let tag = markers.find((m) => normalizeBle(m.ble) === key);
  if (tag) return tag;
  const macKey = normalizeMac(mac);
  if (!macKey) return undefined;
  return markers.find((t) => tagMacKeys(t).includes(macKey));
}

async function resolveTagForCheckin(
  checkin: FieldCheckin,
  findTag: (ble: string) => BleTagMarker | undefined,
  markers: BleTagMarker[],
): Promise<BleTagMarker | null> {
  let tag =
    findTag(String(checkin.bleNumber)) ??
    findTagInMarkers(String(checkin.bleNumber), markers, checkin.mac_address);

  let bleId = tag?.id ?? checkin.ble_id ?? null;
  if (bleId == null) {
    const fetched = await fetchBleIdByNumber(checkin.bleNumber);
    if (fetched != null) bleId = fetched;
  }

  if (bleId == null) return tag ?? null;

  const base = tag ?? {
    ble: String(checkin.bleNumber),
    lat: checkin.latitude ?? undefined,
    lng: checkin.longitude ?? undefined,
    movabilityType: checkin.movabilityType,
    charge: checkin.chargeValue ?? null,
    statusCode: checkin.statusCode,
    power: checkin.power,
    frequency: checkin.frequency,
    bleTypeNum: checkin.bleType ?? null,
    firmwareVersion: checkin.firmwareVersion,
    mac: checkin.mac_address ?? "",
  };

  return {
    ...base,
    id: bleId,
    movabilityType: clampInspectionMovabilityType(
      base.movabilityType ?? checkin.movabilityType ?? 1,
    ),
  };
}

export async function uploadCheckins(
  pending: FieldCheckin[],
  findTag: (ble: string) => BleTagMarker | undefined,
  onProgress?: (p: UploadProgress) => void,
  markers: BleTagMarker[] = [],
): Promise<UploadResult> {
  try {
    await bleAutoLogin();
  } catch (e) {
    console.warn("[checkinsUpload] auth", e);
  }
  if (!(await getBleToken())) {
    return { ok: 0, fail: pending.length, lastErr: "Не удалось войти в API", uploaded: [] };
  }

  let ok = 0;
  let fail = 0;
  let lastErr = "";
  const uploaded: FieldCheckin[] = [];
  const total = pending.length;

  for (let i = 0; i < pending.length; i += 1) {
    const c = pending[i];
    onProgress?.({ done: i, total, currentBle: String(c.bleNumber) });

    const tag = await resolveTagForCheckin(c, findTag, markers);
    if (tag?.id == null) {
      fail++;
      lastErr = `Метка #${c.bleNumber}: нет bleId (обновите карту ↻)`;
      console.warn("[checkinsUpload] missing bleId", c.bleNumber, c.ble_id);
      continue;
    }

    let body: ReturnType<typeof buildInspectionBody>;
    try {
      body = buildInspectionBody(
        {
          ...c,
          ble_id: tag.id,
          movabilityType: clampInspectionMovabilityType(c.movabilityType ?? tag.movabilityType),
        },
        tag,
      );
    } catch (e) {
      fail++;
      lastErr = formatUploadError(e);
      continue;
    }

    try {
      await postInspection(body);
      const uploadedOne: FieldCheckin = {
        ...c,
        ble_id: tag.id,
        uploaded: true,
        uploadedAt: new Date().toISOString(),
      };
      uploaded.push(uploadedOne);
      await markCheckinsUploaded([uploadedOne]);
      ok++;
      onProgress?.({ done: i + 1, total, currentBle: String(c.bleNumber) });
    } catch (e) {
      fail++;
      lastErr = formatUploadError(e);
      console.warn("[checkinsUpload] fail", c.bleNumber, lastErr);
    }
  }

  return { ok, fail, lastErr, uploaded };
}
