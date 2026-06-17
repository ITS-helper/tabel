import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import type { PassScan } from "../ble/types";
import { scanNfcPass } from "../native/NfcPass";
import { getTodayPassScan, loadStore, saveTodayPassScan } from "../storage/checkins";
import { useTheme } from "./ThemeContext";

type PassContextValue = {
  passScan: PassScan | null;
  passBusy: boolean;
  requestPassScan: (manual?: boolean) => Promise<void>;
  refreshPassScan: () => Promise<void>;
};

const PassContext = createContext<PassContextValue | null>(null);

function formatNfcError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("NFC_DISABLED")) {
    return "NFC выключен. Включите NFC в настройках телефона.";
  }
  if (msg.includes("NFC_UNAVAILABLE")) {
    return "На этом устройстве нет NFC.";
  }
  if (msg.includes("NFC_BUSY")) {
    return "Сканирование пропуска уже запущено.";
  }
  return `Не удалось отсканировать пропуск: ${msg}`;
}

export function PassProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [passScan, setPassScan] = useState<PassScan | null>(null);
  const [passBusy, setPassBusy] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [status, setStatus] = useState("Поднесите свой пропуск к NFC-зоне телефона");
  const [bootChecked, setBootChecked] = useState(false);

  const refreshPassScan = useCallback(async () => {
    const store = await loadStore();
    setPassScan(getTodayPassScan(store));
  }, []);

  const requestPassScan = useCallback(
    async (manual = false) => {
      if (passBusy) return;
      setPromptVisible(true);
      setPassBusy(true);
      setStatus(
        manual
          ? "Поднесите новый пропуск к NFC-зоне телефона"
          : "Поднесите свой пропуск к NFC-зоне телефона",
      );
      try {
        const scan = await scanNfcPass();
        const saved = await saveTodayPassScan({
          uid: scan.uid,
          uidReversed: scan.uidReversed,
          bytes: scan.bytes,
          techs: scan.techs,
          scannedAt: scan.scannedAt || new Date().toISOString(),
        });
        setPassScan(saved);
        Vibration.vibrate([18, 30, 18]);
        setStatus(`Пропуск отсканирован: ${saved.uid}`);
        setPromptVisible(false);
      } catch (e) {
        setStatus(formatNfcError(e));
      } finally {
        setPassBusy(false);
      }
    },
    [passBusy],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const store = await loadStore();
      if (!alive) return;
      const saved = getTodayPassScan(store);
      setPassScan(saved);
      setBootChecked(true);
      if (!saved) {
        void requestPassScan(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [requestPassScan]);

  const value = useMemo(
    () => ({ passScan, passBusy, requestPassScan, refreshPassScan }),
    [passScan, passBusy, requestPassScan, refreshPassScan],
  );

  const blockingVisible = promptVisible || (bootChecked && !passScan);

  return (
    <PassContext.Provider value={value}>
      {children}
      <Modal visible={blockingVisible} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>Отсканируйте пропуск</Text>
            <Text style={styles.text}>
              Приложение запомнит MIFARE-карту на сегодня и будет использовать её при
              отправке обходов на сервер.
            </Text>
            <View style={styles.statusBox}>
              {passBusy ? <ActivityIndicator color={colors.accent} /> : null}
              <Text style={styles.status}>{status}</Text>
            </View>
            <Pressable
              style={[styles.button, passBusy && styles.buttonOff]}
              disabled={passBusy}
              onPress={() => void requestPassScan(true)}
            >
              <Text style={styles.buttonText}>
                {passBusy ? "Ждём карту..." : "Сканировать"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </PassContext.Provider>
  );
}

export function usePassScan() {
  const ctx = useContext(PassContext);
  if (!ctx) throw new Error("usePassScan must be used inside PassProvider");
  return ctx;
}

const createStyles = (colors: ReturnType<typeof useTheme>["colors"]) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.78)",
      justifyContent: "center",
      padding: 18,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 18,
      gap: 14,
    },
    title: { color: colors.text, fontSize: 20, fontWeight: "800" },
    text: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
    statusBox: {
      minHeight: 52,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    status: { color: colors.warning, flex: 1, fontSize: 13 },
    button: {
      backgroundColor: colors.success,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonOff: { opacity: 0.6 },
    buttonText: { color: "#fff", fontWeight: "800" },
  });
