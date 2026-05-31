import type { RawBlePoint } from "../ble/types";

type BundleFile = {
  company_id?: number;
  companyId?: number;
  updated_at?: string;
  updatedAt?: string;
  payload?: RawBlePoint[];
};

/** Встроенный снимок (копия data/ble-map-cache.json) — работает без VPN. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BUNDLE = require("../../assets/ble-map-cache.json") as BundleFile;

export function loadBundledBleCache(companyId: number): {
  raw: RawBlePoint[];
  updatedAt: string;
} | null {
  const cid = BUNDLE.company_id ?? BUNDLE.companyId;
  if (companyId != null && cid != null && Number(cid) !== Number(companyId)) {
    return null;
  }
  const payload = BUNDLE.payload;
  if (!Array.isArray(payload) || !payload.length) return null;
  return {
    raw: payload,
    updatedAt: BUNDLE.updated_at ?? BUNDLE.updatedAt ?? "",
  };
}

export function formatBundleAge(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}
