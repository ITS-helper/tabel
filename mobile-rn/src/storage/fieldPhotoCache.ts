import {
  documentDirectory,
  EncodingType,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RawBlePoint } from "../ble/types";
import {
  collectPhotoUrlsFromRaw,
  photoUrlPathnameKey,
  isYandexPhotoUrl,
  toBlePhotoProxyUrl,
} from "../api/photoUtils";

export const FIELD_PHOTOS_DIR = `${documentDirectory}ww-ble-photos/`;
const PHOTO_INDEX_KEY = "ww-ble-photo-index-v1";
const PHOTO_META_KEY = "ww-ble-photo-meta-v1";
const PHOTO_BATCH = 6;
const PHOTO_MAX_BYTES = 2.5 * 1024 * 1024;

function btoaFromBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export type PhotoCacheMeta = {
  photoCount: number;
  bytesTotal: number;
  lastSyncAt: number | null;
  lastSyncOk: number;
  lastSyncFail: number;
};

type PhotoIndex = Record<string, string>;

async function loadIndex(): Promise<PhotoIndex> {
  const raw = await AsyncStorage.getItem(PHOTO_INDEX_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PhotoIndex;
  } catch {
    return {};
  }
}

async function saveIndex(index: PhotoIndex): Promise<void> {
  await AsyncStorage.setItem(PHOTO_INDEX_KEY, JSON.stringify(index));
}

export async function loadPhotoCacheMeta(): Promise<PhotoCacheMeta> {
  const raw = await AsyncStorage.getItem(PHOTO_META_KEY);
  if (!raw) {
    return {
      photoCount: 0,
      bytesTotal: 0,
      lastSyncAt: null,
      lastSyncOk: 0,
      lastSyncFail: 0,
    };
  }
  try {
    return JSON.parse(raw) as PhotoCacheMeta;
  } catch {
    return {
      photoCount: 0,
      bytesTotal: 0,
      lastSyncAt: null,
      lastSyncOk: 0,
      lastSyncFail: 0,
    };
  }
}

async function savePhotoCacheMeta(meta: PhotoCacheMeta): Promise<void> {
  await AsyncStorage.setItem(PHOTO_META_KEY, JSON.stringify(meta));
}

function localPathForUrl(url: string): string {
  const key = photoUrlPathnameKey(url).replace(/[^a-z0-9._-]+/gi, "_");
  return `${FIELD_PHOTOS_DIR}${key.slice(0, 180)}.jpg`;
}

export async function getLocalPhotoUri(url: string): Promise<string | null> {
  if (!url) return null;
  const index = await loadIndex();
  const path = index[url] || index[photoUrlPathnameKey(url)];
  if (!path) return null;
  const info = await getInfoAsync(path);
  return info.exists ? path : null;
}

/** Data URI для WebView — file:// в img внутри WebView на Android не работает. */
export async function getLocalPhotoDataUri(url: string): Promise<string | null> {
  const path = await getLocalPhotoUri(url);
  if (!path) return null;
  try {
    const b64 = await readAsStringAsync(path, { encoding: EncodingType.Base64 });
    return b64 ? `data:image/jpeg;base64,${b64}` : null;
  } catch {
    return null;
  }
}

async function fetchPhotoBytes(url: string): Promise<ArrayBuffer | null> {
  const tryFetch = async (fetchUrl: string) => {
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > PHOTO_MAX_BYTES) throw new Error("too_large");
    return buf;
  };
  try {
    return await tryFetch(url);
  } catch {
    try {
      return await tryFetch(toBlePhotoProxyUrl(url));
    } catch {
      return null;
    }
  }
}

export async function syncFieldPhotosFromRaw(
  raw: RawBlePoint[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; fail: number; skipped: number }> {
  await makeDirectoryAsync(FIELD_PHOTOS_DIR, { intermediates: true });

  const urls = collectPhotoUrlsFromRaw(raw, { allowExpired: true });
  const index = await loadIndex();
  const pathnameFromRaw = new Set(urls.map(photoUrlPathnameKey));
  const missing: string[] = [];
  let indexDirty = false;
  for (const u of urls) {
    const pathKey = photoUrlPathnameKey(u);
    const p = index[u] || index[pathKey];
    if (!p) {
      missing.push(u);
      continue;
    }
    const info = await getInfoAsync(p);
    if (!info.exists) {
      delete index[u];
      delete index[pathKey];
      indexDirty = true;
      missing.push(u);
    }
  }

  for (const key of Object.keys(index)) {
    if (key.startsWith("http") && !pathnameFromRaw.has(photoUrlPathnameKey(key))) {
      delete index[key];
      indexDirty = true;
    }
  }

  let ok = 0;
  let fail = 0;
  let skipped = urls.length - missing.length;
  let bytesTotal = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < missing.length) {
      const i = cursor++;
      const url = missing[i];
      try {
        const buf = await fetchPhotoBytes(url);
        if (!buf?.byteLength) {
          fail++;
          continue;
        }
        const path = localPathForUrl(url);
        await writeAsStringAsync(path, btoaFromBuffer(buf), {
          encoding: EncodingType.Base64,
        });
        index[url] = path;
        index[photoUrlPathnameKey(url)] = path;
        bytesTotal += buf.byteLength;
        ok++;
      } catch {
        fail++;
      }
      onProgress?.(ok + fail + skipped, urls.length);
    }
  };

  const n = Math.min(PHOTO_BATCH, Math.max(missing.length, 1));
  if (missing.length) {
    await Promise.all(Array.from({ length: n }, () => worker()));
    indexDirty = true;
  }
  if (indexDirty) {
    await saveIndex(index);
  }

  const prev = await loadPhotoCacheMeta();
  const uniquePaths = new Set(Object.values(index));
  const meta: PhotoCacheMeta = {
    photoCount: uniquePaths.size,
    bytesTotal: prev.bytesTotal + bytesTotal,
    lastSyncAt: Date.now(),
    lastSyncOk: ok,
    lastSyncFail: fail,
  };
  await savePhotoCacheMeta(meta);

  return { ok, fail, skipped };
}
