import AsyncStorage from "@react-native-async-storage/async-storage";
import { FINDER_BG_STORAGE_KEY } from "../config";

export type PersistedFinderSession = {
  input: string;
  tab: "tags" | "watch";
  targets: Array<{ ble: string; foundAt?: number }>;
  active: boolean;
};

export async function loadFinderSession(): Promise<PersistedFinderSession | null> {
  try {
    const raw = await AsyncStorage.getItem(FINDER_BG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedFinderSession;
    if (!parsed || !Array.isArray(parsed.targets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveFinderSession(
  session: PersistedFinderSession | null,
): Promise<void> {
  if (!session) {
    await AsyncStorage.removeItem(FINDER_BG_STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(FINDER_BG_STORAGE_KEY, JSON.stringify(session));
}
