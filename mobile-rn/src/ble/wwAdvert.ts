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

function bytesFromManufacturerData(
  md: Record<string, string> | null | undefined,
): number[] {
  if (!md || typeof md !== "object") return [];
  const out: number[] = [];
  for (const val of Object.values(md)) {
    if (!val) continue;
    try {
      const binary = atob(val);
      for (let i = 0; i < binary.length; i++) {
        out.push(binary.charCodeAt(i) & 0xff);
      }
    } catch {
      /* skip invalid base64 */
    }
  }
  return out;
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
  manufacturerData?: Record<string, string> | null;
  serviceUUIDs?: string[] | null;
}): boolean {
  const nums = bytesFromManufacturerData(params.manufacturerData ?? null);
  if (hasWwMagic(nums)) return true;
  const uuids = params.serviceUUIDs ?? [];
  return uuids.some((u) => String(u).toLowerCase().includes("fff0"));
}

export function bleFromManufacturerData(
  manufacturerData?: Record<string, string> | null,
): string {
  const nums = bytesFromManufacturerData(manufacturerData ?? null);
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

export function bleFromDeviceName(name: string | null | undefined): string {
  if (!name) return "";
  const m =
    name.match(/(?:WW[-_\s]?)?(\d{3,6})/i) || name.match(/(\d{3,6})/);
  return m ? normalizeBle(m[1]) : "";
}
