export type ScannedDevice = {
  id: string;
  name: string | null;
  rssi: number | null;
  lastSeen: number;
  bleFromAdv: string;
  isWw: boolean;
  advTelemetry?: AdvTelemetry;
};

export type AdvTelemetry = {
  chargeValue?: number;
  power?: number;
  bleType?: number;
};

export type RawBlePoint = {
  id?: number;
  ble_number?: number | string;
  bleNumber?: number | string;
  name?: string;
  nameExtended?: string;
  name_extended?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
  charge_value?: number | null;
  movability_type?: number;
  power?: number;
  frequency?: number;
  status?: number;
  ble_type?: number;
  firmware_version?: string;
  hardware_version?: string;
  mac_address?: string;
  chip_uuid?: string;
  record_dt?: string;
  ble_zone_id?: number;
  ble_zoneId?: number;
  bleRoute?: { id?: number; title?: string };
  ble_route?: { id?: number; title?: string } | number | string;
  ble_route_id?: number;
  bleRouteId?: number;
  route_title?: string;
  bleRouteTitle?: string;
  ble_image_url?: string;
  bleImageUrl?: string;
  ble_image?: string;
  location_image_url?: string;
  locationImageUrl?: string;
  location_image?: string;
  updated_at?: string;
  ble_image_status?: string;
  ble_location_image_status?: string;
  location_desc?: string;
  ble_type_desc?: string;
};

export type BleTagMarker = {
  id?: number;
  ble: string;
  title?: string;
  lat?: number;
  lng?: number;
  charge?: number | null;
  movabilityType?: number;
  power?: number;
  frequency?: number;
  statusCode?: number;
  bleTypeNum?: number | null;
  firmwareVersion?: string;
  mac?: string;
  chipUuid?: string;
  isInspected?: boolean;
  isLowBattery?: boolean;
  recordDt?: string;
  status?: "ok" | "battery" | "inspection";
  routeId?: number | null;
  routeTitle?: string;
  zoneId?: number | null;
  photoTag?: string;
  photoPlace?: string;
  locationDesc?: string;
  bleTypeLabel?: string;
};

export type BleRoute = {
  id: number;
  title: string;
  total?: number;
  inspectedToday?: number;
};

export type BleZone = {
  id: number;
  name: string;
  description: string;
  color: string;
  pts: [number, number][];
  ptsSource?: "api" | "hull";
};

export type GattLiveTelemetry = {
  chargeValue: number | null;
  power: number | null;
  frequency: number | null;
  bleType: number | null;
  rssi: number | null;
  fromGatt: boolean;
};

export type FieldCheckin = {
  id: string;
  routeId: string;
  routeTitle: string;
  bleNumber: string;
  ble_id?: number | null;
  mac_address: string;
  latitude?: number | null;
  longitude?: number | null;
  rssi?: number | null;
  checkedAt: string;
  uploaded: boolean;
  uploadedAt?: string;
  movabilityType?: number;
  chargeValue?: number;
  statusCode?: number;
  power?: number;
  frequency?: number;
  bleType?: number;
  firmwareVersion?: string;
  gattLive?: boolean;
  passUid?: string;
  passUidReversed?: string;
  passScannedAt?: string;
};

export type PassScan = {
  uid: string;
  uidReversed?: string;
  bytes?: number[];
  techs?: string[];
  scannedAt: string;
};

export type CheckinStore = {
  version: 2;
  checkins: FieldCheckin[];
  dailyPatrol: Record<string, Record<string, string[]>>;
  dailyRouteResets: Record<string, Record<string, boolean>>;
  dailyPassScans: Record<string, PassScan>;
};

export type RouteRef = {
  routeId: string;
  routeTitle: string;
};
