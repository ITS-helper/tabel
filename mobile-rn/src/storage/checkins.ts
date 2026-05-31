import AsyncStorage from "@react-native-async-storage/async-storage";
import { CHECKINS_STORAGE_KEY, DAILY_KEEP_DAYS } from "../config";
import type { CheckinStore, FieldCheckin } from "../ble/types";
import { normalizeBle } from "../ble/wwAdvert";

function emptyStore(): CheckinStore {
  return { version: 2, checkins: [], dailyPatrol: {} };
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

export async function saveCheckinRecord(
  tag: { ble: string; id?: number; lat?: number; lng?: number; movabilityType?: number; charge?: number | null; statusCode?: number; power?: number; frequency?: number; bleTypeNum?: number | null; firmwareVersion?: string; routeId?: number | null; routeTitle?: string },
  dev: { deviceId: string; rssi?: number | null },
  live: { chargeValue?: number | null; power?: number | null; frequency?: number | null; bleType?: number | null; rssi?: number | null; fromGatt?: boolean },
  route: { routeId: string; routeTitle: string },
): Promise<FieldCheckin> {
  const store = await loadStore();
  const routeId = route.routeId ? String(route.routeId) : String(tag.routeId ?? "");
  const routeTitle = route.routeId ? route.routeTitle : tag.routeTitle || "—";
  const keyBle = normalizeBle(tag.ble);
  const chargeValue = live.chargeValue ?? tag.charge ?? 100;
  const power = live.power ?? tag.power ?? 6;
  const frequency = live.frequency ?? tag.frequency ?? 3;
  const bleType = live.bleType ?? tag.bleTypeNum ?? 10;

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
    movabilityType: tag.movabilityType ?? 1,
    chargeValue: chargeValue ?? 100,
    statusCode: tag.statusCode ?? 4,
    power: power ?? 6,
    frequency: frequency ?? 3,
    bleType: bleType ?? 10,
    firmwareVersion: tag.firmwareVersion || "bt1",
    gattLive: !!live.fromGatt,
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
