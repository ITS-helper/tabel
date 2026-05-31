import { bleApiMutate } from "./bleClient";
import { buildInspectionBody } from "./bleMapApi";
import type { BleTagMarker, FieldCheckin } from "../ble/types";

export type UploadResult = {
  ok: number;
  fail: number;
  lastErr: string;
  uploaded: FieldCheckin[];
};

export async function uploadCheckins(
  pending: FieldCheckin[],
  findTag: (ble: string) => BleTagMarker | undefined,
): Promise<UploadResult> {
  let ok = 0;
  let fail = 0;
  let lastErr = "";
  const uploaded: FieldCheckin[] = [];
  for (const c of pending) {
    const tag = findTag(String(c.bleNumber));
    const body = buildInspectionBody(c, tag);
    try {
      await bleApiMutate("POST", "/api/v2/ble_inspection", body);
      c.uploaded = true;
      c.uploadedAt = new Date().toISOString();
      uploaded.push(c);
      ok++;
    } catch (e) {
      fail++;
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok, fail, lastErr, uploaded };
}
