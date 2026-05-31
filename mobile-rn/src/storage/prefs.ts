import AsyncStorage from "@react-native-async-storage/async-storage";
import { BLE_CLUSTER_TOGGLE_KEY } from "../config";

export async function loadClusterEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(BLE_CLUSTER_TOGGLE_KEY);
  if (v === "0") return false;
  return true;
}

export async function saveClusterEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(BLE_CLUSTER_TOGGLE_KEY, on ? "1" : "0");
}

export async function loadRouteFilter(): Promise<{ routeId: string; routeTitle: string }> {
  const raw = await AsyncStorage.getItem("ww-ble-rn-route-filter");
  if (!raw) return { routeId: "", routeTitle: "Все маршруты" };
  try {
    return JSON.parse(raw) as { routeId: string; routeTitle: string };
  } catch {
    return { routeId: "", routeTitle: "Все маршруты" };
  }
}

export async function saveRouteFilter(routeId: string, routeTitle: string): Promise<void> {
  await AsyncStorage.setItem(
    "ww-ble-rn-route-filter",
    JSON.stringify({ routeId, routeTitle }),
  );
}
