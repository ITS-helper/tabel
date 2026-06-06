import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import { toBlePhotoProxyUrl } from "../api/photoUtils";
import type { BleTagMarker, BleZone } from "../ble/types";
import { markerZoneTypeLabel } from "../ble/zoneType";
import { BLE_DEFAULT_CENTER_BLE } from "../config";
import { useTheme } from "../context/ThemeContext";
import { buildLeafletHtml } from "../map/leafletHtml";
import { resolveSearchFocus } from "../map/mapHelpers";
import { coordsFromRaw } from "../storage/markerNormalize";
import { getLocalPhotoDataUri } from "../storage/fieldPhotoCache";
import { normalizeBle } from "../ble/wwAdvert";
import type { AppColors } from "../theme/palettes";

export type MapMarkerPayload = {
  id?: number;
  ble: string;
  lat: number;
  lng: number;
  status?: BleTagMarker["status"];
  title?: string;
  routeTitle?: string;
  locationDesc?: string;
  bleTypeLabel?: string;
  recordDt?: string;
  isInspected?: boolean;
  photoTag?: string;
  photoPlace?: string;
};

type Props = {
  markers: BleTagMarker[];
  zones: BleZone[];
  query: string;
  findTag: (ble: string) => BleTagMarker | undefined;
  clusterEnabled?: boolean;
  editMode?: boolean;
  dirtyIds?: number[];
  onMarkerMoved?: (id: number, ble: string, lat: number, lng: number) => void;
  onPatrol?: (tag: BleTagMarker) => void;
  /** Меняется после syncFieldPhotosFromRaw — перечитать file:// в попапах. */
  photoCacheTick?: number | null;
};

function pushMapUpdate(webRef: RefObject<WebView | null>, payload: unknown) {
  const json = JSON.stringify(payload);
  webRef.current?.injectJavaScript(
    `(function(){ if(window.__updateMap) window.__updateMap(${json}); })(); true;`,
  );
}

function toMapMarker(m: BleTagMarker): MapMarkerPayload | null {
  const { lat, lng } = coordsFromRaw(m);
  if (lat == null || lng == null) return null;
  const bleTypeLabel = markerZoneTypeLabel(m) || undefined;
  return {
    id: m.id,
    ble: m.ble,
    lat,
    lng,
    status: m.status,
    title: m.title,
    routeTitle: m.routeTitle,
    locationDesc: m.locationDesc,
    bleTypeLabel,
    recordDt: m.recordDt,
    isInspected: m.isInspected,
    photoTag: m.photoTag,
    photoPlace: m.photoPlace,
  };
}

export function BleLeafletMap({
  markers,
  zones,
  query,
  findTag,
  clusterEnabled = true,
  editMode = false,
  dirtyIds = [],
  onMarkerMoved,
  onPatrol,
  photoCacheTick = null,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [photoSrc, setPhotoSrc] = useState<Record<string, string>>({});
  const photoSrcRef = useRef<Record<string, string>>({});
  const photoPendingRef = useRef<Set<string>>(new Set());
  const photoInjectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const html = useMemo(() => buildLeafletHtml(), []);

  useEffect(() => {
    photoSrcRef.current = photoSrc;
  }, [photoSrc]);

  const resolvePhotoUrl = useCallback(async (url: string, force = false) => {
    if (!url) return;
    if (photoPendingRef.current.has(url)) return;
    if (!force && photoSrcRef.current[url]) return;

    photoPendingRef.current.add(url);
    try {
      if (!force) {
        const dataUri = await getLocalPhotoDataUri(url);
        if (dataUri && dataUri.length <= 400_000) {
          setPhotoSrc((prev) =>
            prev[url] === dataUri ? prev : { ...prev, [url]: dataUri },
          );
          return;
        }
        setPhotoSrc((prev) =>
          prev[url] === url ? prev : { ...prev, [url]: url },
        );
        return;
      }
      const src = toBlePhotoProxyUrl(url) || url;
      setPhotoSrc((prev) =>
        prev[url] === src ? prev : { ...prev, [url]: src },
      );
    } finally {
      photoPendingRef.current.delete(url);
    }
  }, []);

  useEffect(() => {
    if (photoCacheTick == null) return;
    setPhotoSrc({});
    photoSrcRef.current = {};
    photoPendingRef.current.clear();
  }, [photoCacheTick]);

  const focusTag = useMemo(
    () => resolveSearchFocus(query, markers, findTag),
    [query, markers, findTag],
  );

  const displayMarkers = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^ble/i, "");
    let list = markers.map(toMapMarker).filter(Boolean) as MapMarkerPayload[];

    if (q && !list.some((m) => normalizeBle(m.ble) === normalizeBle(q))) {
      const global = focusTag ? toMapMarker(focusTag) : null;
      if (global) list = [global];
      else if (q) {
        list = list.filter(
          (m) =>
            String(m.ble).includes(q) ||
            (m.title ?? "").toLowerCase().includes(q),
        );
      }
    } else if (q) {
      list = list.filter(
        (m) =>
          normalizeBle(m.ble) === normalizeBle(q) ||
          String(m.ble).includes(q) ||
          (m.title ?? "").toLowerCase().includes(q),
      );
    }

    return list;
  }, [markers, query, focusTag]);

  const mapPayload = useMemo(
    () => ({
      type: "update" as const,
      markers: displayMarkers,
      zones: zones.map((z) => ({
        id: z.id,
        name: z.name,
        color: z.color,
        pts: z.pts,
      })),
      clusterEnabled: editMode ? false : clusterEnabled,
      editMode,
      dirtyIds,
      bootCenter: query.trim() || editMode ? null : BLE_DEFAULT_CENTER_BLE,
      focus:
        focusTag?.lat != null && focusTag.lng != null
          ? {
              lat: focusTag.lat,
              lng: focusTag.lng,
              ble: focusTag.ble,
              openPopup: !!query.trim(),
            }
          : null,
    }),
    [displayMarkers, zones, clusterEnabled, editMode, dirtyIds, focusTag, query],
  );

  useEffect(() => {
    if (!ready) return;
    pushMapUpdate(webRef, mapPayload);
  }, [ready, mapPayload]);

  useEffect(() => {
    if (!ready || !Object.keys(photoSrc).length) return;
    if (photoInjectTimerRef.current) clearTimeout(photoInjectTimerRef.current);
    photoInjectTimerRef.current = setTimeout(() => {
      const json = JSON.stringify(photoSrc);
      webRef.current?.injectJavaScript(
        `(function(){ if(window.__updatePhotoSrc) window.__updatePhotoSrc(${json}); })(); true;`,
      );
    }, 80);
    return () => {
      if (photoInjectTimerRef.current) clearTimeout(photoInjectTimerRef.current);
    };
  }, [ready, photoSrc]);

  const onMessage = useCallback(
    (ev: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(ev.nativeEvent.data) as {
          type?: string;
          ble?: string;
          id?: number;
          lat?: number;
          lng?: number;
          url?: string;
          force?: boolean;
        };
        if (data.type === "ready") {
          setReady(true);
          pushMapUpdate(webRef, mapPayload);
          return;
        }
        if (data.type === "markerMoved" && data.id != null && data.lat != null && data.lng != null) {
          onMarkerMoved?.(data.id, String(data.ble ?? data.id), data.lat, data.lng);
          return;
        }
        if (data.type === "patrol" && data.ble) {
          const tag =
            markers.find((m) => normalizeBle(m.ble) === normalizeBle(data.ble)) ||
            findTag(data.ble);
          if (tag) onPatrol?.(tag);
          return;
        }
        if (data.type === "photoResolve" && data.url) {
          void resolvePhotoUrl(String(data.url), !!data.force);
        }
      } catch {
        /* ignore */
      }
    },
    [markers, findTag, onPatrol, onMarkerMoved, mapPayload, resolvePhotoUrl],
  );

  const onLoadEnd = useCallback(() => {
    pushMapUpdate(webRef, mapPayload);
  }, [mapPayload]);

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html, baseUrl: "https://local.blemap" }}
        style={styles.web}
        onMessage={onMessage}
        onLoadEnd={onLoadEnd}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        allowFileAccess
        allowUniversalAccessFromFileURLs
        setSupportMultipleWindows={false}
      />
      {!ready ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>Leaflet…</Text>
        </View>
      ) : null}
      {query.trim() && focusTag && !markers.some((m) => normalizeBle(m.ble) === normalizeBle(focusTag.ble)) ? (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>#{focusTag.ble} — другой маршрут</Text>
        </View>
      ) : null}
      {query.trim() && !focusTag && !displayMarkers.length ? (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>Метка «{query.trim()}» не найдена</Text>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: AppColors) =>
  StyleSheet.create({
  wrap: { flex: 1 },
  web: { flex: 1, backgroundColor: "#37474f" },
  loading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(4,8,16,0.65)",
  },
  loadingText: { color: colors.textMuted, fontSize: 13 },
  hint: {
    position: "absolute",
    top: 8,
    left: 8,
    right: 8,
    backgroundColor: "rgba(4,8,16,0.88)",
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hintText: { color: colors.warning, textAlign: "center", fontSize: 12 },
  });
