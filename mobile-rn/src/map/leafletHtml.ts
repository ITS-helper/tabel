import {
  ARCGIS_SATELLITE_URL,
  BLE_DEFAULT_CENTER_BLE,
  BLE_DEFAULT_CENTER_ZOOM,
  BLE_DOT_PX,
  BLE_DOT_INSPECTION_PX,
  BLE_MAP_MAX_ZOOM,
  BLE_MARKER_HOLD_MS,
  BLE_TILE_MAX_ZOOM,
  BLE_ZONE_NEON,
  BLE_ZONE_NEON_FILL,
} from "../config";

/** Leaflet в WebView — стиль меток/попапов/зон как ble-map.js + ble-map.css */
export function buildLeafletHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"/>
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"/>
  <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@700&display=swap" rel="stylesheet"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
  <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"><\/script>
  <style>
    html, body, #map { margin:0; padding:0; height:100%; width:100%; background:#37474f; }
    .leaflet-control-attribution { display:none !important; }
    .leaflet-pane.ble-zones-pane { z-index:350; }
    .leaflet-pane.ble-markers-pane { z-index:450; }
    .ble-dot {
      width:${BLE_DOT_PX}px; height:${BLE_DOT_PX}px; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      font-size:7px; font-weight:700; color:#fff; font-family:Oswald,sans-serif;
      letter-spacing:-0.3px; line-height:1;
      box-shadow:0 1px 4px rgba(0,0,0,.35); border:1.5px solid #fff;
    }
    .ble-dot-ok { background:#0abab5; }
    .ble-dot-battery { background:#ffa726; animation:pulse-orange 2s infinite; }
    .ble-dot-inspection {
      background:#ffb300;
      border-width:2px;
      font-size:8px;
      animation:pulse-yellow-green 2s ease-in-out infinite;
    }
    .ble-dot--dirty { border-color:#ffeb3b; box-shadow:0 0 0 2px rgba(255,235,59,.75); }
    body.ble-map--edit .ble-dot--hold-pending { animation:ble-dot-hold-pulse 1s linear forwards; }
    body.ble-map--edit .ble-dot--hold-armed {
      transform:scale(1.08); z-index:10000 !important;
      box-shadow:0 0 0 3px #fff,0 0 0 6px #2196f3,0 4px 14px rgba(21,101,192,.45);
    }
    @keyframes ble-dot-hold-pulse {
      0% { box-shadow:0 2px 6px rgba(0,0,0,.3),0 0 0 0 rgba(33,150,243,.55); }
      100% { box-shadow:0 2px 6px rgba(0,0,0,.3),0 0 0 12px rgba(33,150,243,0); }
    }
    @keyframes pulse-orange {
      0%,100% { box-shadow:0 0 0 0 rgba(255,167,38,.5); }
      50% { box-shadow:0 0 0 6px rgba(255,167,38,0); }
    }
    @keyframes pulse-yellow-green {
      0%,100% { background-color:#ffb300; box-shadow:0 0 0 0 rgba(255,179,0,.55); }
      50% { background-color:#66bb6a; box-shadow:0 0 0 5px rgba(102,187,106,0); }
    }
    .marker-cluster-small { background-color:rgba(10,186,181,.2); }
    .marker-cluster-small div { background-color:rgba(10,186,181,.75); }
    .marker-cluster-medium { background-color:rgba(0,150,136,.2); }
    .marker-cluster-medium div { background-color:rgba(0,150,136,.75); }
    .marker-cluster-large { background-color:rgba(0,105,92,.2); }
    .marker-cluster-large div { background-color:rgba(0,105,92,.75); }
    .marker-cluster div {
      width:30px; height:30px; margin-left:5px; margin-top:5px;
      text-align:center; border-radius:50%; font-family:Oswald,sans-serif;
      font-size:13px; font-weight:700; color:#fff;
      display:flex; align-items:center; justify-content:center;
    }
    .leaflet-popup-content-wrapper { border-radius:10px !important; }
    .ble-popup-photos { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
    .ble-popup-photo-link { display:block; flex:1 1 120px; min-width:120px; max-width:100%; cursor:zoom-in; }
    .ble-popup-photo {
      display:block; width:100%; height:132px; object-fit:cover;
      border-radius:6px; border:1px solid #e8edf2; background:#eceff1;
    }
    .ble-popup-loading { margin:8px 0 0; font-size:12px; color:#546e7a; }
    .ble-popup-patrol-btn {
      margin-top:8px; width:100%; padding:8px 10px; border:none; border-radius:8px;
      background:#1565c0; color:#fff; font-weight:700; font-size:13px;
    }
    #photoViewer {
      display:none; position:fixed; inset:0; z-index:99999;
      background:rgba(0,0,0,.92); align-items:center; justify-content:center; padding:12px;
    }
    #photoViewer.open { display:flex; }
    #photoViewer img { max-width:100%; max-height:100%; object-fit:contain; border-radius:8px; }
    #photoViewerClose {
      position:absolute; top:12px; right:12px; width:36px; height:36px;
      border:none; border-radius:50%; background:rgba(255,255,255,.15); color:#fff; font-size:22px;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="photoViewer"><button id="photoViewerClose" type="button">×</button><img id="photoViewerImg" alt=""/></div>
  <script>
    var BOOT_BLE = "${BLE_DEFAULT_CENTER_BLE}";
    var BOOT_ZOOM = ${BLE_DEFAULT_CENTER_ZOOM};
    var ZONE_NEON = "${BLE_ZONE_NEON}";
    var ZONE_NEON_FILL = "${BLE_ZONE_NEON_FILL}";
    var MAP_MAX_ZOOM = ${BLE_MAP_MAX_ZOOM};
    var TILE_MAX_ZOOM = ${BLE_TILE_MAX_ZOOM};
    var map = L.map("map", {
      zoomControl:true,
      attributionControl:false,
      maxZoom:MAP_MAX_ZOOM,
      fadeAnimation:false,
      markerZoomAnimation:false,
      zoomAnimation:true
    }).setView([59.6603, 28.3967], 16);
    map.createPane("bleZones");
    map.getPane("bleZones").classList.add("ble-zones-pane");
    map.createPane("bleMarkers");
    map.getPane("bleMarkers").classList.add("ble-markers-pane");
    L.tileLayer("${ARCGIS_SATELLITE_URL}", {
      maxZoom: MAP_MAX_ZOOM,
      maxNativeZoom: TILE_MAX_ZOOM,
      minZoom: 10,
      detectRetina: false,
      updateWhenIdle: false,
      updateWhenZooming: true,
      keepBuffer: 3,
      attribution: ""
    }).addTo(map);
    var cluster = null;
    var markerLayer = null;
    var clusterEnabled = true;
    var editMode = false;
    var dirtySet = {};
    var markerByBle = {};
    var markerDataByBle = {};
    var HOLD_MS = ${BLE_MARKER_HOLD_MS};
    var markerRegistry = {};
    var lastEditMode = false;
    var lastRenderKey = "";
    var lastZonesKey = "";
    var plainAddRaf = 0;

    function makeClusterGroup(markerCount) {
      var heavy = markerCount > 350;
      return L.markerClusterGroup({
      maxClusterRadius: function(z) {
        if (z >= MAP_MAX_ZOOM - 1) return 0;
        if (z < 15) return 100;
        if (z < 17) return 55;
        return 18;
      },
      disableClusteringAtZoom: MAP_MAX_ZOOM,
      spiderfyOnMaxZoom: false,
      showCoverageOnHover: false,
      animate: !heavy,
      animateAddingMarkers: !heavy,
      chunkedLoading: true,
      chunkInterval: heavy ? 120 : 64,
      chunkDelay: heavy ? 20 : 8,
      removeOutsideVisibleBounds: true,
      iconCreateFunction: function(c) {
        var n = c.getChildCount();
        var size = n < 10 ? "small" : n < 50 ? "medium" : "large";
        return L.divIcon({
          html: "<div><span>" + n + "</span></div>",
          className: "marker-cluster marker-cluster-" + size,
          iconSize: L.point(40, 40)
        });
      }
      });
    }

    function ensureMarkerTarget(useCluster, markerCount) {
      if (plainAddRaf) {
        cancelAnimationFrame(plainAddRaf);
        plainAddRaf = 0;
      }
      if (useCluster) {
        if (markerLayer) {
          markerLayer.clearLayers();
          map.removeLayer(markerLayer);
          markerLayer = null;
        }
        if (!cluster) {
          cluster = makeClusterGroup(markerCount || 0);
          map.addLayer(cluster);
        }
        return cluster;
      }
      if (cluster) {
        cluster.clearLayers();
        map.removeLayer(cluster);
        cluster = null;
      }
      if (!markerLayer) {
        markerLayer = L.layerGroup([], { pane: "bleMarkers" }).addTo(map);
      }
      return markerLayer;
    }
    var zoneLayer = L.layerGroup([], { pane: "bleZones" }).addTo(map);
    var photoSrcMap = {};
    var userMoved = false;
    map.on("movestart", function() { userMoved = true; });

    function esc(s) {
      return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
    }

    function bleDotClass(status) {
      if (status === "battery") return "ble-dot-battery";
      if (status === "inspection") return "ble-dot-inspection";
      return "ble-dot-ok";
    }

    function createBleIcon(m, isDirty) {
      var insp = m.status === "inspection";
      var hit = insp ? ${BLE_DOT_INSPECTION_PX} : ${BLE_DOT_PX};
      var dirtyCls = isDirty ? " ble-dot--dirty" : "";
      return L.divIcon({
        className: "",
        html: '<div class="ble-dot ' + bleDotClass(m.status) + dirtyCls + '">' + esc(m.ble) + '</div>',
        iconSize: [hit, hit],
        iconAnchor: [hit/2, hit/2]
      });
    }

    function notifyMarkerMoved(m, lat, lng) {
      if (!window.ReactNativeWebView || m.id == null) return;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "markerMoved",
        id: m.id,
        ble: String(m.ble),
        lat: lat,
        lng: lng
      }));
    }

    function findTouch(touchList, id) {
      if (id == null || !touchList) return null;
      for (var i = 0; i < touchList.length; i++) {
        if (touchList[i].identifier === id) return touchList[i];
      }
      return null;
    }

    function touchEnded(e, id) {
      if (id == null || !e.changedTouches) return false;
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === id) return true;
      }
      return false;
    }

    function setMarkerLatLngFromClient(marker, mapRef, clientX, clientY) {
      var containerPoint = mapRef.mouseEventToContainerPoint({ clientX: clientX, clientY: clientY });
      marker.setLatLng(mapRef.containerPointToLatLng(containerPoint));
    }

    function attachMarkerHoldDrag(marker, m) {
      var holdTimer = null;
      var dragArmed = false;
      var manualDragging = false;
      var suppressClick = false;
      var touchBound = false;
      var activePointer = null;

      var dotEl = function() { return marker.getElement() && marker.getElement().querySelector(".ble-dot"); };
      var getMapRef = function() { return marker._map; };
      var setPending = function(on) { var d = dotEl(); if (d) d.classList.toggle("ble-dot--hold-pending", on); };
      var setArmedVisual = function(on) { var d = dotEl(); if (d) d.classList.toggle("ble-dot--hold-armed", on); };

      var clearHoldTimer = function() {
        if (holdTimer == null) return;
        clearTimeout(holdTimer);
        holdTimer = null;
      };

      var detachDocumentDrag = function() {
        document.removeEventListener("touchmove", onDocMove, { capture: true });
        document.removeEventListener("mousemove", onDocMove, true);
        document.removeEventListener("touchend", onDocEnd, true);
        document.removeEventListener("touchcancel", onDocEnd, true);
        document.removeEventListener("mouseup", onDocEnd, true);
      };

      var resetDragSession = function() {
        clearHoldTimer();
        detachDocumentDrag();
        setPending(false);
        setArmedVisual(false);
        dragArmed = false;
        manualDragging = false;
        activePointer = null;
        var mapRef = getMapRef();
        if (mapRef && mapRef.dragging && mapRef.dragging.enabled() === false) mapRef.dragging.enable();
      };

      var finishManualDrag = function() {
        if (!manualDragging) return;
        manualDragging = false;
        var ll = marker.getLatLng();
        notifyMarkerMoved(m, ll.lat, ll.lng);
        suppressClick = true;
        setTimeout(function() { suppressClick = false; }, 450);
      };

      var attachDocumentDrag = function() {
        document.addEventListener("touchmove", onDocMove, { capture: true, passive: false });
        document.addEventListener("mousemove", onDocMove, true);
        document.addEventListener("touchend", onDocEnd, true);
        document.addEventListener("touchcancel", onDocEnd, true);
        document.addEventListener("mouseup", onDocEnd, true);
      };

      var armDrag = function() {
        holdTimer = null;
        setPending(false);
        dragArmed = true;
        setArmedVisual(true);
        attachDocumentDrag();
        try { navigator.vibrate && navigator.vibrate(40); } catch(e) {}
      };

      var onDocMove = function(e) {
        if (!dragArmed) return;
        var mapRef = getMapRef();
        if (!mapRef) return;
        var x, y;
        if (e.type === "touchmove") {
          var t = findTouch(e.touches, activePointer);
          if (!t) return;
          x = t.clientX; y = t.clientY;
        } else if (activePointer === "mouse") {
          if (e.buttons === 0) return;
          x = e.clientX; y = e.clientY;
        } else return;

        if (!manualDragging) {
          manualDragging = true;
          marker.closePopup();
          if (mapRef.dragging) mapRef.dragging.disable();
        }
        if (e.cancelable) e.preventDefault();
        L.DomEvent.stopPropagation(e);
        setMarkerLatLngFromClient(marker, mapRef, x, y);
      };

      var onDocEnd = function(e) {
        if (e.type === "touchend" || e.type === "touchcancel") {
          if (activePointer !== "mouse" && !touchEnded(e, activePointer)) return;
        } else if (activePointer !== "mouse") return;
        if (!dragArmed && holdTimer == null) return;
        finishManualDrag();
        resetDragSession();
      };

      var onHoldStart = function(e) {
        if (!editMode || m.id == null) return;
        if (e.type === "mousedown" && e.button !== 0) return;
        L.DomEvent.stopPropagation(e);
        if (e.cancelable) e.preventDefault();
        resetDragSession();
        activePointer = e.type === "touchstart" ? (e.touches[0] && e.touches[0].identifier) || 0 : "mouse";
        setPending(true);
        holdTimer = setTimeout(armDrag, HOLD_MS);
      };

      var onHoldEndEarly = function(e) {
        if (dragArmed || manualDragging) return;
        if (holdTimer != null) {
          L.DomEvent.stopPropagation(e);
          clearHoldTimer();
          setPending(false);
        }
      };

      var bindPointer = function() {
        var el = marker.getElement();
        if (!el) return;
        if (touchBound && marker._wwHoldEl === el) return;
        if (touchBound) unbindPointer();
        marker._wwHoldEl = el;
        touchBound = true;
        L.DomEvent.on(el, "mousedown", onHoldStart, marker);
        el.addEventListener("touchstart", onHoldStart, { passive: false, capture: true });
        L.DomEvent.on(el, "mouseup", onHoldEndEarly, marker);
        el.addEventListener("touchend", onHoldEndEarly, { passive: false, capture: true });
        el.addEventListener("touchcancel", onHoldEndEarly, { passive: false, capture: true });
      };

      var unbindPointer = function() {
        var el = marker._wwHoldEl || marker.getElement();
        if (!el) {
          touchBound = false;
          marker._wwHoldEl = null;
          return;
        }
        touchBound = false;
        marker._wwHoldEl = null;
        L.DomEvent.off(el, "mousedown", onHoldStart, marker);
        el.removeEventListener("touchstart", onHoldStart, { capture: true });
        L.DomEvent.off(el, "mouseup", onHoldEndEarly, marker);
        el.removeEventListener("touchend", onHoldEndEarly, { capture: true });
        el.removeEventListener("touchcancel", onHoldEndEarly, { capture: true });
      };

      marker._wwHoldRebind = bindPointer;
      marker.on("add", bindPointer);
      marker.on("remove", function() { unbindPointer(); resetDragSession(); });
      marker.on("click", function(e) {
        if (suppressClick || holdTimer != null || dragArmed || manualDragging) {
          L.DomEvent.stopPropagation(e);
        }
      });
    }

    function photoDisplaySrc(url) {
      if (!url) return "";
      return photoSrcMap[url] || url;
    }

    function makePopupHtml(m) {
      var routeLine = m.routeTitle
        ? '<div style="color:#1565C0;font-size:12px;font-weight:600;margin-bottom:3px;">' + esc(m.routeTitle) + '</div>'
        : "";
      var typeLine = m.bleTypeLabel
        ? '<div style="color:#00897b;font-size:12px;font-weight:600;margin-bottom:3px;">' + esc(String(m.bleTypeLabel).replace(/^\\d+ - /, "")) + '</div>'
        : "";
      var locLine = m.locationDesc
        ? '<div style="color:#546E7A;font-size:12px;margin-bottom:2px;">' + esc(m.locationDesc) + '</div>'
        : "";
      var photos = "";
      var urls = [m.photoTag, m.photoPlace].filter(Boolean);
      if (!urls.length) {
        photos = '<p class="ble-popup-loading">Фото недоступно.</p>';
      } else {
        photos = '<div class="ble-popup-photos">';
        urls.forEach(function(url, idx) {
          var src = photoDisplaySrc(url);
          photos += '<a class="ble-popup-photo-link" href="#" data-photo="' + esc(url) + '">' +
            '<img class="ble-popup-photo" src="' + esc(src) + '" alt="" loading="' + (idx ? "lazy" : "eager") + '" referrerpolicy="no-referrer"/></a>';
        });
        photos += '</div>';
      }
      var patrol = '<button type="button" class="ble-popup-patrol-btn" data-patrol-ble="' + esc(m.ble) + '">Обход (BLE)</button>';
      return '<div class="ble-popup-body" style="font-size:13px;line-height:1.5;min-width:160px;max-width:260px;">' +
        '<div style="font-family:Oswald,sans-serif;font-size:1em;font-weight:700;color:#37474F;margin-bottom:2px;">Метка #' + esc(m.ble) + '</div>' +
        routeLine + typeLine + locLine + photos + patrol + '</div>';
    }

    function wirePopupDom(marker) {
      marker.on("popupopen", function() {
        var el = marker.getPopup() && marker.getPopup().getElement();
        if (!el) return;
        el.querySelectorAll("[data-photo]").forEach(function(a) {
          a.addEventListener("click", function(ev) {
            ev.preventDefault();
            var url = a.getAttribute("data-photo");
            var img = document.getElementById("photoViewerImg");
            var ov = document.getElementById("photoViewer");
            if (img && ov && url) {
              img.src = photoDisplaySrc(url);
              ov.classList.add("open");
            }
          });
        });
        var btn = el.querySelector("[data-patrol-ble]");
        if (btn && window.ReactNativeWebView) {
          btn.addEventListener("click", function(ev) {
            ev.preventDefault();
            var ble = btn.getAttribute("data-patrol-ble");
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: "patrol", ble: String(ble) }));
            marker.closePopup();
          }, { once: true });
        }
      });
    }

    function ensureMarkerPopup(marker, m) {
      if (marker.getPopup()) return;
      marker.bindPopup(function() { return makePopupHtml(m); }, { maxWidth: 280, minWidth: 160 });
      wirePopupDom(marker);
    }

    function bindPopup(marker, m) {
      marker.on("click", function() { ensureMarkerPopup(marker, m); });
    }

    function zoneStyleSatellite(z) {
      return {
        pane: "bleZones",
        color: ZONE_NEON,
        fillColor: z.color || ZONE_NEON_FILL,
        opacity: 0.94,
        fillOpacity: 0,
        weight: 1.15
      };
    }

    function centerOnBle(markers, ble, zoom, animate) {
      var key = String(ble || "").trim();
      if (!key) return false;
      var found = markers.find(function(m) { return String(m.ble) === key; });
      if (!found || found.lat == null || found.lng == null) return false;
      map.setView([found.lat, found.lng], zoom || BOOT_ZOOM, { animate: !!animate });
      return true;
    }

    function buildRenderKey(payload, markers, useCluster) {
      var dirty = (payload.dirtyIds || []).join(",");
      return (useCluster ? "c" : "p") + ":" + markers.length + ":" + !!payload.editMode + ":" + dirty;
    }

    function syncMarkerRegistry(markers) {
      var keep = {};
      markers.forEach(function(m) { keep[String(m.ble)] = true; });
      Object.keys(markerRegistry).forEach(function(k) {
        if (keep[k]) return;
        try { markerRegistry[k].marker.remove(); } catch(e) {}
        delete markerRegistry[k];
      });
    }

    function clearMarkerRegistry() {
      Object.keys(markerRegistry).forEach(function(k) {
        try { markerRegistry[k].marker.remove(); } catch(e) {}
        delete markerRegistry[k];
      });
    }

    function ensureEditMarker(mk, m) {
      if (!mk._wwHoldRebind) {
        mk.bindPopup('<span style="font-size:12px;color:#546E7A">Удержите 1 сек., затем перетащите</span>', { maxWidth: 220 });
        attachMarkerHoldDrag(mk, m);
      } else if (typeof mk._wwHoldRebind === "function") {
        mk._wwHoldRebind();
      }
    }

    function getOrCreateMarker(m, isDirty, edit) {
      var key = String(m.ble);
      var entry = markerRegistry[key];
      var icon = createBleIcon(m, isDirty);
      if (entry) {
        entry.m = m;
        entry.marker.setLatLng([m.lat, m.lng]);
        entry.marker.setIcon(icon);
        if (edit && m.id != null) {
          ensureEditMarker(entry.marker, m);
        } else if (typeof entry.marker._wwHoldRebind !== "function") {
          bindPopup(entry.marker, m);
        }
        return entry.marker;
      }
      var mk = L.marker([m.lat, m.lng], { icon: icon, pane: "bleMarkers" });
      if (edit && m.id != null) {
        ensureEditMarker(mk, m);
      } else {
        bindPopup(mk, m);
      }
      markerRegistry[key] = { marker: mk, m: m };
      return mk;
    }

    function zoneCoordsKey(z) {
      if (!z.pts || !z.pts.length) return "";
      var s = 0;
      for (var i = 0; i < z.pts.length; i++) {
        var p = z.pts[i];
        s = ((s << 5) - s + Math.round(p[0] * 1e5) + Math.round(p[1] * 1e5)) | 0;
      }
      return String(s);
    }

    function renderZones(zones) {
      var zKey = zones.map(function(z) {
        return z.id + ":" + (z.pts ? z.pts.length : 0) + ":" + zoneCoordsKey(z);
      }).join("|");
      if (zKey === lastZonesKey) return [];
      lastZonesKey = zKey;
      zoneLayer.clearLayers();
      var bounds = [];
      zones.forEach(function(z) {
        if (!z.pts || z.pts.length < 3) return;
        var latlngs = z.pts.map(function(p) { return [p[0], p[1]]; });
        L.polygon(latlngs, zoneStyleSatellite(z))
          .bindTooltip(z.name || ("Зона " + z.id), { sticky: true, className: "zone-label" })
          .addTo(zoneLayer);
        latlngs.forEach(function(ll) { bounds.push(ll); });
      });
      return bounds;
    }

    function indexMarkers(markers) {
      markerByBle = {};
      markerDataByBle = {};
      markers.forEach(function(m) {
        if (m.lat == null || m.lng == null) return;
        var entry = markerRegistry[String(m.ble)];
        if (!entry) return;
        markerByBle[String(m.ble)] = entry.marker;
        markerDataByBle[String(m.ble)] = m;
      });
    }

    function addPlainMarkersChunked(target, markers, edit) {
      if (plainAddRaf) {
        cancelAnimationFrame(plainAddRaf);
        plainAddRaf = 0;
      }
      target.clearLayers();
      var list = [];
      var bounds = [];
      markers.forEach(function(m) {
        if (m.lat == null || m.lng == null) return;
        var isDirty = m.id != null && !!dirtySet[m.id];
        list.push({ m: m, isDirty: isDirty });
        bounds.push([m.lat, m.lng]);
      });
      syncMarkerRegistry(markers);
      var i = 0;
      var CHUNK = 72;
      function step() {
        var end = Math.min(i + CHUNK, list.length);
        for (; i < end; i++) {
          var item = list[i];
          target.addLayer(getOrCreateMarker(item.m, item.isDirty, edit));
        }
        if (i < list.length) {
          plainAddRaf = requestAnimationFrame(step);
        } else {
          plainAddRaf = 0;
          indexMarkers(markers);
        }
      }
      if (!list.length) {
        indexMarkers(markers);
        return bounds;
      }
      step();
      return bounds;
    }

    function renderClusterMarkers(target, markers, edit) {
      syncMarkerRegistry(markers);
      var layers = [];
      var bounds = [];
      markers.forEach(function(m) {
        if (m.lat == null || m.lng == null) return;
        var isDirty = m.id != null && !!dirtySet[m.id];
        layers.push(getOrCreateMarker(m, isDirty, edit));
        bounds.push([m.lat, m.lng]);
      });
      target.clearLayers();
      if (target.addLayers) {
        target.addLayers(layers);
      } else {
        layers.forEach(function(l) { target.addLayer(l); });
      }
      indexMarkers(markers);
      return bounds;
    }

    function applyMapView(payload, markers, bounds) {
      if (payload.focus && payload.focus.lat != null && !editMode) {
        map.setView([payload.focus.lat, payload.focus.lng], BOOT_ZOOM, { animate: true });
        if (payload.focus.openPopup) {
          var focusBle = String(payload.focus.ble || "");
          var focusLayer = markerByBle[focusBle];
          var focusData = markerDataByBle[focusBle];
          if (focusLayer && focusData) {
            var openFocus = function() {
              ensureMarkerPopup(focusLayer, focusData);
              focusLayer.openPopup();
            };
            if (clusterEnabled && cluster && cluster.zoomToShowLayer) {
              cluster.zoomToShowLayer(focusLayer, openFocus);
            } else {
              openFocus();
            }
          }
        }
      } else if (payload.bootCenter && !userMoved) {
        centerOnBle(markers, payload.bootCenter, BOOT_ZOOM, false);
      } else if (bounds.length === 1) {
        map.setView(bounds[0], BOOT_ZOOM, { animate: false });
      } else if (bounds.length > 1 && !userMoved) {
        try { map.fitBounds(bounds, { padding: [28, 28], maxZoom: MAP_MAX_ZOOM - 1 }); } catch(e) {}
      }
    }

    function updateMap(payload) {
      if (!payload) return;
      editMode = !!payload.editMode;
      if (editMode !== lastEditMode) {
        clearMarkerRegistry();
        lastRenderKey = "";
        lastEditMode = editMode;
      }
      dirtySet = {};
      (payload.dirtyIds || []).forEach(function(id) { dirtySet[id] = true; });
      document.body.classList.toggle("ble-map--edit", editMode);
      clusterEnabled = editMode ? false : (payload.clusterEnabled !== false);
      var markers = payload.markers || [];
      var zones = payload.zones || [];
      var renderKey = buildRenderKey(payload, markers, clusterEnabled);
      var viewOnly = renderKey === lastRenderKey;
      lastRenderKey = renderKey;

      var zoneBounds = renderZones(zones);
      var target = ensureMarkerTarget(clusterEnabled, markers.length);
      var markerBounds;

      if (editMode || (viewOnly && !plainAddRaf)) {
        markers.forEach(function(m) {
          if (m.lat == null || m.lng == null) return;
          var isDirty = m.id != null && !!dirtySet[m.id];
          var mk = getOrCreateMarker(m, isDirty, editMode);
          markerByBle[String(m.ble)] = mk;
          markerDataByBle[String(m.ble)] = m;
        });
        markerBounds = markers.filter(function(m) { return m.lat != null && m.lng != null; })
          .map(function(m) { return [m.lat, m.lng]; });
      } else if (clusterEnabled) {
        markerBounds = renderClusterMarkers(target, markers, editMode);
      } else {
        markerBounds = addPlainMarkersChunked(target, markers, editMode);
      }

      var bounds = zoneBounds.concat(markerBounds);
      applyMapView(payload, markers, bounds);
      setTimeout(function() { map.invalidateSize(); }, 120);
    }
    window.__updateMap = updateMap;
    window.__updatePhotoSrc = function(src) {
      photoSrcMap = src || {};
    };

    document.getElementById("photoViewerClose").addEventListener("click", function() {
      document.getElementById("photoViewer").classList.remove("open");
      document.getElementById("photoViewerImg").removeAttribute("src");
    });

    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ready" }));
    }
  <\/script>
</body>
</html>`;
}
