import { BleManager, Device, State } from "react-native-ble-plx";
import {
  gattCharUuid,
  GATT_BATTERY_CHAR,
  GATT_BATTERY_SERVICE,
  GATT_WW_READ_SUFFIXES,
  GATT_WW_SERVICE,
  NEARBY_TTL_MS,
} from "../config";
import { GATT_READ_ORDER, parseGattReads } from "./gattTelemetry";
import { requestBlePermissions } from "./requestBlePermissions";
import type { AdvTelemetry, BleTagMarker, GattLiveTelemetry, ScannedDevice } from "./types";
import {
  bleFromDeviceName,
  bleFromManufacturerData,
  isWwAdvertisement,
  manufacturerDataToRecord,
  normalizeBle,
  normalizeMac,
} from "./wwAdvert";

const SCAN_MODE = { allowDuplicates: true };

type ScanListener = (devices: ScannedDevice[]) => void;
type ScanMode = "field" | "finder";

function parseWwAdvTelemetry(
  manufacturerData: string | Record<string, string> | null,
): AdvTelemetry | null {
  const rec = manufacturerDataToRecord(manufacturerData);
  const nums: number[] = [];
  for (const val of Object.values(rec)) {
    if (!val) continue;
    try {
      const binary = atob(val);
      for (let i = 0; i < binary.length; i++) nums.push(binary.charCodeAt(i) & 0xff);
    } catch {
      /* skip */
    }
  }
  for (let i = 0; i <= nums.length - 6; i++) {
    if (nums[i] === 0xa5 && nums[i + 1] === 8 && nums[i + 2] === 0 && nums[i + 3] === 1) {
      const out: AdvTelemetry = {};
      if (nums.length > i + 6 && nums[i + 6] <= 100) out.chargeValue = nums[i + 6];
      if (nums.length > i + 7 && nums[i + 7] >= 1 && nums[i + 7] <= 20) {
        out.bleType = nums[i + 7];
      }
      if (nums.length > i + 8 && nums[i + 8] <= 10) out.power = nums[i + 8];
      if (Object.keys(out).length) return out;
    }
  }
  return null;
}

class BleServiceImpl {
  private manager: BleManager | null = null;
  private devices = new Map<string, ScannedDevice>();
  private scanning = false;
  private paused = false;
  private listener: ScanListener | null = null;
  private connectedId: string | null = null;
  private knownTags: BleTagMarker[] = [];
  private scanMode: ScanMode = "field";
  private finderTargets = new Set<string>();
  private finderWatchMode = false;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  private get ble(): BleManager {
    if (!this.manager) this.manager = new BleManager();
    return this.manager;
  }

  setKnownTags(tags: BleTagMarker[]) {
    this.knownTags = tags;
  }

  setFinderTargets(bles: string[]) {
    this.finderTargets = new Set(bles.map((b) => normalizeBle(b)).filter(Boolean));
  }

  setFinderWatchMode(v: boolean) {
    this.finderWatchMode = v;
  }

  private tagMacKeys(tag: BleTagMarker): string[] {
    return [normalizeMac(tag.mac), normalizeMac(tag.chipUuid)].filter(Boolean);
  }

  private acceptDevice(
    device: Device,
    bleFromAdv: string,
    isWw: boolean,
  ): boolean {
    if (this.scanMode === "finder") {
      if (this.finderWatchMode) return true;
      if (isWw) return true;
      const name = device.name ?? device.localName ?? "";
      if (this.finderTargets.size) {
        const ble = bleFromAdv || bleFromDeviceName(name);
        if (ble && this.finderTargets.has(normalizeBle(ble))) return true;
      }
      return false;
    }

    if (isWw) return true;
    const mac = normalizeMac(device.id);
    if (mac) {
      for (const tag of this.knownTags) {
        if (this.tagMacKeys(tag).includes(mac)) return true;
      }
    }
    if (bleFromAdv) {
      const key = normalizeBle(bleFromAdv);
      if (this.knownTags.some((t) => normalizeBle(t.ble) === key)) return true;
    }
    return false;
  }

  private pruneStale() {
    const now = Date.now();
    let changed = false;
    for (const [id, dev] of this.devices) {
      if (now - dev.lastSeen > NEARBY_TTL_MS) {
        this.devices.delete(id);
        changed = true;
      }
    }
    if (changed) this.listener?.(Array.from(this.devices.values()));
  }

  private startPruneTimer() {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => this.pruneStale(), 5000);
  }

  private stopPruneTimer() {
    if (!this.pruneTimer) return;
    clearInterval(this.pruneTimer);
    this.pruneTimer = null;
  }

  async ensureReady(): Promise<void> {
    const granted = await requestBlePermissions();
    if (!granted) {
      throw new Error("Нужно разрешение Bluetooth");
    }
    const state = await this.ble.state();
    if (state === State.PoweredOff) {
      throw new Error("Включите Bluetooth на устройстве");
    }
    if (state !== State.PoweredOn) {
      await new Promise<void>((resolve, reject) => {
        const sub = this.ble.onStateChange((s) => {
          if (s === State.PoweredOn) {
            sub.remove();
            resolve();
          } else if (s === State.Unauthorized) {
            sub.remove();
            reject(new Error("Нет разрешения Bluetooth"));
          }
        }, true);
      });
    }
  }

  onScanUpdate(listener: ScanListener | null) {
    this.listener = listener;
    if (listener) listener(Array.from(this.devices.values()));
  }

  getDevices(): ScannedDevice[] {
    return Array.from(this.devices.values());
  }

  getConnectedId(): string | null {
    return this.connectedId;
  }

  isScanning(): boolean {
    return this.scanning && !this.paused;
  }

  suspendScan(): void {
    this.paused = true;
    if (this.scanning) {
      this.ble.stopDeviceScan();
      this.scanning = false;
      this.stopPruneTimer();
    }
  }

  async resumeScan(): Promise<void> {
    this.paused = false;
    if (this.listener && !this.scanning) {
      await this.startScan(this.scanMode);
    }
  }

  async startScan(mode: ScanMode = "field"): Promise<void> {
    await this.ensureReady();
    if (this.paused || this.scanning) return;
    this.scanMode = mode;
    this.scanning = true;
    this.startPruneTimer();
    this.ble.startDeviceScan(null, SCAN_MODE, (error, device) => {
      if (error) {
        console.warn("[BleService] scan", error.message);
        return;
      }
      if (!device || this.paused) return;
      this.ingestDevice(device);
    });
  }

  async pauseScan(): Promise<void> {
    if (!this.scanning) return;
    this.ble.stopDeviceScan();
    this.scanning = false;
    this.paused = true;
    this.stopPruneTimer();
  }

  async beginScanOnly(fresh = true): Promise<void> {
    if (fresh) {
      this.devices.clear();
      this.listener?.([]);
    }
    this.paused = false;
    await this.startScan(this.scanMode);
  }

  async stopScan(clear = false): Promise<void> {
    this.paused = false;
    if (this.scanning) {
      this.ble.stopDeviceScan();
      this.scanning = false;
    }
    this.stopPruneTimer();
    if (clear) {
      this.devices.clear();
      this.listener?.([]);
    }
  }

  async pauseScanKeepList(): Promise<void> {
    await this.pauseScan();
  }

  clearDevices(): void {
    this.devices.clear();
    this.listener?.([]);
  }

  findDeviceForTag(tag: { ble: string; mac?: string; chipUuid?: string }): ScannedDevice | null {
    const macKeys = [normalizeMac(tag.mac), normalizeMac(tag.chipUuid)].filter(Boolean);
    for (const dev of this.devices.values()) {
      const devMac = normalizeMac(dev.id);
      if (macKeys.includes(devMac)) return dev;
    }
    const ble = normalizeBle(tag.ble);
    for (const dev of this.devices.values()) {
      if (normalizeBle(dev.bleFromAdv) === ble) return dev;
    }
    return null;
  }

  private ingestDevice(device: Device) {
    const mdRaw = device.manufacturerData ?? null;
    const md = manufacturerDataToRecord(mdRaw);
    const bleFromAdv =
      bleFromManufacturerData(mdRaw) ||
      bleFromDeviceName(device.name ?? device.localName);
    const isWw = isWwAdvertisement({
      manufacturerData: mdRaw,
      serviceUUIDs: device.serviceUUIDs,
    });

    if (!this.acceptDevice(device, bleFromAdv, isWw)) return;

    const entry: ScannedDevice = {
      id: device.id,
      name: device.name ?? device.localName ?? null,
      rssi: device.rssi,
      lastSeen: Date.now(),
      bleFromAdv: bleFromAdv || "",
      isWw,
      advTelemetry: parseWwAdvTelemetry(mdRaw) ?? undefined,
    };

    this.devices.set(device.id, entry);
    this.listener?.(Array.from(this.devices.values()));
  }

  async connectToTag(deviceId: string): Promise<void> {
    await this.pauseScanKeepList();
    const device = await this.ble.connectToDevice(deviceId, { timeout: 12_000 });
    await device.discoverAllServicesAndCharacteristics();
    this.connectedId = deviceId;
  }

  async disconnect(): Promise<void> {
    if (!this.connectedId) return;
    try {
      await this.ble.cancelDeviceConnection(this.connectedId);
    } catch {
      /* ignore */
    }
    this.connectedId = null;
  }

  async readTagGattTelemetry(
    deviceId: string,
    scanHint?: { rssi?: number | null; advTelemetry?: AdvTelemetry },
  ): Promise<GattLiveTelemetry> {
    let device = (await this.ble.isDeviceConnected(deviceId))
      ? await this.ble.devices([deviceId]).then((d) => d[0])
      : null;
    if (!device) {
      await this.pauseScanKeepList();
      device = await this.ble.connectToDevice(deviceId, { timeout: 12_000 });
      await device.discoverAllServicesAndCharacteristics();
      this.connectedId = deviceId;
    }

    const reads: Array<{ suffix: string; value: string }> = [];

    for (const suffix of GATT_READ_ORDER) {
      const service =
        suffix === "2a19" ? GATT_BATTERY_SERVICE : GATT_WW_SERVICE;
      const char =
        suffix === "2a19" ? GATT_BATTERY_CHAR : gattCharUuid(suffix);
      try {
        const result = await device.readCharacteristicForService(service, char);
        if (result.value) reads.push({ suffix, value: result.value });
      } catch {
        /* sequential */
      }
    }

    const out = parseGattReads(reads, scanHint?.rssi);
    const adv = scanHint?.advTelemetry;
    if (adv) {
      if (out.chargeValue == null && adv.chargeValue != null) out.chargeValue = adv.chargeValue;
      if (out.power == null && adv.power != null) out.power = adv.power;
      if (out.bleType == null && adv.bleType != null) out.bleType = adv.bleType;
    }

    return out;
  }

  async withGattSession<T>(
    deviceId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    await this.pauseScanKeepList();
    try {
      return await fn();
    } finally {
      await this.disconnect();
      this.paused = false;
      if (this.listener) await this.startScan(this.scanMode);
    }
  }

  destroy(): void {
    void this.stopScan();
    if (this.manager) this.manager.destroy();
    this.manager = null;
  }
}

export const BleService = new BleServiceImpl();
