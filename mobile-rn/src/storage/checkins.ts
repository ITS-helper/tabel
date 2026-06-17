import AsyncStorage from "@react-native-async-storage/async-storage";
import { clampInspectionMovabilityType } from "../api/bleMapApi";
import {
  inspectionBleTypeFromTag,
  inspectionFrequencyFromTag,
  inspectionPowerFromTag,
} from "../ble/zoneType";
import { CHECKINS_STORAGE_KEY, DAILY_KEEP_DAYS } from "../config";
import type { CheckinStore, FieldCheckin, PassScan } from "../ble/types";
import { normalizeBle } from "../ble/wwAdvert";

function emptyStore(): CheckinStore {
  return {
    version: 2,
    checkins: [],
    dailyPatrol: {},
    dailyRouteResets: {},
    dailyPassScans: {},
  };
}

export async function loadStore(): Promise<CheckinStore> {
  const raw = await AsyncStorage.getItem(CHECKINS_STORAGE_KEY);
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as Partial<CheckinStore>;
    if (!parsed || !Array.isArray(parsed.checkins)) return emptyStore();
    return {
      version: 2,
      checkins: parsed.checkins,
      dailyPatrol: parsed.dailyPatrol ?? {},
      dailyRouteResets: parsed.dailyRouteResets ?? {},
      dailyPassScans: parsed.dailyPassScans ?? {},
    };
  } catch {
    return emptyStore();
  }
}

export async function persistStore(store: CheckinStore): Promise<void> {
  pruneOldDaily(store);
  await AsyncStorage.setItem(CHECKINS_STORAGE_KEY, JSON.stringify(store));
}

function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pruneOldDaily(store: CheckinStore): void {
  const keys = Object.keys(store.dailyPatrol).sort();
  while (keys.length > DAILY_KEEP_DAYS) {
    const k = keys.shift();
    if (k) delete store.dailyPatrol[k];
  }
  const resetKeys = Object.keys(store.dailyRouteResets).sort();
  while (resetKeys.length > DAILY_KEEP_DAYS) {
    const k = resetKeys.shift();
    if (k) delete store.dailyRouteResets[k];
  }
  const passKeys = Object.keys(store.dailyPassScans).sort();
  while (passKeys.length > DAILY_KEEP_DAYS) {
    const k = passKeys.shift();
    if (k) delete store.dailyPassScans[k];
  }
}

export function recordDailyVisit(
  store: CheckinStore,
  routeId: string,
  ble: string,
): void {
  const day = localDateKey();
  if (!store.dailyPatrol[day]) store.dailyPatrol[day] = {};
  const rid = routeId || "all";
  if (!store.dailyPatrol[day][rid]) store.dailyPatrol[day][rid] = [];
  const key = normalizeBle(ble);
  if (!store.dailyPatrol[day][rid].includes(key)) {
    store.dailyPatrol[day][rid].push(key);
  }
}

export function getDailyDoneSet(
  store: CheckinStore,
  routeId: string,
): Set<string> {
  const day = localDateKey();
  const rid = routeId || "all";
  const list = store.dailyPatrol[day]?.[rid] ?? [];
  return new Set(list.map(normalizeBle));
}

export function isRouteResetToday(store: CheckinStore, routeId: string): boolean {
  const rid = routeId || "all";
  return !!store.dailyRouteResets[localDateKey()]?.[rid];
}

export function getTodayRouteResetMap(
  store: CheckinStore,
): Record<string, boolean> {
  return store.dailyRouteResets[localDateKey()] ?? {};
}

export async function resetRoutePatrolToday(routeId: string): Promise<void> {
  const rid = routeId || "all";
  const day = localDateKey();
  const store = await loadStore();
  if (!store.dailyRouteResets[day]) store.dailyRouteResets[day] = {};
  store.dailyRouteResets[day][rid] = true;
  if (!store.dailyPatrol[day]) store.dailyPatrol[day] = {};
  delete store.dailyPatrol[day][rid];
  await persistStore(store);
}

export function getTodayPassScan(store: CheckinStore): PassScan | null {
  return store.dailyPassScans[localDateKey()] ?? null;
}

export async function saveTodayPassScan(scan: PassScan): Promise<PassScan> {
  const store = await loadStore();
  const saved: PassScan = {
    ...scan,
    uid: scan.uid.toUpperCase(),
    uidReversed: scan.uidReversed?.toUpperCase(),
    scannedAt: scan.scannedAt || new Date().toISOString(),
  };
  store.dailyPassScans[localDateKey()] = saved;
  await persistStore(store);
  return saved;
}

/** Обходы за сегодня: routeId → список BLE (routeId "" → ключ «all»). */
export function getTodayPatrolMap(
  store: CheckinStore,
): Record<string, string[]> {
  const day = localDateKey();
  return store.dailyPatrol[day] ?? {};
}

export async function saveCheckinRecord(
  tag: { ble: string; id?: number; lat?: number; lng?: number; movabilityType?: number; charge?: number | null; statusCode?: number; power?: number; frequency?: number; bleTypeNum?: number | null; bleTypeLabel?: string; firmwareVersion?: string; routeId?: number | null; routeTitle?: string },
  dev: { deviceId: string; rssi?: number | null },
  live: { chargeValue?: number | null; power?: number | null; frequency?: number | null; bleType?: number | null; rssi?: number | null; fromGatt?: boolean },
  route: { routeId: string; routeTitle: string },
): Promise<FieldCheckin> {
  const store = await loadStore();
  const routeId = route.routeId ? String(route.routeId) : String(tag.routeId ?? "");
  const routeTitle = route.routeId ? route.routeTitle : tag.routeTitle || "—";
  const keyBle = normalizeBle(tag.ble);
  const chargeValue = live.chargeValue ?? tag.charge ?? 100;
  const power = inspectionPowerFromTag(tag);
  const frequency = inspectionFrequencyFromTag(tag);
  const bleType = inspectionBleTypeFromTag(tag);
  const passScan = getTodayPassScan(store);

  store.checkins = store.checkins.filter(
    (c) =>
      !(
        normalizeBle(c.bleNumber) === keyBle &&
        String(c.routeId) === routeId &&
        !c.uploaded
      ),
  );

  const checkin: FieldCheckin = {
    id: `${Date.now()}-${keyBle}`,
    routeId,
    routeTitle,
    bleNumber: tag.ble,
    ble_id: tag.id ?? null,
    mac_address: dev.deviceId,
    latitude: tag.lat ?? null,
    longitude: tag.lng ?? null,
    rssi: live.rssi ?? dev.rssi ?? null,
    checkedAt: new Date().toISOString(),
    uploaded: false,
    movabilityType: clampInspectionMovabilityType(tag.movabilityType ?? 1),
    chargeValue: chargeValue ?? 100,
    statusCode: tag.statusCode ?? 4,
    power,
    frequency: frequency ?? 3,
    bleType,
    firmwareVersion: tag.firmwareVersion || "bt1",
    gattLive: !!live.fromGatt,
    passUid: passScan?.uid,
    passUidReversed: passScan?.uidReversed,
    passScannedAt: passScan?.scannedAt,
  };

  store.checkins.unshift(checkin);
  recordDailyVisit(store, routeId, tag.ble);
  await persistStore(store);
  return checkin;
}

export async function getPendingCheckins(): Promise<FieldCheckin[]> {
  const store = await loadStore();
  return store.checkins.filter((c) => !c.uploaded);
}

export async function markCheckinsUploaded(updated: FieldCheckin[]): Promise<void> {
  const store = await loadStore();
  const byId = new Map(updated.map((c) => [c.id, c]));
  store.checkins = store.checkins.map((c) => byId.get(c.id) ?? c);
  await persistStore(store);
}

export async function pendingCount(): Promise<number> {
  return (await getPendingCheckins()).length;
}

/** Резервная копия обходов (JSON) — на случай сбоя отправки. */
export async function exportCheckinsBackup(): Promise<string> {
  const store = await loadStore();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      pending: store.checkins.filter((c) => !c.uploaded),
      all: store.checkins,
      dailyPatrol: store.dailyPatrol,
      dailyRouteResets: store.dailyRouteResets,
      dailyPassScans: store.dailyPassScans,
    },
    null,
    2,
  );
}
