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
  const BLE_TRANSPORT_KEY = "ww-ble-transport";
  const BLE_OFFLINE_FIRST_KEY = "ww-ble-offline-first";
  const BLE_DEFAULT_COMPANY_ID = 1;

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
  let bleDirtyZone = null;
  let bleSelectedZoneId = null;
  let bleMarkerLayer = null;
  const bleZoneGroups = new WeakMap();
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
      return ["worker"];
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
        "). Без VPN метки берутся из кэша Supabase; если кэш пуст — нужен VPN или обновление кэша администратором."
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
      try {
        const res = await fetch(new URL(rel, window.location.href).href, {
          cache: "no-cache",
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
      } catch {
        /* try next path */
      }
    }
    return null;
  }

  async function fetchBleListOffline(companyId) {
    const cached = await fetchBleListCached(companyId);
    if (cached) return cached;
    return fetchBleListStatic(companyId);
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
    return bleDirtyMarkers.size > 0 || !!bleDirtyZone;
  }

  function polygonLatLngs(layer) {
    let latlngs = layer.getLatLngs();
    if (Array.isArray(latlngs[0]) && Array.isArray(latlngs[0][0])) {
      latlngs = latlngs[0];
    }
    return latlngs;
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

  function disableAllZonePm() {
    bleZoneLayers.forEach((entry) => {
      if (entry.layer.pm) entry.layer.pm.disable();
    });
  }

  function onZoneGeometryChanged(e) {
    const layer = e.layer;
    const meta = layer.zoneMeta;
    if (!meta) return;
    const entry = bleZoneLayers.get(meta.id);
    bleDirtyZone = {
      zoneId: meta.id,
      name: entry?.data.name ?? meta.name,
      description: entry?.data.description ?? meta.description,
      layer,
    };
    updateEditBarState();
  }

  function revertZoneGeometry(zoneId) {
    const orig = bleZoneData.find((z) => z.id === zoneId);
    const entry = bleZoneLayers.get(zoneId);
    if (entry && orig) {
      entry.layer.setLatLngs(orig.pts.map((p) => [...p]));
      entry.data.pts = orig.pts.map((p) => [...p]);
    }
  }

  function selectZoneForEdit(zoneId) {
    const id = Number(zoneId);
    if (!id) {
      if (bleDirtyZone) revertZoneGeometry(bleDirtyZone.zoneId);
      bleSelectedZoneId = null;
      bleDirtyZone = null;
      disableAllZonePm();
      resetZoneStyles();
      updateEditBarState();
      return;
    }
    if (bleDirtyZone && bleDirtyZone.zoneId !== id) {
      revertZoneGeometry(bleDirtyZone.zoneId);
      bleDirtyZone = null;
    }
    disableAllZonePm();
    bleSelectedZoneId = id;
    const entry = bleZoneLayers.get(id);
    if (!entry) return;
    resetZoneStyles();
    const layer = entry.layer;
    if (layer.pm) {
      layer.pm.enable({ allowSelfIntersection: false });
    }
    layer.off("pm:edit pm:vertexadded pm:vertexremoved pm:drag");
    layer.on("pm:edit pm:vertexadded pm:vertexremoved pm:drag", onZoneGeometryChanged);
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
    if (bleDirtyZone) revertZoneGeometry(bleDirtyZone.zoneId);
    bleDirtyZone = null;
    disableAllZonePm();
    bleSelectedZoneId = null;
    resetZoneStyles();
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

  async function saveDirtyZone() {
    if (!bleDirtyZone) return 0;
    const { zoneId, name, description, layer } = bleDirtyZone;
    const pts = latLngsToPts(polygonLatLngs(layer));
    if (pts.length < 3) throw new Error("У зоны должно быть минимум 3 точки");
    await bleApiMutate("PUT", `/api/v1/ble_zone/${zoneId}`, {
      name: name || `Зона ${zoneId}`,
      description: description || null,
      points: ptsToApiPoints(pts),
    });
    const z = bleZoneData.find((x) => x.id === zoneId);
    if (z) z.pts = pts;
    const entry = bleZoneLayers.get(zoneId);
    if (entry) entry.data.pts = pts;
    bleDirtyZone = null;
    disableAllZonePm();
    return 1;
  }

  async function saveAllEdits() {
    const btn = document.getElementById("mapSaveBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⌛ Сохранение…";
    }
    try {
      const nMarkers = await saveDirtyMarkers();
      const nZone = await saveDirtyZone();
      const parts = [];
      if (nMarkers) parts.push(`меток: ${nMarkers}`);
      if (nZone) parts.push("зона");
      bleEditMapMsg = "";
      hideMapMsg();
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
      if (
        !opts.skipConfirm &&
        !window.confirm(
          "Режим редактирования меняет данные на сервере VSM.\n\n• Перетащите метку\n• Нажмите на зону и двигайте вершины\n\nПродолжить?"
        )
      ) {
        return;
      }
    }
    bleEditMode = on;
    document.body.classList.toggle("ble-map--edit", bleEditMode);
    if (bleEditMode) {
      enterEmbeddedEditLayout();
      bleEditMapMsg =
        "Редактирование: перетащите метку или нажмите на зону на карте. Вершины — потяните за точки.";
      hideMapMsg();
    } else {
      disableAllZonePm();
      bleSelectedZoneId = null;
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
    const forEdit = bleEditMode && targetMap === getActiveMap() && opts.forEdit !== false;
    let group = bleZoneGroups.get(targetMap);
    if (!group) {
      group = L.layerGroup().addTo(targetMap);
      bleZoneGroups.set(targetMap, group);
    }
    group.clearLayers();
    if (forEdit) bleZoneLayers.clear();
    if (!bleZoneData.length) return;
    bleZoneData.forEach((z) => {
      if (!z.id || z.pts.length < 3) return;
      const layer = L.polygon(z.pts, {
        color: z.color,
        opacity: 0.35,
        fillOpacity: bleEditMode && forEdit ? 0.22 : 0.15,
        weight: forEdit && bleSelectedZoneId === z.id ? 3 : 1.5,
        dashArray: forEdit && bleSelectedZoneId === z.id ? "6 4" : null,
      });
      layer.zoneMeta = z;
      layer.bindTooltip(z.name || `Зона ${z.id}`, { permanent: false, className: "zone-label" });
      if (forEdit) {
        layer.on("click", (e) => {
          if (!bleEditMode) return;
          L.DomEvent.stopPropagation(e);
          selectZoneForEdit(z.id);
        });
        bleZoneLayers.set(z.id, { layer, data: z });
      }
      layer.addTo(group);
    });
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
      preferCanvas: mobile,
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
    };
  }

  function createBleIcon(point) {
    return L.divIcon({
      className: "",
      html: `<div class="ble-dot ble-dot-${point.status}">${point.ble}</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
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
    if (!pt.lat || !pt.lng) return false;
    if (requireId && !pt.id) return false;
    if (statusFilter !== "all" && pt.status !== statusFilter) return false;
    if (!pointPassesRouteFilter(pt)) return false;
    if (!markerMatchesSearch(pt, query)) return false;
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
    if (bleEditMode && isMapFullscreenOpen()) {
      bleMarkerLayerFS = L.layerGroup();
      bleMapData.forEach((pt) => {
        if (!pointVisibleOnMap(pt, { statusFilter: bleMapFSFilter, query: q, requireId: true })) return;
        const marker = L.marker([pt.lat, pt.lng], {
          icon: createBleIcon(pt),
          draggable: true,
          autoPan: true,
        });
        marker.on("dragend", () => onMarkerDragEnd(pt, marker));
        marker.bindPopup(
          makePopup(pt) +
            "<p style='margin:8px 0 0;font-size:12px;color:#546E7A'>Перетащите для смены координат</p>",
          { maxWidth: popupMaxWidth() }
        );
        marker.addTo(bleMarkerLayerFS);
      });
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
    let companyId;
    try {
      const ud = await bleApiFetch("/api/v1/user/me/");
      companyId = ud.companyId || ud.company_id;
    } catch {
      try {
        const ud2 = await bleApiFetch("/api/v1/user/data");
        companyId = ud2.companyId || ud2.company_id;
      } catch {
        /* offline */
      }
    }
    if (companyId) return Number(companyId);
    const meta = await fetchBleCacheMeta();
    if (meta?.companyId) return meta.companyId;
    return BLE_DEFAULT_COMPANY_ID;
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
    try {
      let center = [53.038, 39.011];
      let zoom = 15;
      try {
        const cfg = await bleApiFetch("/api/v1/map/config");
        if (cfg.defaultView?.latitude) center = [cfg.defaultView.latitude, cfg.defaultView.longitude];
        if (cfg.defaultZoom) zoom = cfg.defaultZoom;
      } catch {
        /* default center */
      }
      initBleMap(center, zoom);

      const companyId = await resolveCompanyId();
      bleCompanyId = companyId;

      let offlineFirst = false;
      try {
        offlineFirst = sessionStorage.getItem(BLE_OFFLINE_FIRST_KEY) === "1";
      } catch {
        /* ignore */
      }

      let rawBle;
      let cacheNotice = "";

      if (offlineFirst) {
        const cached = await fetchBleListOffline(companyId);
        if (cached?.data?.length) {
          rawBle = cached.data;
          cacheNotice =
            "Показан сохранённый список меток от " +
            formatCacheAge(cached.updatedAt) +
            " (офлайн-режим).";
        }
      }

      if (!rawBle) {
        try {
          rawBle = await bleApiFetch(`/api/v1/map/ble/${companyId}`);
          try {
            sessionStorage.removeItem(BLE_OFFLINE_FIRST_KEY);
          } catch {
            /* ignore */
          }
        } catch (bleErr) {
          const cached = await fetchBleListOffline(companyId);
          if (cached?.data?.length) {
            rawBle = cached.data;
            cacheNotice =
              "Показан сохранённый список меток от " +
              formatCacheAge(cached.updatedAt) +
              " (без прямого доступа к API).";
            try {
              sessionStorage.setItem(BLE_OFFLINE_FIRST_KEY, "1");
            } catch {
              /* ignore */
            }
          } else {
            throw bleErr;
          }
        }
      }

      await applyBleListToMap(rawBle, cacheNotice);
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
        preferCanvas: fsMobile,
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
    initEmbeddedChrome();
    bindUi();
    loadBleMap();
    scheduleMapResize();
  });
})();
