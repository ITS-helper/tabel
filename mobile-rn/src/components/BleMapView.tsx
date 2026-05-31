import { ARCGIS_SATELLITE_URL } from "../config";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import MapView, {
  Marker,
  Polygon,
  PROVIDER_GOOGLE,
  UrlTile,
  type Region,
} from "react-native-maps";
import type { BleTagMarker, BleZone } from "../ble/types";
import { coordsFromRaw } from "../storage/markerNormalize";
import { normalizeBle } from "../ble/wwAdvert";
import { colors } from "../theme/colors";

const DEFAULT_REGION: Region = {
  latitude: 59.6603,
  longitude: 28.3967,
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};

function markerColor(status?: BleTagMarker["status"]): string {
  if (status === "battery") return "#f59e0b";
  if (status === "inspection") return "#ef4444";
  return "#22c55e";
}

function isValidCoordPair(
  lat?: number | null,
  lng?: number | null,
): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function regionForMarkers(markers: BleTagMarker[]): Region {
  if (!markers.length) return DEFAULT_REGION;
  let latSum = 0;
  let lngSum = 0;
  let n = 0;
  for (const m of markers) {
    const { lat, lng } = coordsFromRaw(m);
    if (!isValidCoordPair(lat, lng)) continue;
    latSum += lat;
    lngSum += lng!;
    n++;
  }
  if (!n) return DEFAULT_REGION;
  return {
    ...DEFAULT_REGION,
    latitude: latSum / n,
    longitude: lngSum / n,
  };
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
  const mapRef = useRef<MapView>(null);
  const [ready, setReady] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^ble/i, "");
    const list = markers
      .map((m) => {
        const { lat, lng } = coordsFromRaw(m);
        return isValidCoordPair(lat, lng) ? { ...m, lat, lng } : null;
      })
      .filter(Boolean) as BleTagMarker[];
    if (!q) return list;
    return list.filter(
      (m) =>
        String(m.ble).includes(q) ||
        (m.title ?? "").toLowerCase().includes(q),
    );
  }, [markers, query]);

  const region = useMemo(() => regionForMarkers(filtered), [filtered]);

  useEffect(() => {
    if (!ready || !filtered.length) return;
    mapRef.current?.animateToRegion(region, 450);
  }, [ready, region, filtered.length]);

  const visibleMarkers = useMemo(() => {
    if (!clusterEnabled || filtered.length <= 120) return filtered;
    const step = Math.max(1, Math.ceil(filtered.length / 120));
    return filtered.filter((_, i) => i % step === 0);
  }, [filtered, clusterEnabled]);

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        mapType="none"
        initialRegion={region}
        onMapReady={() => setReady(true)}
        rotateEnabled={false}
        loadingEnabled
        loadingIndicatorColor={colors.accent}
      >
        <UrlTile
          urlTemplate={ARCGIS_SATELLITE_URL}
          maximumZ={18}
          minimumZ={10}
          tileSize={256}
          zIndex={0}
          shouldReplaceMapContent
        />
        {zones.map((z) =>
          z.pts.length >= 3 ? (
            <Polygon
              key={`zone-${z.id}`}
              coordinates={z.pts.map(([latitude, longitude]) => ({
                latitude,
                longitude,
              }))}
              strokeColor={z.color}
              fillColor={`${z.color}44`}
              strokeWidth={2}
            />
          ) : null,
        )}
        {visibleMarkers.map((m) => (
          <Marker
            key={`${normalizeBle(m.ble)}-${m.id ?? m.mac ?? m.ble}`}
            coordinate={{ latitude: m.lat!, longitude: m.lng! }}
            title={m.title || `BLE ${m.ble}`}
            description={m.routeTitle || m.recordDt}
            pinColor={markerColor(m.status)}
            tracksViewChanges={false}
            onPress={() => onMarkerPress?.(m)}
          />
        ))}
      </MapView>
      {!ready ? (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.overlayText}>Карта…</Text>
        </View>
      ) : null}
      {ready && !filtered.length ? (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.overlayText}>
            Нет меток с координатами ({markers.length} в базе)
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  map: { flex: 1, backgroundColor: "#1a2332" },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,20,25,0.35)",
  },
  overlayText: { color: colors.textMuted, textAlign: "center", padding: 16 },
});
