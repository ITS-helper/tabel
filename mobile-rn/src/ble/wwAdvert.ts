import { WW_MANUFACTURER_MAGIC } from "../config";

export function normalizeBle(num: string | number | null | undefined): string {
  return String(num ?? "")
    .replace(/\D/g, "")
    .replace(/^0+/, "");
}

export function normalizeMac(mac: string | null | undefined): string {
  if (!mac) return "";
  return String(mac).replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

function bytesFromBase64(b64: string): number[] {
  const out: number[] = [];
  try {
    const binary = atob(b64);
    for (let i = 0; i < binary.length; i++) {
      out.push(binary.charCodeAt(i) & 0xff);
    }
  } catch {
    /* skip invalid base64 */
  }
  return out;
}

/** ble-plx отдаёт base64-строку; Capacitor — объект companyId → base64. */
export function manufacturerDataToRecord(
  md: string | Record<string, string> | null | undefined,
): Record<string, string> {
  if (!md) return {};
  if (typeof md === "string") return md ? { "": md } : {};
  return md;
}

function bytesFromManufacturerData(
  md: string | Record<string, string> | null | undefined,
): number[] {
  const rec = manufacturerDataToRecord(md);
  if (!Object.keys(rec).length) return [];
  const out: number[] = [];
  for (const val of Object.values(rec)) {
    if (!val) continue;
    out.push(...bytesFromBase64(val));
  }
  return out;
}

/** Извлекает manufacturer AD (0xFF) и полный raw record для поиска WW magic. */
export function advertBytesFromScan(params: {
  manufacturerData?: string | Record<string, string> | null;
  rawScanRecord?: string | null;
}): number[] {
  const fromMd = bytesFromManufacturerData(params.manufacturerData ?? null);
  if (fromMd.length) return fromMd;
  if (params.rawScanRecord) return bytesFromBase64(params.rawScanRecord);
  return [];
}

function parse16BitUuid(le16: number): string {
  const hex = le16.toString(16).padStart(4, "0");
  return `0000${hex}-0000-1000-8000-00805f9b34fb`;
}

function serviceUuidsFromRawScanRecord(rawScanRecord: string): string[] {
  const data = bytesFromBase64(rawScanRecord);
  const uuids: string[] = [];
  let offset = 0;
  while (offset < data.length) {
    const adLength = data[offset];
    if (!adLength) break;
    if (offset + adLength >= data.length) break;
    const adType = data[offset + 1];
    const adData = data.slice(offset + 2, offset + 1 + adLength);
    if (adType === 0x02 || adType === 0x03) {
      for (let i = 0; i + 1 < adData.length; i += 2) {
        uuids.push(parse16BitUuid(adData[i] + (adData[i + 1] << 8)));
      }
    } else if (adType === 0x06 || adType === 0x07) {
      for (let i = 0; i + 15 < adData.length; i += 16) {
        const parts: string[] = [];
        for (let j = 0; j < 16; j += 4) {
          const chunk = adData.slice(i + j, i + j + 4);
          parts.push(
            chunk
              .map((b) => b.toString(16).padStart(2, "0"))
              .reverse()
              .join(""),
          );
        }
        uuids.push(`${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}`);
      }
    }
    offset += adLength + 1;
  }
  return uuids;
}

export function serviceUuidsFromScan(params: {
  serviceUUIDs?: string[] | null;
  rawScanRecord?: string | null;
}): string[] {
  const fromDevice = params.serviceUUIDs ?? [];
  if (fromDevice.length) return fromDevice;
  if (params.rawScanRecord) return serviceUuidsFromRawScanRecord(params.rawScanRecord);
  return [];
}

function hasWwMagic(nums: number[]): boolean {
  const magic = WW_MANUFACTURER_MAGIC;
  for (let i = 0; i <= nums.length - magic.length; i++) {
    if (
      nums[i] === magic[0] &&
      nums[i + 1] === magic[1] &&
      nums[i + 2] === magic[2] &&
      nums[i + 3] === magic[3]
    ) {
      return true;
    }
  }
  return false;
}

export function isWwAdvertisement(params: {
  manufacturerData?: string | Record<string, string> | null;
  rawScanRecord?: string | null;
  serviceUUIDs?: string[] | null;
}): boolean {
  const nums = advertBytesFromScan(params);
  if (hasWwMagic(nums)) return true;
  const uuids = serviceUuidsFromScan(params);
  return uuids.some((u) => String(u).toLowerCase().includes("fff0"));
}

export function bleFromAdvertBytes(nums: number[]): string {
  for (let i = 0; i <= nums.length - 6; i++) {
    if (
      nums[i] === 0xa5 &&
      nums[i + 1] === 8 &&
      nums[i + 2] === 0 &&
      nums[i + 3] === 1
    ) {
      const le16 = nums[i + 4] + (nums[i + 5] << 8);
      if (le16 > 0) return normalizeBle(String(le16));
      const le16be = (nums[i + 4] << 8) + nums[i + 5];
      if (le16be > 0) return normalizeBle(String(le16be));
    }
  }
  return "";
}

export function bleFromManufacturerData(
  manufacturerData?: string | Record<string, string> | null,
  rawScanRecord?: string | null,
): string {
  const nums = advertBytesFromScan({ manufacturerData, rawScanRecord });
  return bleFromAdvertBytes(nums);
}

export function bleFromDeviceName(name: string | null | undefined): string {
  if (!name) return "";
  const m =
    name.match(/(?:WW[-_\s]?)?(\d{3,6})/i) || name.match(/(\d{3,6})/);
  return m ? normalizeBle(m[1]) : "";
}
