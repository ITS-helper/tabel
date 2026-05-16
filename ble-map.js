(function () {
  "use strict";

  const BLE_API_BASE = "https://raspy-sound-6f18.kejexu8hem1.workers.dev/proxy";
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

  async function bleAutoLogin() {
    const res = await fetch(BLE_API_BASE + "/api/v1/token", {
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

  async function bleApiFetch(path, retried = false) {
    let token = getBleToken();
    if (!token) {
      if (retried) throw new Error("auth_failed");
      await bleAutoLogin();
      return bleApiFetch(path, true);
    }
    const res = await fetch(BLE_API_BASE + path, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 500) {
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
    bleMap = L.map("bleMap", { attributionControl: false, zoomControl: true }).setView(center, zoom);
    const tileLayers = {
      satellite: L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Esri" }
      ),
      street: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"),
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
        .bindPopup(makePopup(pt), { maxWidth: 280 })
        .addTo(bleClusterGroup);
    });
    bleMap.addLayer(bleClusterGroup);
  }

  function updateMapStats() {
    const all = bleMapData.length;
    const ok = bleMapData.filter((p) => p.status === "ok").length;
    const bat = bleMapData.filter((p) => p.status === "battery").length;
    const insp = bleMapData.filter((p) => p.status === "inspection").length;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set("fcAll", all);
    set("fcOk", ok);
    set("fcBat", bat);
    set("fcInsp", insp);
  }

  function revealMapControls() {
    ["mapLayerToggle", "mapFiltersBlock", "mapBottomControls"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = false;
    });
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
      const rawBle = await bleApiFetch(`/api/v1/map/ble/${companyId}`);
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
      hideMapMsg();
      bleMapInitialized = true;
    } catch (e) {
      localStorage.removeItem(BLE_TOKEN_KEY);
      showMapMsg(
        "Ошибка загрузки карты: " + e.message + ". Нажмите «Обновить» для повторной попытки.",
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
    const el = (id) => document.getElementById(id);
    if (el("fcFsAll")) el("fcFsAll").textContent = bleMapData.length;
    if (el("fcFsOk")) el("fcFsOk").textContent = bleMapData.filter((p) => p.status === "ok").length;
    if (el("fcFsBat")) el("fcFsBat").textContent = bleMapData.filter((p) => p.status === "battery").length;
    if (el("fcFsInsp")) el("fcFsInsp").textContent = bleMapData.filter((p) => p.status === "inspection").length;
  };

  function renderFsMarkers() {
    if (!bleMapFS) return;
    if (bleClusterGroupFS) bleMapFS.removeLayer(bleClusterGroupFS);
    bleClusterGroupFS = makeClusterGroup();
    bleMapData.forEach((pt) => {
      if (!pt.lat || !pt.lng) return;
      if (bleMapFSFilter !== "all" && pt.status !== bleMapFSFilter) return;
      L.marker([pt.lat, pt.lng], { icon: createBleIcon(pt) })
        .bindPopup(makePopup(pt), { maxWidth: 280 })
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
      bleMapFS = L.map("bleMapFS", { attributionControl: false, zoomControl: true });
      fsTileLayers = {
        satellite: L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          { attribution: "Esri" }
        ),
        street: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"),
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
        btn.addEventListener("click", () => {
          document.querySelectorAll("[data-fsfilter]").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          bleMapFSFilter = btn.dataset.fsfilter;
          renderFsMarkers();
        });
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
    document.querySelectorAll(".map-filter-btn[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".map-filter-btn[data-filter]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        bleMapFilter = btn.dataset.filter;
        renderBleMarkers();
      });
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
  }

  document.addEventListener("DOMContentLoaded", () => {
    initEmbeddedChrome();
    bindUi();
    loadBleMap();
    setTimeout(() => bleMap?.invalidateSize(), 400);
  });
})();
