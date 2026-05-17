(function () {
  "use strict";

  /** Прямой прокси (часто недоступен без VPN из‑за блокировки *.workers.dev) */
  const BLE_WORKER_BASE = "https://raspy-sound-6f18.kejexu8hem1.workers.dev/proxy";
  /** Тот же API через Supabase Edge (сервер ходит на Worker; браузер — только на supabase.co) */
  const SUPABASE_URL = "https://owcuvcshwtivqueftiuk.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_zMRDhywx67zYK6SLGAyg-A_4KXV_Ujc";
  const BLE_SUPABASE_BASE = `${SUPABASE_URL}/functions/v1/ble-map-proxy`;

  const BLE_TRANSPORTS = [
    { id: "supabase", buildUrl: (path) => BLE_SUPABASE_BASE + path },
    { id: "worker", buildUrl: (path) => BLE_WORKER_BASE + path },
  ];

  /** Список меток (~1.5 МБ): через Supabase Edge пока 500; сначала Worker */
  const BLE_WORKER_ONLY_PATHS = ["/api/v1/map/ble/"];

  const BLE_FETCH_TIMEOUT_MS = 120000;
  const BLE_LIST_FETCH_TIMEOUT_MS = 22000;
  const BLE_STATIC_CACHE_FETCH_MS = 90000;
  const BLE_TRANSPORT_KEY = "ww-ble-transport";
  const BLE_OFFLINE_FIRST_KEY = "ww-ble-offline-first";
  const BLE_DEFAULT_COMPANY_ID = 1;
  const BLE_MARKER_HOLD_MS = 1000;
  const BLE_MAP_BUILD = "20260517d";

  const BLE_TOKEN_KEY = "accessToken";
  const BLE_AUTO_USER = "impl_dept";
  const BLE_AUTO_PASS = "impl_dept_vsm_2024";

  let bleMap = null;
  let bleMapData = [];
  let bleMapFilter = "all";
  let bleMapRouteFilter = "";
  let bleRoutes = [];
  let bleMapInitialized = false;
  let bleZoneData = [];
  let bleClusterGroup = null;

  let bleMapFS = null;
  let bleMapFSFilter = "all";
  let bleMapFSInitialized = false;
  let fsTileLayers = null;
  let fsTileLayerCurrent = "street";
  let bleClusterGroupFS = null;
  let bleMarkerLayerFS = null;

  let bleCompanyId = null;
  let bleEditMode = false;
  let bleDirtyMarkers = new Map();
  const bleDirtyZones = new Map();
  let bleSelectedZoneId = null;
  let bleMarkerLayer = null;
  const bleZoneGroups = new WeakMap();
  const bleZoneVertexByMap = new WeakMap();
  let bleZoneLayers = new Map();
  let bleEditMapMsg = "";

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[m]
    );
  }

  function getBleToken() {
    return localStorage.getItem(BLE_TOKEN_KEY);
  }

  function isMapFullscreenOpen() {
    return document.getElementById("mapFullscreenOverlay")?.classList.contains("open");
  }

  function isEmbeddedEditLayout() {
    return document.body.classList.contains("ble-map--edit-layout");
  }

  function getActiveMap() {
    return isMapFullscreenOpen() && bleMapFS ? bleMapFS : bleMap;
  }

  function notifyMapFullscreenState(open) {
    document.body.classList.toggle("map-fullscreen", open);
    document.documentElement.classList.toggle("map-fullscreen", open);
    try {
      if (window.parent !== window) {
        window.parent.postMessage({ type: "ww-ble-map-fullscreen", open: !!open }, "*");
      }
    } catch {
      /* ignore */
    }
  }

  function enterEmbeddedEditLayout() {
    document.body.classList.add("ble-map--edit-layout");
    notifyMapFullscreenState(true);
    scheduleMapResize();
  }

  function exitEmbeddedEditLayout() {
    document.body.classList.remove("ble-map--edit-layout");
    notifyMapFullscreenState(false);
    scheduleMapResize();
  }

  function getFsSearchQuery() {
    const raw =
      document.getElementById("pf-search")?.value ??
      document.getElementById("mapFsSearch")?.value ??
      "";
    return raw.trim().toLowerCase().replace(/^ble/i, "");
  }

  function showMapMsg(text, type = "") {
    if (!text || type !== "error") return;
    const fsOpen = isMapFullscreenOpen();
    const el = fsOpen ? document.getElementById("mapFsMsg") : document.getElementById("mapMsg");
    if (!el) return;
    el.textContent = text;
    el.className =
      el.id === "mapFsMsg"
        ? "map-msg map-fs-msg error"
        : "map-msg error";
    el.hidden = false;
  }

  function hideMapMsg() {
    const main = document.getElementById("mapMsg");
    const fs = document.getElementById("mapFsMsg");
    if (main) main.hidden = true;
    if (fs) fs.hidden = true;
  }

  function getPreferredTransportId() {
    try {
      const s = sessionStorage.getItem(BLE_TRANSPORT_KEY);
      if (s === "worker" || s === "supabase") return s;
    } catch {
      /* ignore */
    }
    return "supabase";
  }

  function rememberTransport(id) {
    try {
      sessionStorage.setItem(BLE_TRANSPORT_KEY, id);
    } catch {
      /* ignore */
    }
  }

  function transportOrder(path) {
    if (path && path.includes("/token")) {
      return ["supabase", "worker"];
    }
    if (path && isWorkerOnlyBlePath(path)) {
      return ["supabase", "worker"];
    }
    const pref = getPreferredTransportId();
    const ids = BLE_TRANSPORTS.map((t) => t.id);
    return [pref, ...ids.filter((id) => id !== pref)];
  }

  function formatBleError(err, tried) {
    const raw = err?.message || String(err);
    if (err?.name === "AbortError") {
      return "Превышено время ожидания ответа API меток (большой объём данных). Повторите или включите VPN.";
    }
    if (raw === "Failed to fetch" || err?.name === "TypeError") {
      return (
        "Браузер не смог связаться с API меток (" +
        tried.join(" → ") +
        "). Без VPN часто блокируют *.workers.dev — включите VPN или откройте сайт из другой сети."
      );
    }
    if (raw.startsWith("HTTP 5")) {
      return (
        raw +
        " (каналы: " +
        tried.join(" → ") +
        "). Без VPN метки берутся из файла data/ble-map-cache.json на сайте; если карта пустая — обновите кэш (ble-cache-push.bat) или включите VPN."
      );
    }
    return raw;
  }

  function isWorkerOnlyBlePath(path) {
    return BLE_WORKER_ONLY_PATHS.some(
      (prefix) => path === prefix || path.startsWith(prefix)
    );
  }

  function mergeSupabaseHeaders(headers, bleToken) {
    const h = new Headers(headers || {});
    h.set("apikey", SUPABASE_PUBLISHABLE_KEY);
    h.set("Authorization", `Bearer ${SUPABASE_PUBLISHABLE_KEY}`);
    if (bleToken) {
      h.set("x-ble-token", bleToken);
    }
    return h;
  }

  async function bleHttpFetch(path, init = {}) {
    const tried = [];
    let lastErr = null;
    const bleToken =
      init.headers?.Authorization?.replace(/^Bearer\s+/i, "") ||
      init.headers?.authorization?.replace(/^Bearer\s+/i, "") ||
      null;
    for (const tid of transportOrder(path)) {
      const t = BLE_TRANSPORTS.find((x) => x.id === tid);
      if (!t) continue;
      tried.push(tid);
      const url = t.buildUrl(path);
      const headers =
        tid === "supabase"
          ? mergeSupabaseHeaders(init.headers, bleToken)
          : new Headers(init.headers || {});
      const ctrl = new AbortController();
      const timeoutMs = isWorkerOnlyBlePath(path)
        ? BLE_LIST_FETCH_TIMEOUT_MS
        : BLE_FETCH_TIMEOUT_MS;
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
        if (tid === "supabase" && !res.ok) {
          const failover =
            res.status === 404 ||
            res.status === 500 ||
            res.status === 502 ||
            res.status === 503;
          if (failover) {
            lastErr = new Error(`supabase_proxy_${res.status}`);
            continue;
          }
        }
        rememberTransport(tid);
        return res;
      } catch (e) {
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
    }
    const err = lastErr || new Error("Failed to fetch");
    err.bleTriedTransports = tried;
    throw err;
  }

  async function bleAutoLogin() {
    const res = await bleHttpFetch("/api/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `username=${encodeURIComponent(BLE_AUTO_USER)}&password=${encodeURIComponent(BLE_AUTO_PASS)}`,
    });
    if (!res.ok) throw new Error("auto_auth_failed");
    const data = await res.json();
    const token = data.accessToken || data.access_token || data.token;
    if (!token) throw new Error("no_token_in_response");
    localStorage.setItem(BLE_TOKEN_KEY, token);
    return token;
  }

  function formatCacheAge(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("ru-RU", {
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch {
      return String(iso);
    }
  }

  async function fetchBleListCached(companyId) {
    const url = `${SUPABASE_URL}/rest/v1/ble_map_cache?company_id=eq.${companyId}&select=payload,updated_at`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows?.length || !Array.isArray(rows[0].payload)) return null;
    return { data: rows[0].payload, updatedAt: rows[0].updated_at };
  }

  async function fetchBleCacheMeta() {
    const paths = ["data/ble-map-cache-meta.json", "../data/ble-map-cache-meta.json"];
    for (const rel of paths) {
      try {
        const res = await fetch(new URL(rel, window.location.href).href, { cache: "no-cache" });
        if (!res.ok) continue;
        const body = await res.json();
        const companyId = body.company_id ?? body.companyId;
        if (companyId == null) continue;
        return {
          companyId: Number(companyId),
          updatedAt: body.updated_at || body.updatedAt || "",
          count: body.count,
        };
      } catch {
        /* try next path */
      }
    }
    return null;
  }

  async function fetchBleListStatic(companyId) {
    const paths = ["data/ble-map-cache.json", "../data/ble-map-cache.json"];
    for (const rel of paths) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), BLE_STATIC_CACHE_FETCH_MS);
      try {
        const res = await fetch(new URL(rel, window.location.href).href, {
          cache: "no-cache",
          signal: ctrl.signal,
        });
        if (!res.ok) continue;
        const body = await res.json();
        const cid = body.company_id ?? body.companyId;
        if (
          companyId != null &&
          cid != null &&
          Number(cid) !== Number(companyId)
        ) {
          continue;
        }
        const payload = body.payload;
        if (!Array.isArray(payload)) continue;
        return {
          data: payload,
          companyId: cid != null ? Number(cid) : companyId,
          updatedAt: body.updated_at || body.updatedAt || "",
        };
      } catch (e) {
        console.warn("[ble-map] static cache", rel, e?.message || e);
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async function fetchBleListOffline(companyId) {
    const fromSite = await fetchBleListStatic(companyId);
    if (fromSite?.data?.length) return fromSite;
    return fetchBleListCached(companyId);
  }

  async function bleApiFetch(path, retried = false) {
    let token = getBleToken();
    if (!token) {
      if (retried) throw new Error("auth_failed");
      await bleAutoLogin();
      return bleApiFetch(path, true);
    }
    const res = await bleHttpFetch(path, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      if (retried) throw new Error(`HTTP ${res.status}`);
      localStorage.removeItem(BLE_TOKEN_KEY);
      await bleAutoLogin();
      return bleApiFetch(path, true);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function bleApiMutate(method, path, body, retried = false) {
    let token = getBleToken();
    if (!token) {
      if (retried) throw new Error("auth_failed");
      await bleAutoLogin();
      return bleApiMutate(method, path, body, true);
    }
    const res = await bleHttpFetch(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      if (retried) throw new Error(`HTTP ${res.status}`);
      localStorage.removeItem(BLE_TOKEN_KEY);
      await bleAutoLogin();
      return bleApiMutate(method, path, body, true);
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new Error(`HTTP ${res.status}${detail ? ": " + detail.slice(0, 120) : ""}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (res.status === 204 || !ct.includes("json")) return null;
    return res.json();
  }

  function hasUnsavedEdits() {
    return bleDirtyMarkers.size > 0 || bleDirtyZones.size > 0;
  }

  function getZoneDisplayPts(z) {
    const dirty = bleDirtyZones.get(Number(z.id));
    return dirty ? dirty.pts : z.pts;
  }

  function markZoneDirty(zoneId, pts, name, description) {
    bleDirtyZones.set(Number(zoneId), {
      name: name ?? "",
      description: description ?? null,
      pts: pts.map((p) => [p[0], p[1]]),
    });
    updateEditBarState();
  }

  function isNarrowLayout() {
    return window.matchMedia("(max-width: 768px)").matches;
  }

  function isZoneEditAllowed() {
    return bleEditMode && !isNarrowLayout();
  }

  function getMarkerZoneFilterId() {
    if (!isZoneEditAllowed() || bleSelectedZoneId == null) return null;
    return bleSelectedZoneId;
  }

  function syncZoneEditUiClasses() {
    document.body.classList.toggle(
      "ble-map--zone-focus",
      isZoneEditAllowed() && bleSelectedZoneId != null
    );
  }

  function pointInPolygon(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][0];
      const xi = ring[i][1];
      const yj = ring[j][0];
      const xj = ring[j][1];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function getZoneById(zoneId) {
    return bleZoneData.find((z) => Number(z.id) === Number(zoneId));
  }

  function pointBelongsToZone(pt, zoneId) {
    if (zoneId == null) return true;
    const zid = Number(zoneId);
    if (pt.zoneId != null && Number(pt.zoneId) === zid) return true;
    const zone = getZoneById(zid);
    if (!zone?.pts || zone.pts.length < 3) return false;
    return pointInPolygon(pt.lat, pt.lng, zone.pts);
  }

  function polygonLatLngs(layer) {
    let latlngs = layer.getLatLngs();
    while (Array.isArray(latlngs?.[0]) && !("lat" in latlngs[0])) {
      latlngs = latlngs[0];
    }
    return Array.isArray(latlngs) ? latlngs : [];
  }

  function updateZoneEditHint(text) {
    const el = document.getElementById("mapZoneEditHint");
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.hidden = false;
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  }

  function latLngsToPts(latlngs) {
    return latlngs.map((ll) => [ll.lat, ll.lng]);
  }

  function ptsToApiPoints(pts) {
    return pts.map((p) => ({ latitude: p[0], longitude: p[1] }));
  }

  function resetZoneStyles() {
    bleZoneLayers.forEach((entry) => {
      const z = entry.data;
      entry.layer.setStyle({
        color: z.color,
        weight: bleSelectedZoneId === z.id ? 3 : 1.5,
        dashArray: bleSelectedZoneId === z.id ? "6 4" : null,
      });
    });
  }

  function clearZoneVertexHandles(targetMap) {
    if (!targetMap) return;
    const state = bleZoneVertexByMap.get(targetMap);
    if (!state) return;
    try {
      state.handles?.forEach((h) => {
        h.off();
        if (h._map) h._map.removeLayer(h);
      });
      if (state.group?._map) targetMap.removeLayer(state.group);
    } catch {
      /* ignore */
    }
    bleZoneVertexByMap.delete(targetMap);
  }

  function disableAllZonePm() {
    clearZoneVertexHandles(bleMap);
    clearZoneVertexHandles(bleMapFS);
  }

  function ensureZoneVertexPane(map) {
    const paneName = "ble-zone-vertex-pane";
    if (!map.getPane(paneName)) {
      const pane = map.createPane(paneName);
      pane.style.zIndex = "720";
    }
    return paneName;
  }

  function syncZoneVertexHandles(layer, zoneData) {
    const map = layer?._map;
    if (!map || !isZoneEditAllowed() || !zoneData) return;
    clearZoneVertexHandles(map);

    const ring = polygonLatLngs(layer);
    if (ring.length < 3) return;

    const paneName = ensureZoneVertexPane(map);
    const handles = [];

    ring.forEach((ll, index) => {
      const handle = L.marker([ll.lat, ll.lng], {
        icon: L.divIcon({
          className: "ble-zone-vertex-icon",
          html: '<div class="ble-zone-vertex-pin" aria-hidden="true"></div>',
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        pane: paneName,
        interactive: true,
        draggable: true,
        autoPan: true,
        keyboard: false,
        zIndexOffset: 20000,
      });

      const syncRingFromHandle = () => {
        const ringNow = polygonLatLngs(layer);
        ringNow[index] = handle.getLatLng();
        layer.setLatLngs(ringNow.map((p) => L.latLng(p.lat, p.lng)));
      };

      handle.on("click", L.DomEvent.stopPropagation);
      handle.on("mousedown touchstart", L.DomEvent.stopPropagation);
      handle.on("dragstart", () => {
        if (map.dragging) map.dragging.disable();
        layer.closeTooltip?.();
        map.closeTooltip?.();
      });
      handle.on("drag", syncRingFromHandle);
      handle.on("dragend", () => {
        if (map.dragging) map.dragging.enable();
        syncRingFromHandle();
        const entry = bleZoneLayers.get(zoneData.id);
        const pts = latLngsToPts(polygonLatLngs(layer));
        if (entry) entry.data.pts = pts;
        onZoneGeometryChanged(layer);
      });

      handle.addTo(map);
      handles.push(handle);
    });

    try {
      layer.closeTooltip?.();
      map.closeTooltip?.();
      layer.bringToBack?.();
    } catch {
      /* ignore */
    }
    bleZoneVertexByMap.set(map, { group: null, layer, zoneId: zoneData.id, handles });
    updateZoneEditHint(
      `Вершин: ${ring.length} — тяните оранжевые точки. Повторный клик по зоне скрывает вершины.`
    );
  }

  function scheduleZoneVertexHandles(layer, zoneData) {
    syncZoneVertexHandles(layer, zoneData);
    requestAnimationFrame(() => syncZoneVertexHandles(layer, zoneData));
  }

  function onZoneGeometryChanged(layer) {
    const meta = layer?.zoneMeta;
    if (!meta) return;
    const entry = bleZoneLayers.get(meta.id);
    const pts = latLngsToPts(polygonLatLngs(layer));
    if (entry) entry.data.pts = pts;
    markZoneDirty(
      meta.id,
      pts,
      entry?.data.name ?? meta.name,
      entry?.data.description ?? meta.description
    );
  }

  function revertZoneGeometry(zoneId) {
    bleDirtyZones.delete(Number(zoneId));
    const orig = bleZoneData.find((z) => z.id === zoneId);
    const entry = bleZoneLayers.get(zoneId);
    if (entry && orig) {
      entry.layer.setLatLngs(orig.pts.map((p) => L.latLng(p[0], p[1])));
      entry.data.pts = orig.pts.map((p) => [...p]);
    }
  }

  function deselectZoneForEdit() {
    bleSelectedZoneId = null;
    disableAllZonePm();
    resetZoneStyles();
    syncZoneEditUiClasses();
    updateZoneEditHint(
      bleDirtyZones.size
        ? "Вершины скрыты. Есть несохранённые зоны — «Сохранить»."
        : ""
    );
    redrawMapLayers();
    updateEditBarState();
  }

  function selectZoneForEdit(zoneId) {
    if (!isZoneEditAllowed()) return;
    const id = Number(zoneId);
    if (!id) {
      [...bleDirtyZones.keys()].forEach((zid) => revertZoneGeometry(zid));
      bleDirtyZones.clear();
      bleSelectedZoneId = null;
      disableAllZonePm();
      resetZoneStyles();
      syncZoneEditUiClasses();
      updateZoneEditHint("");
      redrawMapLayers();
      updateEditBarState();
      return;
    }
    if (bleSelectedZoneId === id) {
      deselectZoneForEdit();
      return;
    }
    disableAllZonePm();
    bleSelectedZoneId = id;
    syncZoneEditUiClasses();
    redrawMapLayers();
    const entry = bleZoneLayers.get(id);
    if (!entry) {
      updateEditBarState();
      return;
    }
    const layer = entry.layer;
    const map = layer._map || getActiveMap();
    scheduleZoneVertexHandles(layer, entry.data);
    if (map) {
      map.closePopup?.();
      map.closeTooltip?.();
    }
    updateEditBarState();
  }

  function updateEditBarState() {
    const saveBtn = document.getElementById("mapSaveBtn");
    if (saveBtn) saveBtn.disabled = !hasUnsavedEdits();
    const toggle = document.getElementById("mapEditToggle");
    if (toggle) toggle.classList.toggle("active", bleEditMode);
    const tools = document.getElementById("mapEditTools");
    if (tools) tools.hidden = !bleEditMode;
    const editBtn = document.getElementById("mapEditModeBtn");
    if (editBtn) {
      editBtn.classList.toggle("active", bleEditMode);
      editBtn.setAttribute("aria-pressed", bleEditMode ? "true" : "false");
    }
  }

  function cancelAllEdits() {
    bleDirtyMarkers.forEach(({ point, origLat, origLng }) => {
      point.lat = origLat;
      point.lng = origLng;
    });
    bleDirtyMarkers.clear();
    [...bleDirtyZones.keys()].forEach((zid) => revertZoneGeometry(zid));
    bleDirtyZones.clear();
    disableAllZonePm();
    bleSelectedZoneId = null;
    resetZoneStyles();
    syncZoneEditUiClasses();
    updateZoneEditHint("");
    redrawMapLayers();
    updateEditBarState();
  }

  async function saveDirtyMarkers() {
    const entries = [...bleDirtyMarkers.entries()];
    if (!entries.length) return 0;
    if (entries.length === 1) {
      const [, { lat, lng, point }] = entries[0];
      await bleApiMutate("PUT", `/api/v1/ble/${point.id}`, { latitude: lat, longitude: lng });
    } else if (bleCompanyId) {
      const payload = entries.map(([, { point, lat, lng }]) => ({
        ble: point.ble || String(point.id),
        coords: [lat, lng],
      }));
      await bleApiMutate("PUT", `/api/v1/map/ble/${bleCompanyId}/bulk`, payload);
    } else {
      for (const [, { lat, lng, point }] of entries) {
        await bleApiMutate("PUT", `/api/v1/ble/${point.id}`, { latitude: lat, longitude: lng });
      }
    }
    entries.forEach(([, { point, lat, lng }]) => {
      point.lat = lat;
      point.lng = lng;
    });
    bleDirtyMarkers.clear();
    return entries.length;
  }

  async function saveDirtyZones() {
    if (!bleDirtyZones.size) return 0;
    let saved = 0;
    for (const [zoneId, dirty] of bleDirtyZones) {
      const pts = dirty.pts;
      if (pts.length < 3) throw new Error(`У зоны ${zoneId} должно быть минимум 3 точки`);
      await bleApiMutate("PUT", `/api/v1/ble_zone/${zoneId}`, {
        name: dirty.name || `Зона ${zoneId}`,
        description: dirty.description || null,
        points: ptsToApiPoints(pts),
      });
      const z = bleZoneData.find((x) => x.id === zoneId);
      if (z) z.pts = pts.map((p) => [...p]);
      const entry = bleZoneLayers.get(zoneId);
      if (entry) entry.data.pts = pts.map((p) => [...p]);
      saved++;
    }
    bleDirtyZones.clear();
    bleSelectedZoneId = null;
    disableAllZonePm();
    resetZoneStyles();
    syncZoneEditUiClasses();
    updateZoneEditHint("");
    return saved;
  }

  async function saveAllEdits() {
    const btn = document.getElementById("mapSaveBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⌛ Сохранение…";
    }
    try {
      const nMarkers = await saveDirtyMarkers();
      const nZone = await saveDirtyZones();
      const parts = [];
      if (nMarkers) parts.push(`меток: ${nMarkers}`);
      if (nZone) parts.push(`зон: ${nZone}`);
      bleEditMapMsg = "";
      hideMapMsg();
      redrawMapLayers();
      updateEditBarState();
    } catch (e) {
      showMapMsg("Ошибка сохранения: " + (e.message || e), "error");
      throw e;
    } finally {
      if (btn) {
        btn.textContent = "Сохранить";
        updateEditBarState();
      }
    }
  }

  function redrawMapLayers() {
    renderBleMarkers();
    renderFsMarkers();
    if (bleMap) drawZones(bleMap);
    if (bleMapFS) drawZones(bleMapFS);
  }

  function setEditMode(on, opts = {}) {
    if (on === bleEditMode) return;
    if (!on && hasUnsavedEdits() && !opts.skipConfirm) {
      if (!window.confirm("Отменить несохранённые изменения?")) return;
      cancelAllEdits();
    }
    if (on) {
      const mobile = isCoarseMobile();
      const confirmText = mobile
        ? "Режим редактирования меняет данные на сервере VSM.\n\n• Удержите метку 1 сек., затем перетащите\n\nПродолжить?"
        : "Режим редактирования меняет данные на сервере VSM.\n\n• Метки: удержите 1 сек., затем перетащите\n• Зоны: клик по зоне — вершины; снова клик — скрыть; «Сохранить» — записать все зоны\n\nПродолжить?";
      if (!opts.skipConfirm && !window.confirm(confirmText)) {
        return;
      }
    }
    bleEditMode = on;
    document.body.classList.toggle("ble-map--edit", bleEditMode);
    document.body.classList.toggle("ble-map--zone-edit", bleEditMode && isZoneEditAllowed());
    if (bleEditMode) {
      enterEmbeddedEditLayout();
      syncZoneEditUiClasses();
      bleEditMapMsg = isCoarseMobile()
        ? "Редактирование: удержите метку 1 сек., затем перетащите."
        : "Метки: удержите 1 сек. Зоны: клик — вершины, снова клик — скрыть; можно править несколько зон, затем «Сохранить».";
      hideMapMsg();
    } else {
      disableAllZonePm();
      bleSelectedZoneId = null;
      syncZoneEditUiClasses();
      updateZoneEditHint("");
      document.body.classList.remove("ble-map--zone-edit");
      bleEditMapMsg = "";
      if (isEmbeddedEditLayout()) exitEmbeddedEditLayout();
      const fsErr = document.getElementById("mapFsMsg")?.classList.contains("error");
      const mainErr = document.getElementById("mapMsg")?.classList.contains("error");
      if (!fsErr && !mainErr) hideMapMsg();
    }
    redrawMapLayers();
    updateEditBarState();
  }

  function drawZones(targetMap, opts = {}) {
    if (!targetMap) return;
    const forEdit =
      isZoneEditAllowed() && targetMap === getActiveMap() && opts.forEdit !== false;
    const zoneFocused = forEdit && bleSelectedZoneId != null;
    let group = bleZoneGroups.get(targetMap);
    if (!group) {
      group = L.layerGroup().addTo(targetMap);
      bleZoneGroups.set(targetMap, group);
    }
    clearZoneVertexHandles(targetMap);
    group.clearLayers();
    if (forEdit) bleZoneLayers.clear();
    if (!bleZoneData.length) return;
    bleZoneData.forEach((z) => {
      if (!z.id || z.pts.length < 3) return;
      const isSelected = bleSelectedZoneId === z.id;
      const dimmed = zoneFocused && !isSelected;
      const pts = getZoneDisplayPts(z);
      const layer = L.polygon(pts, {
        color: z.color,
        opacity: dimmed ? 0.12 : 0.35,
        fillOpacity: dimmed ? 0.04 : forEdit ? 0.22 : 0.15,
        weight: isSelected ? 3 : dimmed ? 1 : 1.5,
        dashArray: isSelected ? "6 4" : null,
        interactive: forEdit,
      });
      layer.zoneMeta = z;
      layer.bindTooltip(z.name || `Зона ${z.id}`, {
        permanent: false,
        className: "zone-label",
      });
      if (forEdit) {
        layer.on("click", (e) => {
          if (!isZoneEditAllowed()) return;
          L.DomEvent.stopPropagation(e);
          selectZoneForEdit(z.id);
        });
        bleZoneLayers.set(z.id, { layer, data: z });
      }
      layer.addTo(group);
    });
    if (forEdit && bleSelectedZoneId) {
      const entry = bleZoneLayers.get(bleSelectedZoneId);
      if (entry?.layer) scheduleZoneVertexHandles(entry.layer, entry.data);
    }
  }

  function initBleMap(center, zoom) {
    if (bleMap) return;
    const placeholder = document.getElementById("mapPlaceholder");
    if (placeholder) placeholder.remove();
    const mobile = isCoarseMobile();
    bleMap = L.map("bleMap", {
      attributionControl: false,
      zoomControl: false,
      tapTolerance: 18,
      bounceAtZoomLimits: false,
      preferCanvas: false,
    }).setView(center, zoom);
    L.control
      .zoom({
        position: mobile ? "bottomright" : "topright",
      })
      .addTo(bleMap);
    const tileLayers = {
      satellite: L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Esri", updateWhenIdle: mobile }
      ),
      street: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        updateWhenIdle: mobile,
      }),
    };
    tileLayers.street.addTo(bleMap);
    let currentTileLayer = "street";
    document.querySelectorAll(".map-layer-btn[data-layer]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const layer = btn.dataset.layer;
        if (layer === currentTileLayer) return;
        bleMap.removeLayer(tileLayers[currentTileLayer]);
        tileLayers[layer].addTo(bleMap);
        currentTileLayer = layer;
        document.querySelectorAll(".map-layer-btn[data-layer]").forEach((b) =>
          b.classList.toggle("active", b.dataset.layer === layer)
        );
      });
    });
    setTimeout(() => bleMap.invalidateSize(), 200);
  }

  function classifyBle(point) {
    const LOW = 15;
    const inspectionDays = 1;
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    let isInspected = false;
    let recordDt = "Не обходилась";
    if (point.record_dt) {
      const d = new Date(point.record_dt);
      const inspDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      isInspected = (today - inspDate) / 86400000 <= inspectionDays;
      recordDt = inspDate.toISOString().slice(0, 10);
    }
    const isLowBattery = point.charge_value != null && point.charge_value <= LOW;
    let status = "ok";
    if (isLowBattery) status = "battery";
    else if (!isInspected) status = "inspection";
    return {
      id: point.id,
      origLat: point.latitude,
      origLng: point.longitude,
      ble: String(point.ble_number || ""),
      name: point.name_extended || "",
      lat: point.latitude,
      lng: point.longitude,
      charge: point.charge_value,
      locationDesc: point.location_desc || "",
      bleType: point.ble_type_desc || "",
      mac: point.mac_address || "",
      isInspected,
      isLowBattery,
      recordDt,
      status,
      photoTag: point.ble_image_url || "",
      photoPlace: point.location_image_url || "",
      routeId: point.bleRoute?.id ?? null,
      routeTitle: point.bleRoute?.title || "",
      zoneId: point.ble_zone_id ?? point.ble_zoneId ?? null,
    };
  }

  function createBleIcon(point, editTouchTarget = false) {
    return L.divIcon({
      className: editTouchTarget ? "ble-marker-icon--edit" : "",
      html: `<div class="ble-dot ble-dot-${point.status}">${point.ble}</div>`,
      iconSize: editTouchTarget ? [30, 30] : [22, 22],
      iconAnchor: editTouchTarget ? [15, 15] : [11, 11],
    });
  }

  window.openPhotoViewer = function openPhotoViewer(url) {
    const img = document.getElementById("photoViewerImg");
    const overlay = document.getElementById("photoViewerOverlay");
    if (!img || !overlay) return;
    img.src = url;
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
  };

  function closePhotoViewer() {
    document.getElementById("photoViewerOverlay")?.classList.remove("open");
    document.body.style.overflow = "";
  }

  function makePopup(pt) {
    const photos = [pt.photoTag, pt.photoPlace].filter(Boolean);
    const photoHtml = photos.length
      ? `<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">${photos
          .map(
            (url) =>
              `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" onclick="event.preventDefault();openPhotoViewer('${esc(url)}')" style="display:block;flex:1;min-width:120px;cursor:zoom-in;"><img src="${esc(url)}" style="width:100%;height:113px;object-fit:cover;border-radius:6px;border:1px solid #E8EDF2;" onerror="this.parentElement.style.display='none'"></a>`
          )
          .join("")}</div>`
      : "";
    const routeLine = pt.routeTitle
      ? `<div style="color:#1565C0;font-size:12px;font-weight:600;margin-bottom:3px;">${esc(pt.routeTitle)}</div>`
      : "";
    return `<div style="font-size:13px;line-height:1.5;min-width:160px;max-width:260px;"><div style="font-family:Oswald,sans-serif;font-size:1em;font-weight:700;color:#37474F;margin-bottom:2px;">Метка #${esc(pt.ble)}</div>${routeLine}${pt.bleType ? `<div style="color:#00897b;font-size:12px;font-weight:600;margin-bottom:3px;">${esc(pt.bleType.replace(/^\d+ - /, ""))}</div>` : ""}${pt.locationDesc ? `<div style="color:#546E7A;font-size:12px;margin-bottom:2px;">${esc(pt.locationDesc)}</div>` : ""}${photoHtml}</div>`;
  }

  function makeClusterGroup() {
    return L.markerClusterGroup({
      maxClusterRadius(zoom) {
        if (zoom < 17) return 120;
        if (zoom < 18) return 40;
        return 1;
      },
      disableClusteringAtZoom: 18,
      spiderfyOnMaxZoom: false,
      showCoverageOnHover: false,
      animate: true,
      animateAddingMarkers: false,
      iconCreateFunction(cluster) {
        const count = cluster.getChildCount();
        const size = count < 10 ? "small" : count < 50 ? "medium" : "large";
        return L.divIcon({
          html: `<div><span>${count}</span></div>`,
          className: `marker-cluster marker-cluster-${size}`,
          iconSize: L.point(40, 40),
        });
      },
    });
  }

  function onMarkerDragEnd(pt, marker) {
    const ll = marker.getLatLng();
    if (!bleDirtyMarkers.has(pt.id)) {
      bleDirtyMarkers.set(pt.id, { point: pt, origLat: pt.lat, origLng: pt.lng });
    }
    const rec = bleDirtyMarkers.get(pt.id);
    rec.lat = ll.lat;
    rec.lng = ll.lng;
    pt.lat = ll.lat;
    pt.lng = ll.lng;
    updateEditBarState();
  }

  function shouldUseEditMarkersOnMap(map) {
    if (!bleEditMode) return false;
    if (map === bleMapFS) return isMapFullscreenOpen();
    if (map === bleMap) return !isMapFullscreenOpen();
    return false;
  }

  function clientXYFromEvent(e) {
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  function setMarkerLatLngFromClient(marker, map, clientX, clientY) {
    const containerPoint = map.mouseEventToContainerPoint({ clientX, clientY });
    marker.setLatLng(map.containerPointToLatLng(containerPoint));
  }

  function findTouch(touchList, id) {
    if (id == null || !touchList) return null;
    for (let i = 0; i < touchList.length; i++) {
      if (touchList[i].identifier === id) return touchList[i];
    }
    return null;
  }

  function touchEnded(e, id) {
    if (id == null || !e.changedTouches) return false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === id) return true;
    }
    return false;
  }

  function attachMarkerHoldDrag(marker, pt) {
    let holdTimer = null;
    let dragArmed = false;
    let manualDragging = false;
    let suppressClick = false;
    let touchBound = false;
    let activePointer = null;

    const dotEl = () => marker.getElement()?.querySelector(".ble-dot");
    const getMap = () => marker._map;

    const setPending = (on) => dotEl()?.classList.toggle("ble-dot--hold-pending", on);
    const setArmedVisual = (on) => dotEl()?.classList.toggle("ble-dot--hold-armed", on);

    const clearHoldTimer = () => {
      if (holdTimer == null) return;
      clearTimeout(holdTimer);
      holdTimer = null;
    };

    const detachDocumentDrag = () => {
      document.removeEventListener("touchmove", onDocMove, { capture: true });
      document.removeEventListener("mousemove", onDocMove, true);
      document.removeEventListener("touchend", onDocEnd, true);
      document.removeEventListener("touchcancel", onDocEnd, true);
      document.removeEventListener("mouseup", onDocEnd, true);
    };

    const resetDragSession = () => {
      clearHoldTimer();
      detachDocumentDrag();
      setPending(false);
      setArmedVisual(false);
      dragArmed = false;
      manualDragging = false;
      activePointer = null;
      const map = getMap();
      if (map?.dragging?.enabled() === false) map.dragging.enable();
    };

    const finishManualDrag = () => {
      if (!manualDragging) return;
      manualDragging = false;
      onMarkerDragEnd(pt, marker);
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 450);
    };

    const attachDocumentDrag = () => {
      document.addEventListener("touchmove", onDocMove, { capture: true, passive: false });
      document.addEventListener("mousemove", onDocMove, true);
      document.addEventListener("touchend", onDocEnd, true);
      document.addEventListener("touchcancel", onDocEnd, true);
      document.addEventListener("mouseup", onDocEnd, true);
    };

    const armDrag = () => {
      holdTimer = null;
      setPending(false);
      dragArmed = true;
      setArmedVisual(true);
      attachDocumentDrag();
      try {
        navigator.vibrate?.(40);
      } catch {
        /* ignore */
      }
    };

    const onDocMove = (e) => {
      if (!dragArmed) return;
      const map = getMap();
      if (!map) return;
      let x;
      let y;
      if (e.type === "touchmove") {
        const t = findTouch(e.touches, activePointer);
        if (!t) return;
        x = t.clientX;
        y = t.clientY;
      } else if (activePointer === "mouse") {
        if (e.buttons === 0) return;
        x = e.clientX;
        y = e.clientY;
      } else {
        return;
      }

      if (!manualDragging) {
        manualDragging = true;
        marker.closePopup();
        if (map.dragging) map.dragging.disable();
      }

      if (e.cancelable) e.preventDefault();
      L.DomEvent.stopPropagation(e);
      setMarkerLatLngFromClient(marker, map, x, y);
    };

    const onDocEnd = (e) => {
      if (e.type === "touchend" || e.type === "touchcancel") {
        if (activePointer !== "mouse" && !touchEnded(e, activePointer)) return;
      } else if (activePointer !== "mouse") {
        return;
      }
      if (!dragArmed && holdTimer == null) return;
      finishManualDrag();
      resetDragSession();
    };

    const onHoldStart = (e) => {
      if (!bleEditMode) return;
      if (e.type === "mousedown" && e.button !== 0) return;
      L.DomEvent.stopPropagation(e);
      if (e.cancelable) e.preventDefault();
      resetDragSession();
      activePointer = e.type === "touchstart" ? e.touches[0]?.identifier ?? 0 : "mouse";
      setPending(true);
      holdTimer = setTimeout(armDrag, BLE_MARKER_HOLD_MS);
    };

    const onHoldEndEarly = (e) => {
      if (dragArmed || manualDragging) return;
      if (holdTimer != null) {
        L.DomEvent.stopPropagation(e);
        clearHoldTimer();
        setPending(false);
      }
    };

    const bindPointer = () => {
      const el = marker.getElement();
      if (!el || touchBound) return;
      touchBound = true;
      L.DomEvent.on(el, "mousedown", onHoldStart, marker);
      el.addEventListener("touchstart", onHoldStart, { passive: false, capture: true });
      L.DomEvent.on(el, "mouseup", onHoldEndEarly, marker);
      el.addEventListener("touchend", onHoldEndEarly, { passive: false, capture: true });
      el.addEventListener("touchcancel", onHoldEndEarly, { passive: false, capture: true });
      L.DomEvent.on(el, "contextmenu", L.DomEvent.stopPropagation);
    };

    const unbindPointer = () => {
      const el = marker.getElement();
      if (!el) return;
      touchBound = false;
      L.DomEvent.off(el, "mousedown", onHoldStart, marker);
      el.removeEventListener("touchstart", onHoldStart, { capture: true });
      L.DomEvent.off(el, "mouseup", onHoldEndEarly, marker);
      el.removeEventListener("touchend", onHoldEndEarly, { capture: true });
      el.removeEventListener("touchcancel", onHoldEndEarly, { capture: true });
      L.DomEvent.off(el, "contextmenu", L.DomEvent.stopPropagation);
    };

    marker.on("add", bindPointer);
    marker.on("remove", () => {
      unbindPointer();
      resetDragSession();
    });

    marker.on("click", (e) => {
      if (suppressClick || holdTimer != null || dragArmed || manualDragging) {
        L.DomEvent.stopPropagation(e);
      }
    });

    marker.bindPopup(
      makePopup(pt) +
        "<p style='margin:8px 0 0;font-size:12px;color:#546E7A'>Удержите 1 сек., затем перетащите</p>",
      { maxWidth: popupMaxWidth() }
    );
  }

  function addEditableMarkersToGroup(group, opts = {}) {
    const statusFilter = opts.statusFilter ?? bleMapFilter;
    const query = opts.query ?? "";
    bleMapData.forEach((pt) => {
      if (!pointVisibleOnMap(pt, { statusFilter, query, requireId: true })) return;
      const marker = L.marker([pt.lat, pt.lng], {
        icon: createBleIcon(pt, true),
        draggable: false,
      });
      attachMarkerHoldDrag(marker, pt);
      marker.addTo(group);
    });
  }

  function markerMatchesSearch(pt, query) {
    if (!query) return true;
    return pt.ble.toLowerCase() === query || pt.ble.toLowerCase().includes(query);
  }

  function pointPassesRouteFilter(pt) {
    if (!bleMapRouteFilter) return true;
    return pt.routeId != null && String(pt.routeId) === String(bleMapRouteFilter);
  }

  function pointVisibleOnMap(pt, opts = {}) {
    const statusFilter = opts.statusFilter ?? bleMapFilter;
    const query = opts.query ?? "";
    const requireId = !!opts.requireId;
    const zoneFilterId = opts.zoneFilterId ?? getMarkerZoneFilterId();
    if (!pt.lat || !pt.lng) return false;
    if (requireId && !pt.id) return false;
    if (statusFilter !== "all" && pt.status !== statusFilter) return false;
    if (!pointPassesRouteFilter(pt)) return false;
    if (!markerMatchesSearch(pt, query)) return false;
    if (zoneFilterId != null && !pointBelongsToZone(pt, zoneFilterId)) return false;
    return true;
  }

  function routeOptionLabel(route) {
    const title = route.title || `Маршрут ${route.id}`;
    const insp = route.inspectedToday ?? 0;
    const total = route.total ?? 0;
    return `${title} ${insp}/${total}`;
  }

  function setRouteFieldsVisible(visible) {
    ["mapRouteFieldDock", "mapRouteFieldFs", "mapRouteFieldCompact", "mapRouteSepCompact"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = !visible;
    });
  }

  function populateRouteSelect() {
    document.querySelectorAll(".map-route-select").forEach((sel) => {
      const cur = sel.value;
      sel.innerHTML = '<option value="">Все маршруты</option>';
      bleRoutes.forEach((r) => {
        const opt = document.createElement("option");
        opt.value = String(r.id);
        opt.textContent = routeOptionLabel(r);
        sel.appendChild(opt);
      });
      const next = bleMapRouteFilter || cur;
      if (next && [...sel.options].some((o) => o.value === next)) sel.value = next;
    });
    const compact = document.getElementById("mapRouteSelectCompact");
    if (compact?.options[0]) compact.options[0].textContent = "Все";
  }

  let bleRouteFilterApplying = false;

  function clearFsMarkerLayers() {
    if (!bleMapFS) return;
    if (bleClusterGroupFS) {
      try {
        bleClusterGroupFS.clearLayers();
      } catch {
        /* ignore */
      }
      bleMapFS.removeLayer(bleClusterGroupFS);
      bleClusterGroupFS = null;
    }
    if (bleMarkerLayerFS) {
      bleMarkerLayerFS.clearLayers();
      bleMapFS.removeLayer(bleMarkerLayerFS);
      bleMarkerLayerFS = null;
    }
  }

  function setBleMapRouteFilter(value) {
    const next = value ? String(value) : "";
    if (next === bleMapRouteFilter) return;
    bleMapRouteFilter = next;
    bleRouteFilterApplying = true;
    document.querySelectorAll(".map-route-select").forEach((sel) => {
      if (sel.value !== bleMapRouteFilter) sel.value = bleMapRouteFilter;
    });
    bleRouteFilterApplying = false;
    redrawMapLayers();
  }

  window.setBleMapRouteFilter = setBleMapRouteFilter;
  window.populateRouteSelect = populateRouteSelect;

  async function loadBleRoutes() {
    try {
      const data = await bleApiFetch("/api/v1/ble/route");
      bleRoutes = Array.isArray(data) ? data : [];
      populateRouteSelect();
      setRouteFieldsVisible(bleRoutes.length > 0);
    } catch {
      bleRoutes = [];
      setRouteFieldsVisible(false);
    }
  }

  function renderBleMarkers() {
    if (!bleMap) return;
    if (bleClusterGroup) {
      bleMap.removeLayer(bleClusterGroup);
      bleClusterGroup = null;
    }
    if (bleMarkerLayer) {
      bleMap.removeLayer(bleMarkerLayer);
      bleMarkerLayer = null;
    }
    const q = document.getElementById("mapBleSearch")?.value?.trim().toLowerCase().replace(/^ble/i, "") || "";

    if (shouldUseEditMarkersOnMap(bleMap)) {
      bleMarkerLayer = L.layerGroup();
      addEditableMarkersToGroup(bleMarkerLayer, { statusFilter: bleMapFilter, query: q });
      bleMap.addLayer(bleMarkerLayer);
      bleMap.invalidateSize();
      return;
    }

    bleClusterGroup = makeClusterGroup();
    bleMapData.forEach((pt) => {
      if (!pointVisibleOnMap(pt, { statusFilter: bleMapFilter, query: q })) return;
      L.marker([pt.lat, pt.lng], { icon: createBleIcon(pt) })
        .bindPopup(makePopup(pt), { maxWidth: popupMaxWidth() })
        .addTo(bleClusterGroup);
    });
    bleMap.addLayer(bleClusterGroup);
  }

  function renderFsMarkers() {
    if (!bleMapFS) return;
    clearFsMarkerLayers();
    const q = getFsSearchQuery();
    if (shouldUseEditMarkersOnMap(bleMapFS)) {
      bleMarkerLayerFS = L.layerGroup();
      addEditableMarkersToGroup(bleMarkerLayerFS, { statusFilter: bleMapFSFilter, query: q });
      bleMapFS.addLayer(bleMarkerLayerFS);
      bleMapFS.invalidateSize();
      return;
    }
    bleClusterGroupFS = makeClusterGroup();
    bleMapData.forEach((pt) => {
      if (!pointVisibleOnMap(pt, { statusFilter: bleMapFSFilter, query: q })) return;
      L.marker([pt.lat, pt.lng], { icon: createBleIcon(pt) })
        .bindPopup(makePopup(pt), { maxWidth: popupMaxWidth() })
        .addTo(bleClusterGroupFS);
    });
    bleMapFS.addLayer(bleClusterGroupFS);
  }

  function updateMapStats() {
    const all = bleMapData.length;
    const insp = bleMapData.filter((p) => p.status === "inspection").length;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set("fcAll", all);
    set("fcInsp", insp);
    set("fcFsAll", all);
    set("fcFsInsp", insp);
  }

  function syncFilterUi(value) {
    document.querySelectorAll(".map-filter-btn[data-filter], .map-filter-btn[data-fsfilter]").forEach((b) => {
      const v = b.dataset.filter || b.dataset.fsfilter;
      b.classList.toggle("active", v === value);
    });
    document.querySelectorAll(".fs-chip[data-pf]").forEach((b) => {
      b.classList.toggle("active", b.dataset.pf === value);
    });
  }

  function setBleMapFilter(value) {
    const allowed = value === "inspection" ? "inspection" : "all";
    bleMapFilter = allowed;
    bleMapFSFilter = allowed;
    syncFilterUi(allowed);
    redrawMapLayers();
  }

  window.setBleMapFilter = setBleMapFilter;

  function isCoarseMobile() {
    return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
  }

  function popupMaxWidth() {
    return Math.min(280, Math.max(200, window.innerWidth - 48));
  }

  function scheduleMapResize() {
    if (!bleMap) return;
    bleMap.invalidateSize();
    setTimeout(() => bleMap?.invalidateSize(), 200);
    setTimeout(() => bleMap?.invalidateSize(), 600);
  }

  function applyMapLayoutClasses() {
    const embedded = window.self !== window.top;
    document.documentElement.classList.toggle("ble-map-embedded", embedded);
    document.body.classList.toggle("ble-map-embedded", embedded);
    document.body.classList.toggle("ble-map-mobile", isCoarseMobile());
  }

  function bindMapResizeHandlers() {
    window.addEventListener("resize", scheduleMapResize, { passive: true });
    window.addEventListener("orientationchange", scheduleMapResize, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", scheduleMapResize, { passive: true });
    }
  }

  function setRetryVisible(show) {
    const retry = document.getElementById("mapRetryBtn");
    if (retry) retry.hidden = !show;
  }

  function revealMapControls() {
    const dock = document.getElementById("mapFloatDock");
    if (dock) dock.hidden = false;
    setRetryVisible(false);
  }

  async function resolveCompanyId() {
    const meta = await fetchBleCacheMeta();
    return meta?.companyId ?? BLE_DEFAULT_COMPANY_ID;
  }

  async function resolveCompanyIdFromApi() {
    try {
      const ud = await bleApiFetch("/api/v1/user/me/");
      const fromApi = ud.companyId || ud.company_id;
      if (fromApi) return Number(fromApi);
    } catch {
      try {
        const ud2 = await bleApiFetch("/api/v1/user/data");
        const fromApi = ud2.companyId || ud2.company_id;
        if (fromApi) return Number(fromApi);
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  async function refreshBleMapFromApi(companyId) {
    if (!companyId || bleEditMode) return;
    try {
      const rawBle = await bleApiFetch(`/api/v1/map/ble/${companyId}`);
      if (!Array.isArray(rawBle) || !rawBle.length) return;
      bleMapData = rawBle.map(classifyBle);
      updateMapStats();
      renderBleMarkers();
      try {
        const mapData = await bleApiFetch(`/api/v1/map/${companyId}/map_data`);
        if (mapData.zones && mapData.points) {
          const pointsByZone = {};
          mapData.points.forEach((p) => {
            if (!pointsByZone[p.zoneId]) pointsByZone[p.zoneId] = [];
            pointsByZone[p.zoneId].push([p.latitude, p.longitude]);
          });
          bleZoneData = mapData.zones
            .map((z) => ({
              id: z.id,
              name: z.name || "",
              description: z.description || "",
              color: z.color || "#0088cc",
              pts: (pointsByZone[z.id] || []).map((p) => [...p]),
            }))
            .filter((z) => z.pts.length > 2);
          drawZones(bleMap);
        }
      } catch {
        /* zones optional */
      }
      try {
        sessionStorage.removeItem(BLE_OFFLINE_FIRST_KEY);
      } catch {
        /* ignore */
      }
      setRetryVisible(false);
      hideMapMsg();
    } catch (e) {
      console.warn("[ble-map] API refresh failed", e?.message || e);
    }
  }

  async function applyBleListToMap(rawBle, cacheNotice) {
    bleMapData = rawBle.map(classifyBle);
    updateMapStats();
    renderBleMarkers();
    if (bleCompanyId) {
      try {
        const mapData = await bleApiFetch(`/api/v1/map/${bleCompanyId}/map_data`);
        if (mapData.zones && mapData.points) {
          const pointsByZone = {};
          mapData.points.forEach((p) => {
            if (!pointsByZone[p.zoneId]) pointsByZone[p.zoneId] = [];
            pointsByZone[p.zoneId].push([p.latitude, p.longitude]);
          });
          bleZoneData = mapData.zones
            .map((z) => ({
              id: z.id,
              name: z.name || "",
              description: z.description || "",
              color: z.color || "#0088cc",
              pts: (pointsByZone[z.id] || []).map((p) => [...p]),
            }))
            .filter((z) => z.pts.length > 2);
          drawZones(bleMap);
        }
      } catch {
        /* zones optional */
      }
    }
    const validPts = bleMapData.filter((p) => p.lat && p.lng);
    const pt313 = bleMapData.find(
      (p) => p.ble === "313" || p.ble === "BLE313" || String(p.ble).replace(/^ble/i, "") === "313"
    );
    if (pt313?.lat && pt313.lng) {
      bleMap.setView([pt313.lat, pt313.lng], 18);
    } else if (validPts.length > 1) {
      bleMap.fitBounds(L.latLngBounds(validPts.map((p) => [p.lat, p.lng])), {
        padding: [30, 30],
      });
    }
    revealMapControls();
    loadBleRoutes();
    hideMapMsg();
    bleMapInitialized = true;
    scheduleMapResize();
  }

  async function tryLoadOfflineBleList(companyId) {
    const cached = await fetchBleListOffline(companyId);
    if (!cached?.data?.length) return null;
    if (!bleMap) initBleMap([53.038, 39.011], 15);
    bleCompanyId = companyId;
    await applyBleListToMap(cached.data, "");
    setRetryVisible(true);
    try {
      sessionStorage.setItem(BLE_OFFLINE_FIRST_KEY, "1");
    } catch {
      /* ignore */
    }
    return true;
  }

  async function loadBleMap() {
    const placeholder = document.getElementById("mapPlaceholder");
    if (placeholder) placeholder.textContent = "Загрузка карты…";
    try {
      let center = [53.038, 39.011];
      let zoom = 15;
      initBleMap(center, zoom);

      const companyId = await resolveCompanyId();
      bleCompanyId = companyId;

      const cached = await fetchBleListOffline(companyId);
      if (cached?.data?.length) {
        await applyBleListToMap(cached.data, "");
        try {
          sessionStorage.setItem(BLE_OFFLINE_FIRST_KEY, "1");
        } catch {
          /* ignore */
        }
        void (async () => {
          const apiCid = await resolveCompanyIdFromApi();
          if (apiCid && apiCid !== companyId) {
            bleCompanyId = apiCid;
            await refreshBleMapFromApi(apiCid);
          } else {
            await refreshBleMapFromApi(companyId);
          }
        })();
        return;
      }

      try {
        const cfg = await bleApiFetch("/api/v1/map/config");
        if (cfg.defaultView?.latitude) center = [cfg.defaultView.latitude, cfg.defaultView.longitude];
        if (cfg.defaultZoom) zoom = cfg.defaultZoom;
        if (bleMap) bleMap.setView(center, zoom);
      } catch {
        /* default center */
      }

      const rawBle = await bleApiFetch(`/api/v1/map/ble/${companyId}`);
      try {
        sessionStorage.removeItem(BLE_OFFLINE_FIRST_KEY);
      } catch {
        /* ignore */
      }
      await applyBleListToMap(rawBle, "");
    } catch (e) {
      const companyId = (await fetchBleCacheMeta())?.companyId || BLE_DEFAULT_COMPANY_ID;
      if (await tryLoadOfflineBleList(companyId)) {
        return;
      }

      const msg = e?.message || "";
      const isAuth =
        msg.includes("auth") || msg === "HTTP 401" || msg === "auto_auth_failed";
      if (isAuth) {
        localStorage.removeItem(BLE_TOKEN_KEY);
        try {
          sessionStorage.removeItem(BLE_TRANSPORT_KEY);
        } catch {
          /* ignore */
        }
      }
      const tried = e.bleTriedTransports || transportOrder();
      if (!bleMap) initBleMap([53.038, 39.011], 15);
      const dock = document.getElementById("mapFloatDock");
      if (dock) dock.hidden = false;
      setRetryVisible(true);
      showMapMsg(
        "Ошибка загрузки карты: " + formatBleError(e, tried) + " Нажмите ↺ в панели.",
        "error"
      );
    }
  }

  async function retryBleMap() {
    const btn = document.getElementById("mapRetryBtn");
    if (btn) {
      btn.disabled = true;
      btn.dataset.busy = "1";
    }
    localStorage.removeItem(BLE_TOKEN_KEY);
    try {
      sessionStorage.removeItem(BLE_OFFLINE_FIRST_KEY);
    } catch {
      /* ignore */
    }
    bleMapInitialized = false;
    hideMapMsg();
    await loadBleMap();
    if (btn) {
      btn.disabled = false;
      delete btn.dataset.busy;
    }
  }

  window.syncFsStats = function syncFsStats() {
    updateMapStats();
    const all = document.getElementById("fcFsAll")?.textContent;
    const insp = document.getElementById("fcFsInsp")?.textContent;
    const pAll = document.getElementById("pf-all");
    const pInsp = document.getElementById("pf-insp");
    if (pAll && all != null) pAll.textContent = all;
    if (pInsp && insp != null) pInsp.textContent = insp;
  };

  window.openFullscreenMap = function openFullscreenMap() {
    const overlay = document.getElementById("mapFullscreenOverlay");
    if (!overlay) return;
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    notifyMapFullscreenState(true);
    if (!bleMapFSInitialized) {
      const fsMobile = isCoarseMobile();
      bleMapFS = L.map("bleMapFS", {
        attributionControl: false,
        zoomControl: false,
        tapTolerance: 18,
        bounceAtZoomLimits: false,
        preferCanvas: false,
      });
      L.control
        .zoom({
          position: fsMobile ? "bottomright" : "topright",
        })
        .addTo(bleMapFS);
      fsTileLayers = {
        satellite: L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          { attribution: "Esri", updateWhenIdle: fsMobile }
        ),
        street: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          updateWhenIdle: fsMobile,
        }),
      };
      fsTileLayers.street.addTo(bleMapFS);
      if (bleMap) {
        bleMapFS.setView(bleMap.getCenter(), bleMap.getZoom());
      } else if (bleMapData.length) {
        const validPts = bleMapData.filter((p) => p.lat && p.lng);
        if (validPts.length > 1) {
          bleMapFS.fitBounds(L.latLngBounds(validPts.map((p) => [p.lat, p.lng])), { padding: [30, 30] });
        } else {
          bleMapFS.setView([53.038, 39.011], 15);
        }
      } else {
        bleMapFS.setView([53.038, 39.011], 15);
      }
      document.querySelectorAll("[data-fslayer]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const layer = btn.dataset.fslayer;
          if (layer === fsTileLayerCurrent) return;
          bleMapFS.removeLayer(fsTileLayers[fsTileLayerCurrent]);
          fsTileLayers[layer].addTo(bleMapFS);
          fsTileLayerCurrent = layer;
          document.querySelectorAll("[data-fslayer]").forEach((b) =>
            b.classList.toggle("active", b.dataset.fslayer === layer)
          );
        });
      });
      document.querySelectorAll("[data-fsfilter]").forEach((btn) => {
        btn.addEventListener("click", () => setBleMapFilter(btn.dataset.fsfilter));
      });
      const fsSearchEl = document.getElementById("mapFsSearch");
      const fsSearchClear = document.getElementById("mapFsSearchClear");
      if (fsSearchEl && fsSearchClear) {
        fsSearchEl.addEventListener("input", () => {
          fsSearchClear.style.display = fsSearchEl.value ? "block" : "none";
          renderFsMarkers();
          const q = fsSearchEl.value.trim().toLowerCase().replace(/^ble/i, "");
          if (!q) return;
          const found = bleMapData.find((p) => p.ble.toLowerCase() === q);
          if (found?.lat && found?.lng) {
            const layerGroup = bleMarkerLayerFS || bleClusterGroupFS;
            if (layerGroup) {
              let hit = null;
              layerGroup.eachLayer((m) => {
                if (m.getLatLng().lat === found.lat && m.getLatLng().lng === found.lng) hit = m;
              });
              if (hit) {
                if (bleClusterGroupFS?.zoomToShowLayer) {
                  bleClusterGroupFS.zoomToShowLayer(hit, () => hit.openPopup());
                } else {
                  bleMapFS.setView(hit.getLatLng(), Math.max(bleMapFS.getZoom(), 17));
                  hit.openPopup();
                }
              }
            }
          }
        });
        fsSearchClear.addEventListener("click", () => {
          fsSearchEl.value = "";
          fsSearchClear.style.display = "none";
          renderFsMarkers();
          fsSearchEl.focus();
        });
      }
      drawZones(bleMapFS);
      bleMapFSInitialized = true;
    }
    syncFsStats();
    renderFsMarkers();
    if (bleEditMode && bleMapFS) drawZones(bleMapFS);
    setTimeout(() => bleMapFS?.invalidateSize(), 150);
  };

  window.closeFullscreenMap = function closeFullscreenMap() {
    if (bleEditMode) {
      setEditMode(false);
      if (bleEditMode) return;
    }
    document.getElementById("mapFullscreenOverlay")?.classList.remove("open");
    document.body.style.overflow = "";
    if (!bleEditMode && !isEmbeddedEditLayout()) notifyMapFullscreenState(false);
    redrawMapLayers();
    const hasErr =
      document.getElementById("mapMsg")?.classList.contains("error") ||
      document.getElementById("mapFsMsg")?.classList.contains("error");
    if (!hasErr) hideMapMsg();
  };

  function bindUi() {
    const onFilterTap = (e) => {
      const btn = e.target.closest(".map-filter-btn[data-filter], .map-filter-btn[data-fsfilter]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const value = btn.dataset.filter || btn.dataset.fsfilter;
      setBleMapFilter(value);
    };
    document.getElementById("mapFloatDock")?.addEventListener("click", onFilterTap);
    document.getElementById("mapFsFilters")?.addEventListener("click", onFilterTap);

    document.addEventListener("change", (e) => {
      if (bleRouteFilterApplying) return;
      const sel = e.target.closest?.(".map-route-select");
      if (!sel) return;
      setBleMapRouteFilter(sel.value);
    });

    const mapBleSearchEl = document.getElementById("mapBleSearch");
    const mapSearchClearEl = document.getElementById("mapSearchClear");
    if (mapBleSearchEl && mapSearchClearEl) {
      mapBleSearchEl.addEventListener("input", () => {
        mapSearchClearEl.style.display = mapBleSearchEl.value ? "block" : "none";
        renderBleMarkers();
        const q = mapBleSearchEl.value.trim().toLowerCase().replace(/^ble/i, "");
        if (!q) return;
        const found = bleMapData.find((p) => p.ble.toLowerCase() === q);
        if (found?.lat && found?.lng && bleClusterGroup) {
          bleClusterGroup.eachLayer((m) => {
            if (m.getLatLng().lat === found.lat && m.getLatLng().lng === found.lng) {
              bleClusterGroup.zoomToShowLayer(m, () => m.openPopup());
            }
          });
        }
      });
      mapSearchClearEl.addEventListener("click", () => {
        mapBleSearchEl.value = "";
        mapSearchClearEl.style.display = "none";
        renderBleMarkers();
        mapBleSearchEl.focus();
      });
    }

    document.getElementById("mapEditToggle")?.addEventListener("click", () => setEditMode(!bleEditMode));
    document.getElementById("mapEditModeBtn")?.addEventListener("click", () => setEditMode(!bleEditMode));
    document.getElementById("mapSaveBtn")?.addEventListener("click", () => saveAllEdits());
    document.getElementById("mapCancelEditBtn")?.addEventListener("click", () => setEditMode(false));
    document.getElementById("mapFullscreenClose")?.addEventListener("click", closeFullscreenMap);
    document.getElementById("mapRetryBtn")?.addEventListener("click", retryBleMap);
    document.getElementById("photoViewerOverlay")?.addEventListener("click", closePhotoViewer);
    document.getElementById("photoViewerClose")?.addEventListener("click", closePhotoViewer);

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (bleEditMode) {
        setEditMode(false);
        return;
      }
      if (document.getElementById("mapFullscreenOverlay")?.classList.contains("open")) {
        closeFullscreenMap();
        return;
      }
      closePhotoViewer();
    });
  }

  function initEmbeddedChrome() {
    if (window.self !== window.top) {
      document.getElementById("bleMapPageHeader")?.classList.add("is-embedded");
      const back = document.getElementById("bleMapBackLink");
      if (back) back.hidden = true;
    }
    applyMapLayoutClasses();
    bindMapResizeHandlers();
    window.addEventListener("message", (e) => {
      if (e.data?.type === "ww-ble-map-resize") scheduleMapResize();
    });
    try {
      if (window.self !== window.top && window.parent) {
        window.parent.postMessage({ type: "ww-ble-map-ready" }, "*");
      }
    } catch {
      /* cross-origin */
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (typeof L !== "undefined" && L.Layer?.prototype?.pm) {
      console.warn(
        "[ble-map] Загружен старый кэш с Geoman — сделайте жёсткое обновление (Ctrl+F5). Версия:",
        BLE_MAP_BUILD
      );
    }
    initEmbeddedChrome();
    bindUi();
    loadBleMap();
    scheduleMapResize();
  });
})();
