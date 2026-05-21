/**
 * Редактор подложки генплана (порт MaskOverlay): drag / resize / rotate на карте Leaflet.
 */
(function (global) {
  const STORAGE_KEY = "ww-ble-genplan-mask";
  const LEGACY_CALIB_KEY = "ww-ble-genplan-calibration";
  const DEFAULT_WIDTH = 520;
  const DEFAULT_OPACITY = 0.55;
  const DEFAULT_VIEW_OPACITY = 0.92;
  const MIN_WIDTH = 80;
  const M_PER_DEG_LAT = 111320;

  const BLEND_MODES = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
  ];

  const BLEND_LABELS = {
    normal: "Обычный",
    multiply: "Умножение",
    screen: "Экран",
    overlay: "Наложение",
    darken: "Затемнение",
    lighten: "Осветление",
    "color-dodge": "Осветление основы",
    "color-burn": "Затемнение основы",
    "hard-light": "Жёсткий свет",
    "soft-light": "Мягкий свет",
    difference: "Разница",
    exclusion: "Исключение",
    hue: "Цветовой тон",
    saturation: "Насыщенность",
    color: "Цвет",
    luminosity: "Яркость",
  };

  function parseAngle(value) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function getAngleFromCenter(point, centerPoint) {
    return (Math.atan2(point.y - centerPoint.y, point.x - centerPoint.x) * 180) / Math.PI;
  }

  function normalizeAngle(value) {
    const normalized = value % 360;
    if (normalized > 180) return normalized - 360;
    if (normalized < -180) return normalized + 360;
    return normalized;
  }

  function isBlendMode(value) {
    return typeof value === "string" && BLEND_MODES.includes(value);
  }

  function getWidthForZoom(savedWidth, savedZoom, currentZoom) {
    if (savedZoom === undefined) return savedWidth;
    return savedWidth * 2 ** (currentZoom - savedZoom);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("not_readable"));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function defaultState(meta, map) {
    const imageSrc = meta ? defaultImageUrl(meta) : null;
    const center = meta && map ? boundsCenter(meta, map) : map ? map.getCenter() : { lat: 0, lng: 0 };
    const width =
      meta && map ? boundsWidthPx(meta, map) : DEFAULT_WIDTH;
    return {
      imageSrc,
      imageUrl: meta?.image ? `data/${meta.image}` : "",
      fileName: meta?.image || "",
      center: L.latLng(center),
      width,
      opacity: DEFAULT_VIEW_OPACITY,
      rotation: 0,
      blendMode: "normal",
      aspectRatio: 1,
      isVisible: true,
      isEditMode: false,
      zoom: map ? map.getZoom() : undefined,
    };
  }

  function defaultImageUrl(meta) {
    const file = meta?.image || "ble-genplan.png";
    const build = meta?.build || "";
    return `data/${file}${build ? `?v=${build}` : ""}`;
  }

  function boundsCenter(meta, map) {
    const sw = meta.southWest;
    const ne = meta.northEast;
    return L.latLng((sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2);
  }

  function boundsWidthPx(meta, map) {
    const sw = map.latLngToLayerPoint(L.latLng(meta.southWest[0], meta.southWest[1]));
    const ne = map.latLngToLayerPoint(L.latLng(meta.northEast[0], meta.northEast[1]));
    return Math.max(MIN_WIDTH, Math.abs(ne.x - sw.x));
  }

  function metersToLatOffset(m) {
    return m / M_PER_DEG_LAT;
  }

  function metersToLngOffset(m, lat) {
    return m / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  }

  function legacyCorners(meta, cal) {
    const sw = meta.southWest;
    const ne = meta.northEast;
    const refLat = (sw[0] + ne[0]) / 2 + metersToLatOffset(cal.offsetNorthM || 0);
    const refLng = (sw[1] + ne[1]) / 2 + metersToLngOffset(cal.offsetEastM || 0, refLat);
    const scale = cal.scale > 0 ? cal.scale : 1;
    const halfNorthM = ((ne[0] - sw[0]) / 2) * scale * M_PER_DEG_LAT;
    const halfEastM =
      ((ne[1] - sw[1]) / 2) * scale * M_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180);
    const rad = ((cal.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rot = (x, y) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
    const toLl = (x, y) =>
      L.latLng(refLat + y / M_PER_DEG_LAT, refLng + x / (M_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180)));
    const tl = rot(-halfEastM, halfNorthM);
    const tr = rot(halfEastM, halfNorthM);
    const bl = rot(-halfEastM, -halfNorthM);
    return { tl: toLl(tl.x, tl.y), tr: toLl(tr.x, tr.y), bl: toLl(bl.x, bl.y) };
  }

  function legacyToMask(meta, cal, map, build) {
    const c = legacyCorners(meta, cal);
    const center = L.latLng((c.tl.lat + c.bl.lat) / 2, (c.tl.lng + c.tr.lng) / 2);
    const tl = map.latLngToLayerPoint(c.tl);
    const tr = map.latLngToLayerPoint(c.tr);
    const bl = map.latLngToLayerPoint(c.bl);
    const width = Math.max(MIN_WIDTH, Math.hypot(tr.x - tl.x, tr.y - tl.y));
    const height = Math.max(1, Math.hypot(bl.x - tl.x, bl.y - tl.y));
    return {
      imageSrc: defaultImageUrl({ ...meta, build }),
      imageUrl: `data/${meta.image || "ble-genplan.png"}`,
      fileName: meta.image || "ble-genplan.png",
      center,
      width,
      opacity: 0.97,
      rotation: cal.rotation || 0,
      blendMode: "normal",
      aspectRatio: width / height,
      isVisible: true,
      isEditMode: false,
      zoom: map.getZoom(),
    };
  }

  function loadStored(meta, map, build) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.center?.lat === "number" && typeof p.center.lng === "number") {
          const imageSrc =
            typeof p.imageSrc === "string"
              ? p.imageSrc
              : p.imageUrl
                ? `${p.imageUrl}${build ? `?v=${build}` : ""}`
                : defaultImageUrl({ ...meta, build });
          return {
            imageSrc,
            imageUrl: p.imageUrl || "",
            fileName: p.fileName || meta?.image || "",
            center: L.latLng(p.center.lat, p.center.lng),
            width: getWidthForZoom(
              typeof p.width === "number" ? p.width : DEFAULT_WIDTH,
              p.zoom,
              map.getZoom()
            ),
            opacity: typeof p.opacity === "number" ? p.opacity : DEFAULT_OPACITY,
            rotation: typeof p.rotation === "number" ? p.rotation : 0,
            blendMode: isBlendMode(p.blendMode) ? p.blendMode : "normal",
            aspectRatio: typeof p.aspectRatio === "number" ? p.aspectRatio : 1,
            isVisible: p.isVisible !== false,
            isEditMode: false,
            zoom: map.getZoom(),
          };
        }
      }
    } catch {
      /* ignore */
    }

    try {
      const leg = JSON.parse(localStorage.getItem(LEGACY_CALIB_KEY));
      if (leg && meta && map) {
        const cal = {
          rotation: Number(leg.rotation) || 0,
          offsetNorthM: Number(leg.offsetNorthM) || 0,
          offsetEastM: Number(leg.offsetEastM) || 0,
          scale: Number(leg.scale) > 0 ? Number(leg.scale) : 1,
        };
        if (
          Math.abs(cal.rotation) > 0.05 ||
          Math.abs(cal.offsetNorthM) > 0.05 ||
          Math.abs(cal.offsetEastM) > 0.05 ||
          Math.abs(cal.scale - 1) > 0.001
        ) {
          return legacyToMask(meta, cal, map, build);
        }
      }
    } catch {
      /* ignore */
    }

    return defaultState(meta, map);
  }

  function MapAttachment(map, controller) {
    this.map = map;
    this.controller = controller;
    this.imgEl = null;
    this.frameEl = null;
    this.zoomRef = map.getZoom();
    this._onMove = () => this.render();
    this._onZoomEnd = () => {
      const nextZoom = map.getZoom();
      const diff = nextZoom - this.zoomRef;
      if (diff !== 0) {
        controller.state.width *= 2 ** diff;
        this.zoomRef = nextZoom;
        controller.syncUi();
      }
      this.render();
    };
    map.on("move zoom", this._onMove);
    map.on("zoomend", this._onZoomEnd);
  }

  MapAttachment.prototype.ensureDom = function () {
    const pane = this.map.getPanes().mapPane;
    if (!this.imgEl) {
      this.imgEl = document.createElement("img");
      this.imgEl.className = "mask-image";
      this.imgEl.draggable = false;
      pane.appendChild(this.imgEl);
    }
    if (!this.frameEl) {
      this.frameEl = document.createElement("div");
      this.frameEl.className = "mask-overlay";
      ["top-left", "top-right", "bottom-left", "bottom-right"].forEach((pos) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `mask-handle mask-handle--${pos}`;
        btn.addEventListener("pointerdown", (e) => this.controller.startResize(e, this.map));
        this.frameEl.appendChild(btn);
      });
      const rot = document.createElement("button");
      rot.type = "button";
      rot.className = "mask-rotate-handle";
      rot.setAttribute("aria-label", "Поворот");
      rot.addEventListener("pointerdown", (e) => this.controller.startRotate(e, this.map));
      this.frameEl.appendChild(rot);
      this.frameEl.addEventListener("pointerdown", (e) => this.controller.startMove(e, this.map));
      pane.appendChild(this.frameEl);
    }
  };

  MapAttachment.prototype.render = function () {
    const s = this.controller.state;
    this.ensureDom();
    const showImg = s.imageSrc && s.isVisible && this.controller.isShownOnMap(this.map);
    const showFrame =
      showImg && s.isEditMode && this.controller.settingsOpen && this.controller.isShownOnMap(this.map);

    if (!showImg) {
      this.imgEl.style.display = "none";
      this.frameEl.style.display = "none";
      return;
    }

    const center = this.map.latLngToLayerPoint(s.center);
    const height = s.width / (s.aspectRatio || 1);
    const transform = `translate3d(${center.x - s.width / 2}px, ${center.y - height / 2}px, 0) rotate(${s.rotation}deg)`;

    this.imgEl.src = s.imageSrc;
    this.imgEl.style.display = "block";
    this.imgEl.style.width = `${s.width}px`;
    this.imgEl.style.height = `${height}px`;
    this.imgEl.style.opacity = String(s.opacity);
    this.imgEl.style.mixBlendMode = s.blendMode;
    this.imgEl.style.transform = transform;

    this.frameEl.style.display = showFrame ? "block" : "none";
    if (showFrame) {
      this.frameEl.style.width = `${s.width}px`;
      this.frameEl.style.height = `${height}px`;
      this.frameEl.style.transform = transform;
    }
  };

  MapAttachment.prototype.destroy = function () {
    this.map.off("move zoom", this._onMove);
    this.map.off("zoomend", this._onZoomEnd);
    this.imgEl?.remove();
    this.frameEl?.remove();
    this.imgEl = null;
    this.frameEl = null;
  };

  function GenplanMaskController(options) {
    this.getMap = options.getMap;
    this.getMapFs = options.getMapFs;
    this.getMeta = options.getMeta;
    this.getBuild = options.getBuild || (() => "");
    this.getEditMode = options.getEditMode || (() => false);
    this.onSaved = options.onSaved || (() => {});
    this.panel = document.getElementById("mapGenplanMaskPanel");
    this.state = null;
    this.settingsOpen = false;
    this.isFullMode = true;
    this.compactControl = null;
    this.attachments = new Map();
    this.visibleOnMaps = new Set();
    this.dragState = null;
    this.disabledHandlers = null;
    this._boundPointerMove = (e) => this.onPointerMove(e);
    this._boundPointerUp = (e) => this.onPointerUp(e);
    window.addEventListener("pointermove", this._boundPointerMove);
    window.addEventListener("pointerup", this._boundPointerUp);
    this.wirePanel();
  }

  GenplanMaskController.prototype.init = function () {
    this.reloadFromStorage();
    const map = this.getMap();
    if (map) this.attachMap(map);
    this.setSettingsOpen(false);
    this.syncUi();
  };

  GenplanMaskController.prototype.reloadFromStorage = function () {
    const map = this.getMap();
    const meta = this.getMeta();
    if (!map || !meta) return;
    this.state = loadStored(meta, map, this.getBuild());
    this.loadAspectFromImage();
    this.renderAll();
  };

  GenplanMaskController.prototype.attachMap = function (map) {
    if (!map || this.attachments.has(map)) return;
    this.attachments.set(map, new MapAttachment(map, this));
    this.renderAll();
  };

  GenplanMaskController.prototype.detachMap = function (map) {
    const a = this.attachments.get(map);
    if (a) {
      a.destroy();
      this.attachments.delete(map);
    }
    this.visibleOnMaps.delete(map);
  };

  GenplanMaskController.prototype.isShownOnMap = function (map) {
    return this.visibleOnMaps.has(map);
  };

  GenplanMaskController.prototype.setVisibleOnMap = function (map, on) {
    if (!map) return;
    if (on) this.visibleOnMaps.add(map);
    else this.visibleOnMaps.delete(map);
    this.renderAll();
  };

  GenplanMaskController.prototype.renderAll = function () {
    this.attachments.forEach((a) => a.render());
  };

  GenplanMaskController.prototype.loadAspectFromImage = function () {
    if (!this.state?.imageSrc) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalHeight > 0) {
        this.state.aspectRatio = img.naturalWidth / img.naturalHeight;
        this.renderAll();
      }
    };
    img.src = this.state.imageSrc;
  };

  GenplanMaskController.prototype.syncUi = function () {
    const s = this.state;
    if (!s) return;
    const fileEl = document.getElementById("mapGenplanMaskFile");
    if (fileEl) {
      fileEl.textContent = s.fileName
        ? `Файл: ${s.fileName}`
        : "Встроенный генплан из data/";
    }
    const opacity = document.getElementById("mapGenplanMaskOpacity");
    if (opacity) opacity.value = String(s.opacity);
    const angle = document.getElementById("mapGenplanMaskAngle");
    if (angle) angle.value = String(Math.round(s.rotation * 10) / 10);
    const blend = document.getElementById("mapGenplanMaskBlend");
    if (blend) blend.value = s.blendMode;
    this.renderAll();
  };

  GenplanMaskController.prototype.save = function () {
    const map = this.getMap();
    if (!map || !this.state) return false;
    const s = this.state;
    const payload = {
      center: { lat: s.center.lat, lng: s.center.lng },
      width: s.width,
      opacity: s.opacity,
      rotation: s.rotation,
      blendMode: s.blendMode,
      aspectRatio: s.aspectRatio,
      imageSrc: s.imageSrc?.startsWith("data:") ? s.imageSrc : null,
      imageUrl: s.imageUrl || (s.imageSrc?.startsWith("data/") ? s.imageSrc.split("?")[0] : ""),
      fileName: s.fileName,
      isVisible: s.isVisible,
      zoom: map.getZoom(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      this.onSaved();
      return true;
    } catch {
      return false;
    }
  };

  GenplanMaskController.prototype.setSettingsOpen = function (open) {
    if (open && !this.getEditMode()) {
      open = false;
    }
    this.settingsOpen = !!open;
    if (this.panel) {
      this.panel.hidden = !open;
      if (open) {
        this.isFullMode = false;
        this.panel.classList.add("mask-controls--short");
        document.getElementById("mapGenplanMaskFull")?.removeAttribute("hidden");
        document.getElementById("mapGenplanMaskShort")?.setAttribute("hidden", "");
        document.body.classList.remove("ble-map--genplan-calib-expanded");
      } else {
        this.panel.style.top = "";
        this.panel.style.left = "";
        this.panel.style.right = "";
        this.panel.style.bottom = "";
        this.panel.style.position = "";
      }
    }
    document.body.classList.toggle("ble-map--genplan-calib", open);
    if (!open) {
      document.body.classList.remove("ble-map--genplan-calib-expanded");
      if (this.state) this.state.isEditMode = false;
      this.restoreMapHandlers();
    }
    this.syncUi();
  };

  GenplanMaskController.prototype.setEditMode = function (on) {
    if (!this.state) return;
    this.state.isEditMode = !!on;
    const btn = document.getElementById("mapGenplanMaskEditBtn");
    if (btn) btn.textContent = on ? "Заблокировать" : "Редактировать";
    const lockIds = [
      "mapGenplanMaskFileInput",
      "mapGenplanMaskOpacity",
      "mapGenplanMaskAngle",
      "mapGenplanMaskBlend",
      "mapGenplanMaskResetImgBtn",
      "mapGenplanMaskResetBtn",
    ];
    lockIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = !on;
    });
    document.querySelector('label[for="mapGenplanMaskFileInput"]')?.classList.toggle("mask-controls__btn--disabled", !on);
    this.syncUi();
  };

  GenplanMaskController.prototype.setOpacity = function (v) {
    if (!this.state) return;
    this.state.opacity = Math.min(1, Math.max(0.05, Number(v) || DEFAULT_OPACITY));
    this.renderAll();
  };

  GenplanMaskController.prototype.setRotation = function (v) {
    if (!this.state) return;
    this.state.rotation = normalizeAngle(parseAngle(v));
    this.syncUi();
  };

  GenplanMaskController.prototype.setBlendMode = function (v) {
    if (!this.state || !isBlendMode(v)) return;
    this.state.blendMode = v;
    this.renderAll();
  };

  GenplanMaskController.prototype.resetSettings = function () {
    const map = this.getMap();
    const meta = this.getMeta();
    if (!map || !meta) return;
    const def = defaultState(meta, map);
    Object.assign(this.state, {
      center: def.center,
      width: def.width,
      opacity: DEFAULT_VIEW_OPACITY,
      rotation: 0,
      blendMode: "normal",
      isVisible: true,
      isEditMode: this.state.isEditMode,
      zoom: map.getZoom(),
    });
    this.syncUi();
  };

  GenplanMaskController.prototype.useDefaultImage = function () {
    const meta = this.getMeta();
    if (!meta) return;
    this.state.imageSrc = defaultImageUrl({ ...meta, build: this.getBuild() });
    this.state.imageUrl = `data/${meta.image || "ble-genplan.png"}`;
    this.state.fileName = meta.image || "ble-genplan.png";
    this.loadAspectFromImage();
    this.syncUi();
  };

  GenplanMaskController.prototype.disableMapHandlers = function (map) {
    if (this.disabledHandlers) return;
    this.disabledHandlers = {
      map,
      dragging: map.dragging.enabled(),
      doubleClickZoom: map.doubleClickZoom.enabled(),
      scrollWheelZoom: map.scrollWheelZoom.enabled(),
    };
    map.dragging.disable();
    map.doubleClickZoom.disable();
    map.scrollWheelZoom.disable();
  };

  GenplanMaskController.prototype.restoreMapHandlers = function () {
    const h = this.disabledHandlers;
    if (!h) return;
    this.disabledHandlers = null;
    if (h.dragging) h.map.dragging.enable();
    if (h.doubleClickZoom) h.map.doubleClickZoom.enable();
    if (h.scrollWheelZoom) h.map.scrollWheelZoom.enable();
  };

  GenplanMaskController.prototype.startMove = function (event, map) {
    if (!this.state?.isEditMode || !this.settingsOpen) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const was = map.dragging.enabled();
    map.dragging.disable();
    this.dragState = {
      type: "move",
      map,
      pointerId: event.pointerId,
      startCenterPoint: map.latLngToLayerPoint(this.state.center),
      startX: event.clientX,
      startY: event.clientY,
      wasMapDraggingEnabled: was,
    };
  };

  GenplanMaskController.prototype.startResize = function (event, map) {
    if (!this.state?.isEditMode || !this.settingsOpen) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const was = map.dragging.enabled();
    map.dragging.disable();
    this.dragState = {
      type: "resize",
      map,
      pointerId: event.pointerId,
      centerPoint: map.latLngToLayerPoint(this.state.center),
      wasMapDraggingEnabled: was,
    };
  };

  GenplanMaskController.prototype.startRotate = function (event, map) {
    if (!this.state?.isEditMode || !this.settingsOpen) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const was = map.dragging.enabled();
    const centerPoint = map.latLngToLayerPoint(this.state.center);
    const pointerPoint = map.mouseEventToLayerPoint(event);
    map.dragging.disable();
    this.dragState = {
      type: "rotate",
      map,
      pointerId: event.pointerId,
      centerPoint,
      startPointerAngle: getAngleFromCenter(pointerPoint, centerPoint),
      startRotation: this.state.rotation,
      wasMapDraggingEnabled: was,
    };
  };

  GenplanMaskController.prototype.onPointerMove = function (event) {
    const drag = this.dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const map = drag.map;
    const s = this.state;
    if (!s) return;

    if (drag.type === "move") {
      const next = L.point(
        drag.startCenterPoint.x + event.clientX - drag.startX,
        drag.startCenterPoint.y + event.clientY - drag.startY
      );
      s.center = map.layerPointToLatLng(next);
      this.renderAll();
      return;
    }

    const pointerPoint = map.mouseEventToLayerPoint(event);
    if (drag.type === "rotate") {
      const pointerAngle = getAngleFromCenter(pointerPoint, drag.centerPoint);
      s.rotation = normalizeAngle(drag.startRotation + (pointerAngle - drag.startPointerAngle));
      this.renderAll();
      return;
    }

    const radians = (-s.rotation * Math.PI) / 180;
    const currentX = pointerPoint.x - drag.centerPoint.x;
    const currentY = pointerPoint.y - drag.centerPoint.y;
    const localX = currentX * Math.cos(radians) - currentY * Math.sin(radians);
    const localY = currentX * Math.sin(radians) + currentY * Math.cos(radians);
    const projectedWidth = Math.abs(localX * 2);
    const projectedHeight = Math.abs(localY * 2) * (s.aspectRatio || 1);
    s.width = Math.max(MIN_WIDTH, Math.max(projectedWidth, projectedHeight));
    this.renderAll();
  };

  GenplanMaskController.prototype.onPointerUp = function (event) {
    const drag = this.dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.wasMapDraggingEnabled) drag.map.dragging.enable();
    this.dragState = null;
  };

  GenplanMaskController.prototype.wirePanel = function () {
    if (!this.panel || this.panel.dataset.wired === "1") return;
    this.panel.dataset.wired = "1";

    document.getElementById("mapGenplanMaskCompactToggle")?.addEventListener("click", () => {
      this.isFullMode = !this.isFullMode;
      this.panel.classList.toggle("mask-controls--short", !this.isFullMode);
      document.getElementById("mapGenplanMaskFull")?.toggleAttribute("hidden", !this.isFullMode);
      document.getElementById("mapGenplanMaskShort")?.toggleAttribute("hidden", this.isFullMode);
      document.body.classList.toggle("ble-map--genplan-calib-expanded", this.isFullMode);
    });

    document.getElementById("mapGenplanMaskOpacity")?.addEventListener("input", (e) => {
      this.setOpacity(e.target.value);
    });
    document.getElementById("mapGenplanMaskAngle")?.addEventListener("input", (e) => {
      this.setRotation(e.target.value);
    });
    document.getElementById("mapGenplanMaskBlend")?.addEventListener("change", (e) => {
      this.setBlendMode(e.target.value);
    });

    document.getElementById("mapGenplanMaskShowBtn")?.addEventListener("click", () => {
      if (!this.state) return;
      this.state.isVisible = !this.state.isVisible;
      const btn = document.getElementById("mapGenplanMaskShowBtn");
      if (btn) btn.textContent = this.state.isVisible ? "Скрыть" : "Показать";
      this.renderAll();
    });
    document.getElementById("mapGenplanMaskEditBtn")?.addEventListener("click", () => {
      this.setEditMode(!this.state?.isEditMode);
    });
    document.getElementById("mapGenplanMaskResetImgBtn")?.addEventListener("click", () => {
      this.useDefaultImage();
    });
    document.getElementById("mapGenplanMaskResetBtn")?.addEventListener("click", () => {
      this.resetSettings();
    });
    const fileInput = document.getElementById("mapGenplanMaskFileInput");
    fileInput?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const map = this.getMap();
        this.state.imageSrc = dataUrl;
        this.state.fileName = file.name;
        this.state.imageUrl = "";
        if (map) {
          this.state.center = map.getCenter();
          this.state.width = DEFAULT_WIDTH;
          this.state.rotation = 0;
        }
        this.state.isVisible = true;
        this.loadAspectFromImage();
        this.syncUi();
      } catch {
        this.showMsg("Не удалось загрузить файл", "err");
      }
      e.target.value = "";
    });

    const blendSelect = document.getElementById("mapGenplanMaskBlend");
    if (blendSelect && !blendSelect.options.length) {
      BLEND_MODES.forEach((mode) => {
        const opt = document.createElement("option");
        opt.value = mode;
        opt.textContent = BLEND_LABELS[mode] || mode;
        blendSelect.appendChild(opt);
      });
    }

    this.panel.addEventListener("pointerenter", () => {
      const map = this.getMap();
      if (map) this.disableMapHandlers(map);
    });
    this.panel.addEventListener("pointerleave", () => this.restoreMapHandlers());
  };

  GenplanMaskController.prototype.showMsg = function (text, kind) {
    const el = document.getElementById("mapGenplanMaskMsg");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.className = `mask-controls__msg${kind === "err" ? " mask-controls__msg--err" : ""}`;
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => {
      el.hidden = true;
    }, 3500);
  };

  global.BleGenplanMask = {
    create(options) {
      return new GenplanMaskController(options);
    },
  };
})(window);
