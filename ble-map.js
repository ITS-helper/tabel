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
  const BLE_TRANSPORT_KEY = "ww-ble-transport";

  const BLE_TOKEN_KEY = "accessToken";
  const BLE_AUTO_USER = "impl_dept";
  const BLE_AUTO_PASS = "impl_dept_vsm_2024";

  let bleMap = null;
  let bleMapData = [];
  let bleMapFilter = "all";
  let bleMapInitialized = false;
  let bleZoneData = [];
  let bleClusterGroup = null;

  let bleMapFS = null;
  let bleMapFSFilter = "all";
  let bleMapFSInitialized = false;
  let fsTileLayers = null;
  let fsTileLayerCurrent = "street";
  let bleClusterGroupFS = null;

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[m]
    );
  }

  function getBleToken() {
    return localStorage.getItem(BLE_TOKEN_KEY);
  }

  function showMapMsg(text, type = "") {
    const el = document.getElementById("mapMsg");
    if (!el) return;
    el.textContent = text;
    el.className = "map-msg" + (type ? " " + type : "");
    el.hidden = false;
  }

  function hideMapMsg() {
    const el = document.getElementById("mapMsg");
    if (el) el.hidden = true;
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
      const timer = setTimeout(() => ctrl.abort(), BLE_FETCH_TIMEOUT_MS);
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
        if (cid != null && Number(cid) !== Number(companyId)) continue;
        const payload = body.payload;
        if (!Array.isArray(payload)) continue;
        return {
          data: payload,
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

  function drawZones(targetMap) {
    if (!targetMap || !bleZoneData.length) return;
    bleZoneData.forEach((z) => {
      L.polygon(z.pts, { color: z.color, opacity: 0.35, fillOpacity: 0.15, weight: 1.5 })
        .bindTooltip(z.name, { permanent: false, className: "zone-label" })
        .addTo(targetMap);
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
    return `<div style="font-size:13px;line-height:1.5;min-width:160px;max-width:260px;"><div style="font-family:Oswald,sans-serif;font-size:1em;font-weight:700;color:#37474F;margin-bottom:2px;">Метка #${esc(pt.ble)}</div>${pt.bleType ? `<div style="color:#00897b;font-size:12px;font-weight:600;margin-bottom:3px;">${esc(pt.bleType.replace(/^\d+ - /, ""))}</div>` : ""}${pt.locationDesc ? `<div style="color:#546E7A;font-size:12px;margin-bottom:2px;">${esc(pt.locationDesc)}</div>` : ""}${photoHtml}</div>`;
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

  function renderBleMarkers() {
    if (!bleMap) return;
    if (bleClusterGroup) bleMap.removeLayer(bleClusterGroup);
    bleClusterGroup = makeClusterGroup();
    bleMapData.forEach((pt) => {
      if (!pt.lat || !pt.lng) return;
      if (bleMapFilter !== "all" && pt.status !== bleMapFilter) return;
      L.marker([pt.lat, pt.lng], { icon: createBleIcon(pt) })
        .bindPopup(makePopup(pt), { maxWidth: popupMaxWidth() })
        .addTo(bleClusterGroup);
    });
    bleMap.addLayer(bleClusterGroup);
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
    renderBleMarkers();
    if (bleMapFS) renderFsMarkers();
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

  function revealMapControls() {
    const dock = document.getElementById("mapFloatDock");
    if (dock) dock.hidden = false;
    const retry = document.getElementById("mapRetryBtn");
    if (retry) retry.hidden = true;
    const retryWrap = document.getElementById("mapRetryBtnWrap");
    if (retryWrap) retryWrap.hidden = true;
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
      let companyId;
      try {
        const ud = await bleApiFetch("/api/v1/user/me/");
        companyId = ud.companyId || ud.company_id;
      } catch {
        try {
          const ud2 = await bleApiFetch("/api/v1/user/data");
          companyId = ud2.companyId || ud2.company_id;
        } catch {
          /* no company */
        }
      }
      if (!companyId) {
        showMapMsg("Не удалось определить companyId", "error");
        return;
      }
      let rawBle;
      let cacheNotice = "";
      try {
        rawBle = await bleApiFetch(`/api/v1/map/ble/${companyId}`);
      } catch (bleErr) {
        const cached = await fetchBleListOffline(companyId);
        if (cached) {
          rawBle = cached.data;
          cacheNotice =
            "Показан сохранённый список меток от " +
            formatCacheAge(cached.updatedAt) +
            " (без прямого доступа к API).";
        } else {
          throw bleErr;
        }
      }
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
              name: z.name || "",
              color: z.color || "#0088cc",
              pts: pointsByZone[z.id] || [],
            }))
            .filter((z) => z.pts.length > 2);
          drawZones(bleMap);
        }
      } catch {
        /* zones optional */
      }
      const validPts = bleMapData.filter((p) => p.lat && p.lng);
      const pt313 = bleMapData.find(
        (p) => p.ble === "313" || p.ble === "BLE313" || String(p.ble).replace(/^ble/i, "") === "313"
      );
      if (pt313?.lat && pt313.lng) {
        bleMap.setView([pt313.lat, pt313.lng], 18);
      } else if (validPts.length > 1) {
        bleMap.fitBounds(
          L.latLngBounds(validPts.map((p) => [p.lat, p.lng])),
          { padding: [30, 30] }
        );
      }
      revealMapControls();
      if (cacheNotice) showMapMsg(cacheNotice, "ok");
      else hideMapMsg();
      bleMapInitialized = true;
      scheduleMapResize();
    } catch (e) {
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
      showMapMsg(
        "Ошибка загрузки карты: " + formatBleError(e, tried) + " Нажмите «Обновить».",
        "error"
      );
      const retryWrap = document.getElementById("mapRetryBtnWrap");
      if (retryWrap) retryWrap.hidden = false;
    }
  }

  async function retryBleMap() {
    const btn = document.getElementById("mapRetryBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⌛ Загрузка...";
    }
    localStorage.removeItem(BLE_TOKEN_KEY);
    bleMapInitialized = false;
    hideMapMsg();
    await loadBleMap();
    if (btn) {
      btn.disabled = false;
      btn.textContent = "↺ Обновить карту";
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

  function renderFsMarkers() {
    if (!bleMapFS) return;
    if (bleClusterGroupFS) bleMapFS.removeLayer(bleClusterGroupFS);
    bleClusterGroupFS = makeClusterGroup();
    bleMapData.forEach((pt) => {
      if (!pt.lat || !pt.lng) return;
      if (bleMapFSFilter !== "all" && pt.status !== bleMapFSFilter) return;
      L.marker([pt.lat, pt.lng], { icon: createBleIcon(pt) })
        .bindPopup(makePopup(pt), { maxWidth: popupMaxWidth() })
        .addTo(bleClusterGroupFS);
    });
    bleMapFS.addLayer(bleClusterGroupFS);
  }

  window.openFullscreenMap = function openFullscreenMap() {
    const overlay = document.getElementById("mapFullscreenOverlay");
    if (!overlay) return;
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
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
          if (found?.lat && found?.lng && bleClusterGroupFS) {
            bleClusterGroupFS.eachLayer((m) => {
              if (m.getLatLng().lat === found.lat && m.getLatLng().lng === found.lng) {
                bleClusterGroupFS.zoomToShowLayer(m, () => m.openPopup());
              }
            });
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
    setTimeout(() => bleMapFS?.invalidateSize(), 150);
  };

  window.closeFullscreenMap = function closeFullscreenMap() {
    document.getElementById("mapFullscreenOverlay")?.classList.remove("open");
    document.body.style.overflow = "";
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

    document.getElementById("mapFullscreenBtnWrap")?.addEventListener("click", openFullscreenMap);
    document.getElementById("mapFullscreenClose")?.addEventListener("click", closeFullscreenMap);
    document.getElementById("mapRetryBtn")?.addEventListener("click", retryBleMap);
    document.getElementById("photoViewerOverlay")?.addEventListener("click", closePhotoViewer);
    document.getElementById("photoViewerClose")?.addEventListener("click", closePhotoViewer);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (document.getElementById("mapFullscreenOverlay")?.classList.contains("open")) {
          closeFullscreenMap();
        } else {
          closePhotoViewer();
        }
      }
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
