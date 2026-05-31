import { bleApiMutate } from "./bleClient";
import {
  clearMarkerEditsByIds,
  loadMarkerEditQueue,
  type MarkerEditEntry,
} from "../storage/markerEdits";
import { isOnline } from "../storage/offlineCache";

export async function saveMarkerPosition(
  id: number,
  lat: number,
  lng: number,
): Promise<void> {
  await bleApiMutate("PUT", `/api/v1/ble/${id}`, {
    latitude: lat,
    longitude: lng,
  });
}

export async function flushMarkerEditQueue(): Promise<number> {
  const q = await loadMarkerEditQueue();
  if (!q.edits.length) return 0;
  if (!(await isOnline())) {
    throw new Error("Нет сети. Подключитесь к интернету и нажмите «Отправить».");
  }

  const saved: number[] = [];
  const failures: { ble: string; message: string }[] = [];

  for (const e of q.edits) {
    try {
      await saveMarkerPosition(e.id, e.lat, e.lng);
      saved.push(e.id);
    } catch (err) {
      failures.push({
        ble: e.ble,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (saved.length) await clearMarkerEditsByIds(saved);

  if (failures.length) {
    const hint = failures[0].message.slice(0, 120);
    if (saved.length) {
      throw new Error(
        `Отправлено ${saved.length} из ${q.edits.length}. Не удалось: #${failures[0].ble} (${hint})`,
      );
    }
    throw new Error(`Не удалось отправить метки: ${hint}`);
  }

  return saved.length;
}

export function sessionEntryFromMove(
  marker: { id?: number; ble: string; lat?: number; lng?: number },
  lat: number,
  lng: number,
  orig?: { lat?: number; lng?: number },
): MarkerEditEntry | null {
  if (marker.id == null) return null;
  return {
    id: marker.id,
    ble: marker.ble,
    lat,
    lng,
    origLat: orig?.lat ?? marker.lat,
    origLng: orig?.lng ?? marker.lng,
    updatedAt: new Date().toISOString(),
  };
}
