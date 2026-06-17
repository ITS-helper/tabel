import { NativeModules, Platform } from "react-native";

export type NfcPassScan = {
  uid: string;
  uidReversed?: string;
  bytes?: number[];
  techs?: string[];
  scannedAt?: string;
};

type NfcPassNative = {
  isSupported(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  scanPass(): Promise<NfcPassScan>;
  cancelScan(): Promise<boolean>;
};

const native = NativeModules.NfcPass as NfcPassNative | undefined;

export async function isNfcPassSupported(): Promise<boolean> {
  if (Platform.OS !== "android" || !native) return false;
  return native.isSupported();
}

export async function isNfcPassEnabled(): Promise<boolean> {
  if (Platform.OS !== "android" || !native) return false;
  return native.isEnabled();
}

export async function scanNfcPass(): Promise<NfcPassScan> {
  if (Platform.OS !== "android" || !native) {
    throw new Error("NFC доступен только в Android APK");
  }
  const scan = await native.scanPass();
  return { ...scan, scannedAt: new Date().toISOString() };
}

export async function cancelNfcPassScan(): Promise<void> {
  if (Platform.OS !== "android" || !native) return;
  await native.cancelScan();
}
