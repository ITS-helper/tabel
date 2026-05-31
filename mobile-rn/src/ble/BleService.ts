import { BleManager, Device, State } from "react-native-ble-plx";
import {
  gattCharUuid,
  GATT_BATTERY_CHAR,
  GATT_BATTERY_SERVICE,
  GATT_WW_READ_SUFFIXES,
  GATT_WW_SERVICE,
} from "../config";
import { GATT_READ_ORDER, parseGattReads } from "./gattTelemetry";
import type { AdvTelemetry, GattLiveTelemetry, ScannedDevice } from "./types";
import {
  bleFromDeviceName,
  bleFromManufacturerData,
  isWwAdvertisement,
  normalizeMac,
} from "./wwAdvert";

const SCAN_MODE = { allowDuplicates: true };

type ScanListener = (devices: ScannedDevice[]) => void;

function parseWwAdvTelemetry(manufacturerData: string | null): AdvTelemetry | null {
  if (!manufacturerData) return null;
  const md = { "": manufacturerData };
  const nums: number[] = [];
  try {
    const binary = atob(manufacturerData);
    for (let i = 0; i < binary.length; i++) nums.push(binary.charCodeAt(i) & 0xff);
  } catch {
    return null;
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
  private manager = new BleManager();
  private devices = new Map<string, ScannedDevice>();
  private scanning = false;
  private paused = false;
  private listener: ScanListener | null = null;
  private connectedId: string | null = null;

  async ensureReady(): Promise<void> {
    const state = await this.manager.state();
    if (state === State.PoweredOff) {
      throw new Error("Включите Bluetooth на устройстве");
    }
    if (state !== State.PoweredOn) {
      await new Promise<void>((resolve, reject) => {
        const sub = this.manager.onStateChange((s) => {
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
      this.manager.stopDeviceScan();
      this.scanning = false;
    }
  }

  async resumeScan(): Promise<void> {
    this.paused = false;
    if (this.listener && !this.scanning) {
      await this.startScan();
    }
  }

  async startScan(): Promise<void> {
    await this.ensureReady();
    if (this.paused || this.scanning) return;
    this.scanning = true;
    this.manager.startDeviceScan(null, SCAN_MODE, (error, device) => {
      if (error) {
        console.warn("[BleService] scan", error.message);
        return;
      }
      if (!device || this.paused) return;
      this.ingestDevice(device);
    });
  }

  async stopScan(): Promise<void> {
    this.paused = false;
    if (!this.scanning) return;
    this.manager.stopDeviceScan();
    this.scanning = false;
  }

  async pauseScanKeepList(): Promise<void> {
    await this.stopScan();
    this.paused = true;
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
    const ble = String(tag.ble).replace(/\D/g, "").replace(/^0+/, "");
    for (const dev of this.devices.values()) {
      if (dev.bleFromAdv === ble) return dev;
    }
    return null;
  }

  private ingestDevice(device: Device) {
    const mdStr = device.manufacturerData ?? null;
    const md = mdStr ? { "": mdStr } : null;
    const bleFromAdv = bleFromManufacturerData(md);
    const isWw = isWwAdvertisement({
      manufacturerData: md,
      serviceUUIDs: device.serviceUUIDs,
    });

    const entry: ScannedDevice = {
      id: device.id,
      name: device.name ?? device.localName ?? null,
      rssi: device.rssi,
      lastSeen: Date.now(),
      bleFromAdv: bleFromAdv || bleFromDeviceName(device.name ?? device.localName),
      isWw,
      advTelemetry: parseWwAdvTelemetry(mdStr) ?? undefined,
    };

    this.devices.set(device.id, entry);
    this.listener?.(Array.from(this.devices.values()));
  }

  async connectToTag(deviceId: string): Promise<void> {
    await this.pauseScanKeepList();
    const device = await this.manager.connectToDevice(deviceId, { timeout: 12_000 });
    await device.discoverAllServicesAndCharacteristics();
    this.connectedId = deviceId;
  }

  async disconnect(): Promise<void> {
    if (!this.connectedId) return;
    try {
      await this.manager.cancelDeviceConnection(this.connectedId);
    } catch {
      /* ignore */
    }
    this.connectedId = null;
  }

  async readTagGattTelemetry(
    deviceId: string,
    scanHint?: { rssi?: number | null; advTelemetry?: AdvTelemetry },
  ): Promise<GattLiveTelemetry> {
    let device = await this.manager.isDeviceConnected(deviceId)
      ? await this.manager.devices([deviceId]).then((d) => d[0])
      : null;
    if (!device) {
      await this.pauseScanKeepList();
      device = await this.manager.connectToDevice(deviceId, { timeout: 12_000 });
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
      if (this.listener) await this.startScan();
    }
  }

  destroy(): void {
    void this.stopScan();
    this.manager.destroy();
  }
}

export const BleService = new BleServiceImpl();
