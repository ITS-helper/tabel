import AsyncStorage from "@react-native-async-storage/async-storage";
import { BLE_DEFAULT_COMPANY_ID, BLE_OFFLINE_MARKER_EDITS_KEY } from "../config";
import type { BleTagMarker } from "../ble/types";

export type MarkerEditEntry = {
  id: number;
  ble: string;
  lat: number;
  lng: number;
  origLat?: number;
  origLng?: number;
  updatedAt: string;
};

export type MarkerEditQueue = {
  version: 1;
  companyId: number | null;
  edits: MarkerEditEntry[];
};

function emptyQueue(): MarkerEditQueue {
  return { version: 1, companyId: null, edits: [] };
}

export async function loadMarkerEditQueue(): Promise<MarkerEditQueue> {
  const raw = await AsyncStorage.getItem(BLE_OFFLINE_MARKER_EDITS_KEY);
  if (!raw) return emptyQueue();
  try {
    const data = JSON.parse(raw) as MarkerEditQueue;
    if (!data || !Array.isArray(data.edits)) return emptyQueue();
    return data;
  } catch {
    return emptyQueue();
  }
}

async function saveMarkerEditQueue(queue: MarkerEditQueue): Promise<void> {
  await AsyncStorage.setItem(BLE_OFFLINE_MARKER_EDITS_KEY, JSON.stringify(queue));
}

export async function countPendingMarkerEdits(): Promise<number> {
  return (await loadMarkerEditQueue()).edits.length;
}

export async function upsertMarkerEdit(entry: Omit<MarkerEditEntry, "updatedAt">): Promise<void> {
  const q = await loadMarkerEditQueue();
  const row: MarkerEditEntry = { ...entry, updatedAt: new Date().toISOString() };
  const idx = q.edits.findIndex((e) => e.id === row.id);
  if (idx >= 0) q.edits[idx] = row;
  else q.edits.push(row);
  q.companyId = BLE_DEFAULT_COMPANY_ID;
  await saveMarkerEditQueue(q);
}

export async function mergeSessionEdits(
  session: Map<number, MarkerEditEntry>,
): Promise<number> {
  if (!session.size) return 0;
  for (const e of session.values()) {
    await upsertMarkerEdit(e);
  }
  return session.size;
}

export async function clearMarkerEditsByIds(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const set = new Set(ids);
  const q = await loadMarkerEditQueue();
  q.edits = q.edits.filter((e) => !set.has(e.id));
  await saveMarkerEditQueue(q);
}

export async function clearAllMarkerEdits(): Promise<void> {
  await saveMarkerEditQueue(emptyQueue());
}

export function applyMarkerEditsToList(
  markers: BleTagMarker[],
  edits: MarkerEditEntry[],
): BleTagMarker[] {
  if (!edits.length) return markers;
  const byId = new Map(edits.map((e) => [e.id, e]));
  return markers.map((m) => {
    if (m.id == null) return m;
    const e = byId.get(m.id);
    if (!e) return m;
    return { ...m, lat: e.lat, lng: e.lng };
  });
}

export async function applyQueuedEditsToMarkers(
  markers: BleTagMarker[],
): Promise<BleTagMarker[]> {
  const q = await loadMarkerEditQueue();
  return applyMarkerEditsToList(markers, q.edits);
}
