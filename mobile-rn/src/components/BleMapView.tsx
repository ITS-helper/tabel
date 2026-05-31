import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import MapView from "react-native-map-clustering";
import { Marker, Polygon, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import type { BleTagMarker, BleZone } from "../ble/types";
import { normalizeBle } from "../ble/wwAdvert";

const DEFAULT_REGION: Region = {
  latitude: 59.634,
  longitude: 28.337,
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};

function markerColor(status?: BleTagMarker["status"]): string {
  if (status === "battery") return "#f59e0b";
  if (status === "inspection") return "#ef4444";
  return "#22c55e";
}

type Props = {
  markers: BleTagMarker[];
  zones: BleZone[];
  clusterEnabled: boolean;
  query: string;
  onMarkerPress?: (tag: BleTagMarker) => void;
};

export function BleMapView({
  markers,
  zones,
  clusterEnabled,
  query,
  onMarkerPress,
}: Props) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^ble/i, "");
    if (!q) return markers;
    return markers.filter(
      (m) =>
        String(m.ble).includes(q) ||
        (m.title ?? "").toLowerCase().includes(q),
    );
  }, [markers, query]);

  const initialRegion = useMemo(() => {
    if (!filtered.length) return DEFAULT_REGION;
    const lat = filtered.reduce((s, m) => s + (m.lat ?? 0), 0) / filtered.length;
    const lng = filtered.reduce((s, m) => s + (m.lng ?? 0), 0) / filtered.length;
    return { ...DEFAULT_REGION, latitude: lat, longitude: lng };
  }, [filtered]);

  return (
    <View style={styles.wrap}>
      <MapView
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        mapType="satellite"
        initialRegion={initialRegion}
        clusterColor="#3b82f6"
        clusterTextColor="#fff"
        spiralEnabled
        animationEnabled
        radius={clusterEnabled ? 52 : 1}
        minPoints={clusterEnabled ? 2 : 99}
      >
        {zones.map((z) => (
          <Polygon
            key={`zone-${z.id}`}
            coordinates={z.pts.map(([latitude, longitude]) => ({
              latitude,
              longitude,
            }))}
            strokeColor={z.color}
            fillColor={`${z.color}33`}
            strokeWidth={2}
          />
        ))}
        {filtered.map((m) => (
          <Marker
            key={`${normalizeBle(m.ble)}-${m.id ?? m.mac}`}
            coordinate={{ latitude: m.lat!, longitude: m.lng! }}
            title={m.title || `BLE ${m.ble}`}
            description={m.routeTitle || m.recordDt}
            pinColor={markerColor(m.status)}
            onCalloutPress={() => onMarkerPress?.(m)}
            onPress={() => onMarkerPress?.(m)}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  map: { flex: 1 },
});
