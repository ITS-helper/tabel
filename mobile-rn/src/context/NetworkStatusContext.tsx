import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  deriveNetworkStatus,
  type NetworkStatus,
} from "../hooks/useNetworkStatus";

type NetworkStatusValue = {
  status: NetworkStatus;
  online: boolean;
  label: string;
};

const NetworkStatusContext = createContext<NetworkStatusValue>({
  status: "checking",
  online: false,
  label: "Сеть…",
});

export function NetworkStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<NetworkStatus>("checking");

  useEffect(() => {
    const apply = (s: NetInfoState) => setStatus(deriveNetworkStatus(s));
    void NetInfo.fetch().then(apply);
    return NetInfo.addEventListener(apply);
  }, []);

  const value = useMemo((): NetworkStatusValue => {
    const label =
      status === "checking"
        ? "Сеть…"
        : status === "online"
          ? "Онлайн"
          : "Офлайн";
    return { status, online: status === "online", label };
  }, [status]);

  return (
    <NetworkStatusContext.Provider value={value}>
      {children}
    </NetworkStatusContext.Provider>
  );
}

export function useNetworkStatus(): NetworkStatusValue {
  return useContext(NetworkStatusContext);
}
