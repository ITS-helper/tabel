import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Vibration, type AppStateStatus } from "react-native";
import { playFinderFoundSound } from "../audio/finderFoundSound";
import { BleService } from "../ble/BleService";
import { matchFinderTarget } from "../ble/finderMatch";
import type { ScannedDevice } from "../ble/types";
import { normalizeBle } from "../ble/wwAdvert";
import { FOUND_SOUND_COOLDOWN_MS } from "../config";
import {
  loadFinderSession,
  saveFinderSession,
  type PersistedFinderSession,
} from "../storage/finderSession";

export type FinderTarget = { ble: string; foundAt?: number };

type FinderContextValue = {
  input: string;
  setInput: (v: string) => void;
  tab: "tags" | "watch";
  setTab: (tab: "tags" | "watch") => void;
  targets: FinderTarget[];
  scanning: boolean;
  pausedByField: boolean;
  devices: ScannedDevice[];
  foundMap: Map<string, ScannedDevice>;
  status: string | null;
  startFinder: () => Promise<void>;
  stopFinder: () => Promise<void>;
};

const FinderContext = createContext<FinderContextValue | null>(null);

function parseInputTokens(input: string, tab: "tags" | "watch"): FinderTarget[] {
  return input
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((ble) => ({
      ble: tab === "watch" ? ble.toLowerCase() : normalizeBle(ble),
    }));
}

export function FinderProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<"tags" | "watch">("tags");
  const [targets, setTargets] = useState<FinderTarget[]>([]);
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [pausedByField, setPausedByField] = useState(false);
  const lastAlertRef = useRef<Map<string, number>>(new Map());
  const restoredRef = useRef(false);

  useEffect(() => {
    BleService.onFieldPatrolChange((active) => setPausedByField(active));
    return () => BleService.onFieldPatrolChange(null);
  }, []);

  const persist = useCallback(
    async (active: boolean, nextTargets = targets) => {
      const payload: PersistedFinderSession = {
        input,
        tab,
        targets: nextTargets,
        active,
      };
      await saveFinderSession(active ? payload : null);
    },
    [input, tab, targets],
  );

  const foundMap = useMemo(() => {
    const map = new Map<string, ScannedDevice>();
    for (const t of targets) {
      for (const d of devices) {
        if (matchFinderTarget(d, t.ble, tab === "watch")) {
          map.set(t.ble, d);
          break;
        }
      }
    }
    return map;
  }, [devices, targets, tab]);

  const alertFound = useCallback((key: string, firstFound: boolean) => {
    Vibration.vibrate(firstFound ? [80, 40, 120] : 120);
    void playFinderFoundSound();
  }, []);

  useEffect(() => {
    if (!scanning || targets.length === 0) return;
    const now = Date.now();
    let changed = false;
    const next = targets.map((t) => {
      const dev = foundMap.get(t.ble);
      if (!dev) return t;
      const prevAlert = lastAlertRef.current.get(t.ble) ?? 0;
      const firstFound = t.foundAt == null;
      const cooldownOk = now - prevAlert >= FOUND_SOUND_COOLDOWN_MS;
      if (firstFound || cooldownOk) {
        changed = true;
        lastAlertRef.current.set(t.ble, now);
        alertFound(t.ble, firstFound);
        return { ...t, foundAt: t.foundAt ?? now };
      }
      return t;
    });
    if (changed) {
      setTargets(next);
      if (scanning) void persist(true, next);
    }
  }, [alertFound, foundMap, persist, scanning, targets]);

  useEffect(() => {
    BleService.onScanUpdate(setDevices);
    return () => {
      BleService.onScanUpdate(null);
    };
  }, []);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    void (async () => {
      const saved = await loadFinderSession();
      if (!saved?.active || !saved.targets.length) return;
      setInput(saved.input);
      setTab(saved.tab);
      setTargets(saved.targets);
      lastAlertRef.current = new Map();
      try {
        await BleService.startFinderSession({
          targets: saved.targets.map((t) => t.ble),
          watchMode: saved.tab === "watch",
        });
        setScanning(true);
        setStatus("Фоновый поиск (восстановлен)…");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "BLE ошибка");
      }
    })();
  }, []);

  const ensureScanAlive = useCallback(async () => {
    if (!BleService.isFinderSessionActive() || BleService.isFieldPatrolActive()) return;
    if (!BleService.isScanning()) {
      try {
        const session = BleService.getFinderSession();
        if (session) await BleService.startFinderSession(session);
      } catch (e) {
        console.warn("[FinderContext] resume scan", e);
      }
    }
  }, []);

  useEffect(() => {
    const onState = (state: AppStateStatus) => {
      if (state === "active" || state === "background") {
        void ensureScanAlive();
      }
    };
    const sub = AppState.addEventListener("change", onState);
    const tick = setInterval(() => {
      if (AppState.currentState === "active" || AppState.currentState === "background") {
        void ensureScanAlive();
      }
    }, 45_000);
    return () => {
      sub.remove();
      clearInterval(tick);
    };
  }, [ensureScanAlive]);

  const startFinder = useCallback(async () => {
    const list = parseInputTokens(input, tab);
    if (!list.length) return;
    lastAlertRef.current = new Map();
    setTargets(list);
    try {
      await BleService.startFinderSession({
        targets: list.map((t) => t.ble),
        watchMode: tab === "watch",
      });
      setScanning(true);
      setStatus(
        BleService.isFieldPatrolActive()
          ? "Поиск в очереди — идёт обход…"
          : "Фоновый поиск… можно свернуть приложение",
      );
      await persist(true, list);
    } catch (e) {
      setScanning(false);
      setStatus(e instanceof Error ? e.message : "BLE ошибка");
    }
  }, [input, persist, tab]);

  const stopFinder = useCallback(async () => {
    await BleService.stopFinderSession();
    setScanning(false);
    setStatus(null);
    await persist(false);
  }, [persist]);

  const value: FinderContextValue = {
    input,
    setInput,
    tab,
    setTab,
    targets,
    scanning,
    pausedByField: pausedByField && scanning,
    devices,
    foundMap,
    status,
    startFinder,
    stopFinder,
  };

  return (
    <FinderContext.Provider value={value}>{children}</FinderContext.Provider>
  );
}

export function useFinder(): FinderContextValue {
  const ctx = useContext(FinderContext);
  if (!ctx) throw new Error("useFinder outside FinderProvider");
  return ctx;
}
