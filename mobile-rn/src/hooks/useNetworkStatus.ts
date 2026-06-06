import type { NetInfoState } from "@react-native-community/netinfo";

export type NetworkStatus = "online" | "offline" | "checking";

export function deriveNetworkStatus(state: NetInfoState): NetworkStatus {
  if (state.isConnected === false) return "offline";
  if (state.isInternetReachable === false) return "offline";
  if (state.isConnected === true) {
    return "online";
  }
  if (state.isConnected === null && state.isInternetReachable === null) {
    return "checking";
  }
  return state.isInternetReachable === true ? "online" : "offline";
}
