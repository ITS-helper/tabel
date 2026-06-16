/* Обход BLE-меток в native APK: скан → GATT-чтение → локальное сохранение → отправка на сервер. */
(() => {
  "use strict";

  const CHECKINS_KEY = "ww-ble-field-checkins-v1";
  const DAILY_KEEP_DAYS = 14;
  const NEARBY_TTL_MS = 20000;
  const LOW_BATTERY_PCT = 20;
  const GATT_READ_TIMEOUT_MS = 3000;
  const GATT_CONNECT_TIMEOUT_MS = 12000;
  const GATT_TELEMETRY_DEADLINE_MS = 12000;

  /** Стандартный Battery Service и WW-сервис (как в оригинальном APK). */
  /** fff6/fff8 в оригинале — только запись (мощность/период), не читаем. */
  const GATT_WW_READ_SUFFIXES = ["fff2", "fff3", "fff4", "fff5"];

  const ZONE_SHORT = {
    1: "Работы",
    2: "Столовая",
    3: "Опасная",
    4: "Курилка",
    5: "Отдых",
    6: "ВЖГ",
    7: "Туалет",
    8: "Остановка",
    9: "Админ",
    10: "WW",
    11: "Склад",
    12: "Мастерская",
    13: "КПП",
    14: "Стройгородок",
  };

  let deps = null;
  let scanListener = null;
  let scanActive = false;
  let scanPaused = false;
  let pendingExpanded = false;
  let lastSavedBle = null;
  let renderTimer = null;
  let focusBle = null;
  let tagPatrolMode = false;
  let connectedDeviceId = null;
  /** @type {{ deviceId: string, rssi?: number, lastSeen?: number } | null} */
  let focusConnectedDev = null;
  let connecting = false;
  let gattBusy = false;
  /** @type {Map<string, { deviceId: string, name?: string, rssi?: number, lastSeen: number, bleFromAdv?: string, isWw?: boolean }>} */
  const devices = new Map();

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function plugin() {
    return window.Capacitor?.Plugins?.BluetoothLe || null;
  }

  function normalizeMac(mac) {
    if (!mac) return "";
    return String(mac).replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  }

  function normalizeBle(num) {
    return String(num ?? "")
      .replace(/\D/g, "")
      .replace(/^0+/, "");
  }

  function localDateKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function ensureDailyPatrol(store) {
    if (!store.dailyPatrol || typeof store.dailyPatrol !== "object") {
      store.dailyPatrol = {};
    }
    return store.dailyPatrol;
  }

  function ensureDailyRouteResets(store) {
    if (!store.dailyRouteResets || typeof store.dailyRouteResets !== "object") {
      store.dailyRouteResets = {};
    }
    return store.dailyRouteResets;
  }

  function pruneOldDaily(dailyPatrol) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DAILY_KEEP_DAYS);
    const cutoffKey = localDateKey(cutoff);
    for (const k of Object.keys(dailyPatrol)) {
      if (k < cutoffKey) delete dailyPatrol[k];
    }
  }

  function pruneOldRouteResets(dailyRouteResets) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DAILY_KEEP_DAYS);
    const cutoffKey = localDateKey(cutoff);
    for (const k of Object.keys(dailyRouteResets)) {
      if (k < cutoffKey) delete dailyRouteResets[k];
    }
  }

  function backfillDailyFromCheckins(store) {
    const daily = ensureDailyPatrol(store);
    const today = localDateKey();
    if (!daily[today]) daily[today] = {};
    for (const c of store.checkins) {
      if (!c?.checkedAt || !c.routeId) continue;
      let d;
      try {
        d = new Date(c.checkedAt);
      } catch {
        continue;
      }
      if (localDateKey(d) !== today) continue;
      const rid = String(c.routeId);
      const ble = normalizeBle(c.bleNumber);
      if (!ble) continue;
      if (!daily[today][rid]) daily[today][rid] = [];
      if (!daily[today][rid].includes(ble)) daily[today][rid].push(ble);
    }
  }

  function loadStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(CHECKINS_KEY));
      if (raw && Array.isArray(raw.checkins)) {
        const today = localDateKey();
        const before = JSON.stringify(raw.dailyPatrol?.[today] || {});
        backfillDailyFromCheckins(raw);
        pruneOldDaily(ensureDailyPatrol(raw));
        pruneOldRouteResets(ensureDailyRouteResets(raw));
        const after = JSON.stringify(raw.dailyPatrol?.[today] || {});
        if (before !== after) persistStore(raw);
        return raw;
      }
    } catch {
      /* ignore */
    }
    return { version: 2, checkins: [], dailyPatrol: {} };
  }

  function persistStore(data) {
    localStorage.setItem(CHECKINS_KEY, JSON.stringify(data));
  }

  function isRouteResetToday(routeId) {
    const rid = String(routeId ?? "");
    if (!rid) return false;
    const store = loadStore();
    const resets = ensureDailyRouteResets(store);
    return !!resets[localDateKey()]?.[rid];
  }

  function resetRouteToday(routeId) {
    const rid = String(routeId ?? "");
    if (!rid) return false;
    const store = loadStore();
    const day = localDateKey();
    const resets = ensureDailyRouteResets(store);
    const daily = ensureDailyPatrol(store);
    if (!resets[day]) resets[day] = {};
    resets[day][rid] = true;
    if (!daily[day]) daily[day] = {};
    delete daily[day][rid];
    pruneOldDaily(daily);
    pruneOldRouteResets(resets);
    persistStore(store);
    return true;
  }

  function pendingCheckins() {
    return loadStore().checkins.filter((c) => !c.uploaded);
  }

  function pendingForRoute(routeId) {
    const rid = String(routeId ?? "");
    if (!rid) return 0;
    return pendingCheckins().filter((c) => String(c.routeId) === rid).length;
  }

  function getDailyDoneSet(routeId, dayKey = localDateKey()) {
    const store = loadStore();
    const daily = ensureDailyPatrol(store);
    const list = daily[dayKey]?.[String(routeId)] || [];
    return new Set(list.map((b) => normalizeBle(b)).filter(Boolean));
  }

  function recordDailyVisit(routeId, bleNumber) {
    const rid = String(routeId || "");
    const ble = normalizeBle(bleNumber);
    if (!rid || !ble) return;
    const store = loadStore();
    const daily = ensureDailyPatrol(store);
    const day = localDateKey();
    if (!daily[day]) daily[day] = {};
    if (!daily[day][rid]) daily[day][rid] = [];
    if (!daily[day][rid].includes(ble)) daily[day][rid].push(ble);
    pruneOldDaily(daily);
    persistStore(store);
  }

  function isTagDoneToday(tag) {
    const rid = String(tag?.routeId ?? getRoute().routeId ?? "");
    if (!rid) return false;
    if (!isRouteResetToday(rid) && tag?.status && tag.status !== "inspection") return true;
    return getDailyDoneSet(rid).has(normalizeBle(tag.ble));
  }

  function doneBleSetForRoute(scope, routeId) {
    const rid = String(routeId ?? "");
    const done = new Set();
    const routeReset = isRouteResetToday(rid);
    if (!routeReset) {
      for (const pt of scope) {
        if (pt?.status && pt.status !== "inspection") {
          done.add(normalizeBle(pt.ble));
        }
      }
    }
    for (const ble of getDailyDoneSet(rid)) {
      if (scope.some((pt) => normalizeBle(pt.ble) === ble)) done.add(ble);
    }
    return done;
  }

  function patrolStatsForRoute(routeId, totalOverride) {
    const rid = String(routeId ?? "");
    if (!rid) return null;
    const scope = getScopeMarkers();
    const api = deps?.getRouteProgress?.(rid);
    const routeReset = isRouteResetToday(rid);
    const total =
      api?.total != null && api.total > 0
        ? Number(api.total)
        : totalOverride != null
          ? Number(totalOverride)
          : scope.length;
    if (!total) return null;
    const doneSet = doneBleSetForRoute(scope, rid);
    let done = doneSet.size;
    if (!routeReset && api?.done != null) {
      const apiDone = Number(api.done);
      if (Number.isFinite(apiDone)) done = Math.max(done, apiDone);
    }
    return {
      routeId: rid,
      day: localDateKey(),
      done,
      total,
      left: Math.max(0, total - done),
      pendingUpload: pendingForRoute(rid),
    };
  }

  function allRoutesDailySummary() {
    const scope = getScopeMarkers();
    const doneSet = new Set();
    for (const pt of scope) {
      if (pt?.status && pt.status !== "inspection") {
        doneSet.add(normalizeBle(pt.ble));
      }
    }
    const store = loadStore();
    const daily = ensureDailyPatrol(store);
    const today = localDateKey();
    const routes = daily[today] || {};
    for (const bles of Object.values(routes)) {
      if (!Array.isArray(bles)) continue;
      for (const ble of bles) doneSet.add(normalizeBle(ble));
    }
    if (!doneSet.size) return null;
    return { day: today, done: doneSet.size, pendingUpload: pendingCheckins().length };
  }

  function isTagSavedPending(tag) {
    const ble = normalizeBle(tag?.ble);
    const routeId = String(tag?.routeId ?? "");
    return pendingCheckins().some(
      (c) => normalizeBle(c.bleNumber) === ble && String(c.routeId) === routeId && !c.uploaded
    );
  }

  function isTagHiddenFromNearby(tag) {
    if (isTagSavedPending(tag)) return true;
    if (!getRoute().routeId) return false;
    return isTagDoneToday(tag);
  }

  function dataViewToNumbers(dv) {
    if (!dv) return [];
    if (Array.isArray(dv)) return dv.map((n) => Number(n) & 0xff);
    if (dv instanceof DataView) {
      const out = [];
      for (let i = 0; i < dv.byteLength; i++) out.push(dv.getUint8(i));
      return out;
    }
    if (typeof dv === "object" && dv.buffer) return dataViewToNumbers(new DataView(dv.buffer));
    return [];
  }

  function isWwAdvertisement(result) {
    const md = result?.manufacturerData;
    if (md && typeof md === "object") {
      for (const val of Object.values(md)) {
        const nums = dataViewToNumbers(val);
        for (let i = 0; i <= nums.length - 4; i++) {
          if (nums[i] === 0xa5 && nums[i + 1] === 8 && nums[i + 2] === 0 && nums[i + 3] === 1) {
            return true;
          }
        }
      }
    }
    const uuids = result?.uuids || result?.serviceUuids || result?.device?.uuids || [];
    return uuids.some((u) => String(u).toLowerCase().includes("fff0"));
  }

  function bleFromManufacturerData(result) {
    const md = result?.manufacturerData;
    if (!md || typeof md !== "object") return "";
    for (const val of Object.values(md)) {
      const nums = dataViewToNumbers(val);
      for (let i = 0; i <= nums.length - 6; i++) {
        if (nums[i] === 0xa5 && nums[i + 1] === 8 && nums[i + 2] === 0 && nums[i + 3] === 1) {
          const le16 = nums[i + 4] + (nums[i + 5] << 8);
          if (le16 > 0) return normalizeBle(String(le16));
          const le16be = (nums[i + 4] << 8) + nums[i + 5];
          if (le16be > 0) return normalizeBle(String(le16be));
        }
      }
    }
    return "";
  }

  function bleFromDeviceName(name) {
    if (!name) return "";
    const s = String(name);
    const m = s.match(/(?:WW[-_\s]?)?(\d{3,6})/i) || s.match(/(\d{3,6})/);
    return m ? normalizeBle(m[1]) : "";
  }

  function getRoute() {
    return deps?.getRoute?.() || { routeId: "", routeTitle: "Все маршруты" };
  }

  function getScopeMarkers() {
    return deps?.getRouteMarkers?.() || [];
  }

  function tagMacKeys(tag) {
    const keys = [];
    const mac = normalizeMac(tag?.mac);
    const chip = normalizeMac(tag?.chipUuid);
    if (mac) keys.push(mac);
    if (chip && chip !== mac) keys.push(chip);
    return keys;
  }

  function resolveTagForDevice(dev, scopeMarkers) {
    const devMac = normalizeMac(dev.deviceId);
    if (devMac) {
      for (const tag of scopeMarkers) {
        if (tagMacKeys(tag).includes(devMac)) return tag;
      }
    }
    const bleHints = [dev.bleFromAdv, bleFromDeviceName(dev.name)].filter(Boolean);
    for (const b of bleHints) {
      const tag = scopeMarkers.find((t) => normalizeBle(t.ble) === b);
      if (tag) return tag;
      const found = deps?.findTag?.(b);
      if (found && scopeMarkers.some((t) => normalizeBle(t.ble) === normalizeBle(found.ble))) {
        return found;
      }
    }
    return null;
  }

  function zoneTypeNum(tag) {
    if (tag?.bleTypeNum != null) return Number(tag.bleTypeNum) || 0;
    const m = String(tag?.bleType || "").match(/^(\d+)/);
    return m ? Number(m[1]) : 0;
  }

  function zoneShortLabel(tag) {
    const n = zoneTypeNum(tag);
    return ZONE_SHORT[n] || (n ? `Тип ${n}` : "");
  }

  function zoneRowClass(tag) {
    const n = zoneTypeNum(tag);
    if (n === 1) return "ble-field-nearby--z1";
    if (n === 2) return "ble-field-nearby--z2";
    if (n === 4) return "ble-field-nearby--z4";
    if (n === 5) return "ble-field-nearby--z5";
    if (n === 7) return "ble-field-nearby--z7";
    if (n === 12) return "ble-field-nearby--z12";
    if (n > 0) return "ble-field-nearby--z-other";
    return "";
  }

  function tagByBle(bleNum) {
    return (
      getScopeMarkers().find((t) => normalizeBle(t.ble) === normalizeBle(bleNum)) ||
      deps?.findTag?.(bleNum) ||
      null
    );
  }

  function chargeNum(tag) {
    if (tag?.charge == null || tag.charge === "") return null;
    const n = Math.round(Number(tag.charge));
    return Number.isFinite(n) ? n : null;
  }

  function chargeNumValue(n) {
    if (n == null || n === "") return null;
    const v = Math.round(Number(n));
    return Number.isFinite(v) ? v : null;
  }

  function isLowBatteryCharge(charge) {
    const n = chargeNumValue(charge);
    return n != null && n < LOW_BATTERY_PCT;
  }

  function isLowBattery(tag) {
    return isLowBatteryCharge(chargeNum(tag));
  }

  function photosForPatrol(tag) {
    const list = [];
    if (tag?.photoPlace) list.push({ label: "Место", url: tag.photoPlace });
    if (tag?.photoTag) list.push({ label: "Метка", url: tag.photoTag });
    return list;
  }

  function tagHasPhotos(tag) {
    return photosForPatrol(tag).length > 0;
  }

  function patrolProgress() {
    const route = getRoute();
    if (!route.routeId) return null;
    return patrolStatsForRoute(route.routeId);
  }

  function formatTodayLabel() {
    return new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  }

  function renderProgress() {
    const el = $("bleFieldProgress");
    if (!el) return;
    const prog = patrolProgress();
    if (!prog) {
      const summary = allRoutesDailySummary();
      const pendingN = pendingCheckins().length;
      if (summary || pendingN) {
        el.hidden = false;
        const parts = [];
        if (summary) {
          parts.push(
            `${formatTodayLabel()}: пройдено <strong>${summary.done}</strong> меток`
          );
        }
        if (pendingN) {
          parts.push(`к отправке <strong>${pendingN}</strong>`);
        }
        el.innerHTML = parts.join(" · ");
      } else {
        el.hidden = true;
        el.innerHTML = "";
      }
      return;
    }
    el.hidden = false;
    const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
    const pendingLine = prog.pendingUpload
      ? `<div class="ble-field-progress__pending">К отправке: ${prog.pendingUpload}</div>`
      : "";
    el.innerHTML = `<div class="ble-field-progress__row">
      <span class="ble-field-progress__stat">Пройдено · <strong>${prog.done}</strong> / ${prog.total}</span>
      <span class="ble-field-progress__left">осталось ${prog.left}</span>
    </div>
    <div class="ble-field-progress__bar" role="progressbar" aria-valuenow="${prog.done}" aria-valuemin="0" aria-valuemax="${prog.total}">
      <span class="ble-field-progress__fill" style="width:${pct}%"></span>
    </div>${pendingLine}`;
  }

  function renderResetRouteAction() {
    const btn = $("bleFieldResetRouteBtn");
    if (!btn) return;
    const route = getRoute();
    const visible = !!route.routeId;
    btn.hidden = !visible;
    if (!visible) return;
    const active = isRouteResetToday(route.routeId);
    btn.textContent = active ? "Маршрут обнулён" : "Обнулить маршрут";
    btn.classList.toggle("is-active", active);
    btn.title = active
      ? "Локально считаем только новые обходы этого маршрута за сегодня"
      : "Снова показать все метки маршрута как требующие обхода только на этом устройстве";
  }

  function nearbyActionsHtml(tag) {
    const sendBtn = `<button type="button" class="ble-field-nearby__save" data-save-ble="${esc(tag.ble)}"${gattBusy ? " disabled" : ""}>Отправить</button>`;
    if (deps?.isNative?.()) {
      return `<div class="ble-field-nearby__actions">${sendBtn}</div>`;
    }
    const photoBtn = tagHasPhotos(tag)
      ? `<button type="button" class="ble-field-nearby__photo" data-photo-ble="${esc(tag.ble)}" title="Фото места и метки">Фото</button>`
      : `<button type="button" class="ble-field-nearby__photo ble-field-nearby__photo--disabled" disabled title="Нет фото — скачайте фото маршрута">Фото</button>`;
    return `<div class="ble-field-nearby__actions">${photoBtn}${sendBtn}</div>`;
  }

  function bindNearbyRowActions(list) {
    if (!list) return;
    list.querySelectorAll("[data-save-ble]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        triggerSendButtonFeedback(btn);
        void saveCheckinForBle(btn.dataset.saveBle).catch((err) =>
          setStatus(String(err?.message || err).slice(0, 160), "error")
        );
      });
    });
    list.querySelectorAll("[data-photo-ble]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        void openPhotosForBle(btn.dataset.photoBle);
      });
    });
  }

  async function openPhotosForBle(bleNum) {
    const tag = tagByBle(bleNum);
    const modal = $("bleFieldPhotoModal");
    const body = $("bleFieldPhotoBody");
    const title = $("bleFieldPhotoTitle");
    if (!modal || !body) return;
    if (!tag) {
      setStatus("Метка не найдена", "error");
      return;
    }
    const photos = photosForPatrol(tag);
    if (title) title.textContent = `Метка #${tag.ble}`;
    if (!photos.length) {
      body.innerHTML = `<p class="ble-field-photo-modal__empty">${esc(deps?.photoHint?.(tag) || "Нет фото. Перед выходом: «Скачать фото» для маршрута.")}</p>`;
    } else {
      body.innerHTML = photos
        .map(
          (p) => `<figure class="ble-field-photo-modal__fig">
            <figcaption>${esc(p.label)}</figcaption>
            <img class="ble-field-photo-modal__img" data-photo-url="${esc(p.url)}" alt="${esc(p.label)}" loading="eager" decoding="async" referrerpolicy="no-referrer" />
          </figure>`
        )
        .join("");
      for (const img of body.querySelectorAll("img[data-photo-url]")) {
        const url = img.dataset.photoUrl;
        const cached = deps?.photoSrc?.(url);
        if (cached) img.src = cached;
        const loaded = await deps?.loadPhoto?.(img, url);
        if (!loaded && !img.src && url) {
          img.src = url;
          img.addEventListener(
            "error",
            () => {
              const proxy = deps?.photoProxy?.(url);
              if (proxy && img.dataset.tried !== "proxy") {
                img.dataset.tried = "proxy";
                img.src = proxy;
              } else {
                img.classList.add("ble-field-photo-modal__img--missing");
                img.alt = "Фото недоступно";
              }
            },
            { once: true }
          );
        }
      }
    }
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }

  function closePhotoModal() {
    const modal = $("bleFieldPhotoModal");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    const body = $("bleFieldPhotoBody");
    if (body) body.innerHTML = "";
  }

  function formatCharge(tag) {
    const c = tag?.charge;
    if (c == null || c === "") return "—";
    const n = Math.round(Number(c));
    return Number.isFinite(n) ? `${n}%` : "—";
  }

  function deviceInNearbyWindow(dev) {
    if (scanPaused) return true;
    return Date.now() - dev.lastSeen <= NEARBY_TTL_MS;
  }

  function findDeviceForTag(tag, opts = {}) {
    if (!tag) return null;
    const ignoreTtl = opts.ignoreTtl ?? scanPaused;
    for (const d of devices.values()) {
      if (!ignoreTtl && Date.now() - d.lastSeen > NEARBY_TTL_MS) continue;
      const t = resolveTagForDevice(d, [tag]);
      if (t && normalizeBle(t.ble) === normalizeBle(tag.ble)) return d;
    }
    return null;
  }

  function updateScanButton() {
    const btn = $("bleFieldScanBtn");
    if (!btn) return;
    if (scanActive) btn.textContent = "Пауза";
    else if (scanPaused) btn.textContent = "Продолжить";
    else btn.textContent = "Сканировать";
  }

  function buildNearbyRows() {
    const scope = getScopeMarkers();
    const byBle = new Map();
    for (const dev of devices.values()) {
      if (!deviceInNearbyWindow(dev)) continue;
      const tag = resolveTagForDevice(dev, scope);
      if (!tag) continue;
      const key = normalizeBle(tag.ble);
      const prev = byBle.get(key);
      if (!prev || (dev.rssi ?? -999) > (prev.dev.rssi ?? -999)) {
        byBle.set(key, { tag, dev, saved: isTagHiddenFromNearby(tag) });
      }
    }
    let rows = [...byBle.values()];
    rows.sort((a, b) => (b.dev.rssi ?? -999) - (a.dev.rssi ?? -999));
    if (focusBle) {
      const fb = normalizeBle(focusBle);
      rows.sort((a, b) => {
        const af = normalizeBle(a.tag.ble) === fb ? 1 : 0;
        const bf = normalizeBle(b.tag.ble) === fb ? 1 : 0;
        return bf - af;
      });
    }
    return rows;
  }

  function nearbyVisibleTags() {
    return buildNearbyRows().filter((r) => !r.saved);
  }

  function countLiveDevices() {
    let n = 0;
    for (const d of devices.values()) {
      if (deviceInNearbyWindow(d)) n++;
    }
    return n;
  }

  function acceptScanResult(result) {
    if (isWwAdvertisement(result)) return true;
    const mac = normalizeMac(result?.device?.deviceId);
    if (mac) {
      for (const tag of getScopeMarkers()) {
        if (tagMacKeys(tag).includes(mac)) return true;
      }
    }
    const ble = bleFromManufacturerData(result) || bleFromDeviceName(result?.device?.name || result?.localName);
    if (ble && deps?.findTag?.(ble)) return true;
    return false;
  }

  function setStatus(text, kind) {
    const el = $("bleFieldStatus");
    if (!el) return;
    el.textContent = text || "";
    el.className = "ble-field-status" + (kind ? ` ble-field-status--${kind}` : "");
  }

  function updateToolbarBadge() {
    const btn = $("mapBleFieldBtn");
    if (!btn) return;
    const n = pendingCheckins().length;
    let badge = btn.querySelector(".ble-field-toolbar-badge");
    if (!n) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "ble-field-toolbar-badge";
      btn.appendChild(badge);
    }
    badge.textContent = String(n);
    badge.title = `${n} обходов не отправлено`;
  }

  function syncPatrolSearchInput() {
    const input = $("bleFieldSearchInput");
    const clearBtn = $("bleFieldSearchClear");
    if (!input) return;
    const val = focusBle ? String(focusBle) : "";
    if (document.activeElement !== input) input.value = val;
    if (clearBtn) clearBtn.hidden = !input.value.trim();
  }

  function clearPatrolSearch() {
    const input = $("bleFieldSearchInput");
    const clearBtn = $("bleFieldSearchClear");
    if (input) input.value = "";
    if (clearBtn) clearBtn.hidden = true;
  }

  function resolvePatrolTagByQuery(raw) {
    const q = normalizeBle(raw);
    if (!q) return { tag: null, reason: "empty" };
    const route = getRoute();
    let tag = getScopeMarkers().find((t) => normalizeBle(t.ble) === q) || null;
    if (!tag) tag = deps?.findTag?.(q) || null;
    if (!tag) return { tag: null, reason: "not_found" };
    if (route.routeId && String(tag.routeId ?? "") !== String(route.routeId)) {
      return { tag, reason: "wrong_route" };
    }
    return { tag, reason: null };
  }

  async function searchPatrolTag() {
    const input = $("bleFieldSearchInput");
    const raw = input?.value?.trim() || "";
    const { tag, reason } = resolvePatrolTagByQuery(raw);
    if (reason === "empty") {
      setStatus("Введите номер метки", "error");
      input?.focus();
      return;
    }
    if (reason === "not_found") {
      const route = getRoute();
      setStatus(
        route.routeId
          ? `Метка #${raw} не найдена на маршруте «${route.routeTitle}»`
          : `Метка #${raw} не найдена в данных карты`,
        "error"
      );
      input?.focus();
      input?.select();
      return;
    }
    if (reason === "wrong_route") {
      setStatus(
        `Метка #${tag.ble} на другом маршруте${tag.routeTitle ? `: «${tag.routeTitle}»` : ""}`,
        "error"
      );
      input?.focus();
      input?.select();
      return;
    }
    if (isTagDoneToday(tag)) {
      setStatus(`Метка #${tag.ble} уже пройдена — можно пройти повторно`, "warn");
    }
    if (input) input.value = String(tag.ble);
    syncPatrolSearchInput();
    await openTagPatrol(tag);
  }

  function hapticTap(ms = 28) {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* ignore */
    }
  }

  function hapticSaved() {
    try {
      navigator.vibrate?.([22, 36, 28]);
    } catch {
      /* ignore */
    }
  }

  function triggerSendButtonFeedback(btn) {
    hapticTap(28);
    if (!btn) return;
    btn.classList.add("ble-field-nearby__save--press");
    window.setTimeout(() => btn.classList.remove("ble-field-nearby__save--press"), 360);
  }

  function pulsePendingSection() {
    const section = $("bleFieldPendingSection");
    if (!section) return;
    section.classList.remove("ble-field-section--highlight");
    void section.offsetWidth;
    section.classList.add("ble-field-section--highlight");
    window.setTimeout(() => section.classList.remove("ble-field-section--highlight"), 1200);
  }

  function renderPanelHeader() {
    const titleEl = $("bleFieldPanelTitle");
    const routeEl = $("bleFieldPanelRoute");
    const sepEl = $("bleFieldPanelRouteSep");
    if (!titleEl) return;
    const route = getRoute();
    if (tagPatrolMode && focusBle) {
      titleEl.textContent = `Обход · #${focusBle}`;
      if (routeEl) {
        if (route.routeId) {
          routeEl.textContent = route.routeTitle;
          if (sepEl) sepEl.hidden = false;
        } else {
          routeEl.textContent = "";
          if (sepEl) sepEl.hidden = true;
        }
      }
      return;
    }
    titleEl.textContent = "Обход маршрута";
    if (routeEl) {
      if (route.routeId) {
        routeEl.textContent = route.routeTitle;
        if (sepEl) sepEl.hidden = false;
      } else {
        routeEl.textContent = "все маршруты";
        if (sepEl) sepEl.hidden = false;
      }
    }
  }

  function renderNearbyList() {
    const list = $("bleFieldNearbyList");
    if (!list) return;
    if (!scanActive && !scanPaused) {
      list.innerHTML =
        '<li class="ble-field-nearby ble-field-nearby--empty">Нажмите «Сканировать» и подойдите к метке.</li>';
      return;
    }
    const rows = nearbyVisibleTags();
    const live = countLiveDevices();
    if (!rows.length) {
      const scopeN = getScopeMarkers().length;
      const matched = buildNearbyRows();
      const savedNearby = matched.filter((r) => r.saved).length;
      if (savedNearby > 0 && live > 0) {
        list.innerHTML =
          '<li class="ble-field-nearby ble-field-nearby--empty">Видимые метки уже пройдены — идите к следующей.</li>';
      } else if (scanPaused) {
        list.innerHTML =
          '<li class="ble-field-nearby ble-field-nearby--empty">Список пуст. Нажмите «Продолжить» и поднесите телефон к метке.</li>';
      } else {
        list.innerHTML = `<li class="ble-field-nearby ble-field-nearby--empty">BLE в эфире: ${live}. Сопоставленных меток нет — поднесите телефон ближе${scopeN ? ` (в базе ${scopeN} меток)` : ""}.</li>`;
      }
      return;
    }
    list.innerHTML = rows
      .map(({ tag, dev }) => {
        const focus =
          focusBle && normalizeBle(tag.ble) === normalizeBle(focusBle)
            ? " ble-field-nearby--focus"
            : "";
        const zoneCls = zoneRowClass(tag);
        const zoneLbl = zoneShortLabel(tag);
        const title = tag.name || tag.locationDesc || "";
        const routeHint =
          !getRoute().routeId && tag.routeTitle
            ? `<span class="ble-field-nearby__route">${esc(tag.routeTitle)}</span>`
            : "";
        const charge = dev.advTelemetry?.chargeValue != null
          ? `${dev.advTelemetry.chargeValue}%`
          : formatCharge(tag);
        const chargeLow = isLowBattery(tag) ? " ble-field-nearby__meta--low" : "";
        return `<li class="ble-field-nearby${zoneCls ? ` ${zoneCls}` : ""}${focus}" data-nearby-ble="${esc(tag.ble)}">
          <div class="ble-field-nearby__main">
            <span class="ble-field-nearby__head">
              <span class="ble-field-nearby__num">#${esc(tag.ble)}</span>
              ${zoneLbl ? `<span class="ble-field-nearby__zone">${esc(zoneLbl)}</span>` : ""}
            </span>
            ${title ? `<span class="ble-field-nearby__title">${esc(title)}</span>` : ""}
            ${routeHint}
            <span class="ble-field-nearby__meta${chargeLow}">${dev.rssi ?? "—"} dBm · ${esc(charge)}</span>
          </div>
          ${nearbyActionsHtml(tag)}
        </li>`;
      })
      .join("");
    bindNearbyRowActions(list);
    if (scanActive) {
      const route = getRoute();
      const scope = route.routeId ? `маршрута` : "базы";
      setStatus(`Сканирование… BLE: ${live}, меток ${scope}: ${rows.length}`, "busy");
    } else if (scanPaused) {
      setStatus(`Пауза — ${rows.length} меток в списке. Можно подключиться и отправить обход.`, "info");
    }
  }

  function renderPendingBlock() {
    const pending = pendingCheckins();
    const countEl = $("bleFieldPendingCount");
    if (countEl) countEl.textContent = String(pending.length);
    const section = $("bleFieldPendingSection");
    const toggle = $("bleFieldPendingToggle");
    const hint = $("bleFieldPendingHint");
    const body = $("bleFieldPendingBody");
    const list = $("bleFieldPendingList");
    if (section) {
      section.classList.toggle("ble-field-section--pending-open", pendingExpanded && pending.length > 0);
      section.classList.toggle("ble-field-section--pending-empty", !pending.length);
    }
    if (toggle) {
      toggle.disabled = !pending.length;
      toggle.setAttribute("aria-expanded", pending.length && pendingExpanded ? "true" : "false");
    }
    if (hint) {
      if (!pending.length) {
        hint.textContent = "";
      } else if (!pendingExpanded && pending.length > 1) {
        hint.textContent = `+ ещё ${pending.length - 1}`;
      } else {
        hint.textContent = "";
      }
    }
    if (body) body.classList.toggle("ble-field-pending__body--open", pendingExpanded && pending.length > 0);
    if (list) {
      if (!pending.length) {
        list.innerHTML = '<li class="ble-field-pending ble-field-pending--empty">Пока нет сохранённых обходов</li>';
      } else {
        list.innerHTML = pending
          .slice()
          .sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt)))
          .map((c) => {
            const when = c.checkedAt ? new Date(c.checkedAt).toLocaleString("ru-RU") : "";
            const tag = tagByBle(c.bleNumber);
            const isNew = lastSavedBle && normalizeBle(c.bleNumber) === normalizeBle(lastSavedBle);
            const photoBtn =
              !deps?.isNative?.() && tagHasPhotos(tag)
                ? `<button type="button" class="ble-field-pending__photo" data-photo-ble="${esc(c.bleNumber)}">Фото</button>`
                : "";
            return `<li class="ble-field-pending${isNew ? " ble-field-pending--new" : ""}">
              <div class="ble-field-pending__main">
                <span class="ble-field-pending__num">#${esc(c.bleNumber)}</span>
                <span class="ble-field-pending__meta">${esc(c.routeTitle || "")}${when ? ` · ${esc(when)}` : ""}</span>
              </div>
              ${photoBtn}
            </li>`;
          })
          .join("");
        bindNearbyRowActions(list);
      }
    }
    if (lastSavedBle) {
      window.setTimeout(() => {
        lastSavedBle = null;
      }, 700);
    }
    const uploadBtn = $("bleFieldUploadBtn");
    if (uploadBtn) {
      uploadBtn.disabled = !pending.length || !navigator.onLine;
      uploadBtn.textContent =
        pending.length && !navigator.onLine
          ? `Отправить на сервер (${pending.length}) — нужен интернет`
          : pending.length
            ? `Отправить на сервер (${pending.length})`
            : "Отправить на сервер";
    }
    updateToolbarBadge();
  }

  function renderAll() {
    updatePatrolLayout();
    renderTagPatrolBlock();
    syncPatrolSearchInput();
    renderPanelHeader();
    renderResetRouteAction();
    renderProgress();
    renderNearbyList();
    renderPendingBlock();
    deps?.onPatrolChanged?.();
  }

  function updatePatrolLayout() {
    const panel = $("bleFieldPanel");
    if (panel) panel.classList.toggle("ble-field-panel--tag-focus", tagPatrolMode);
  }

  function renderTagPatrolBlock() {
    const section = $("bleFieldTagPatrol");
    if (!section) return;
    if (!tagPatrolMode || !focusBle) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    const tag = tagByBle(focusBle);
    const titleEl = $("bleFieldFocusTitle");
    const statusEl = $("bleFieldFocusConn");
    const saveBtn = $("bleFieldFocusSaveBtn");
    const connectBtn = $("bleFieldFocusConnectBtn");
    if (titleEl) {
      const zone = tag ? zoneShortLabel(tag) : "";
      titleEl.textContent = zone ? `Метка #${focusBle} · ${zone}` : `Метка #${focusBle}`;
    }
    let connText = scanActive
      ? "Сканирование… поднесите телефон к метке"
      : scanPaused
        ? "Пауза — можно подключиться к метке из списка"
        : "Запуск сканирования…";
    let connCls = "ble-field-focus__conn";
    if (connecting) {
      connText = "Подключение по Bluetooth…";
      connCls += " ble-field-focus__conn--busy";
    } else if (gattBusy) {
      connText = "Читаем данные с метки…";
      connCls += " ble-field-focus__conn--busy";
    } else if (connectedDeviceId) {
      connText = "Метка подключена — можно отправить обход";
      connCls += " ble-field-focus__conn--ok";
    }
    if (statusEl) {
      statusEl.textContent = connText;
      statusEl.className = connCls;
    }
    if (saveBtn) saveBtn.disabled = !connectedDeviceId || connecting || gattBusy;
    if (connectBtn) {
      const canConnect =
        tagPatrolMode &&
        focusBle &&
        !connectedDeviceId &&
        !connecting &&
        !gattBusy &&
        Boolean(findDeviceForTag(tag, { ignoreTtl: true }));
      connectBtn.hidden = !canConnect;
      connectBtn.disabled = !canConnect;
    }
  }

  function uuidSuffix(uuid) {
    const s = String(uuid || "")
      .toLowerCase()
      .replace(/-/g, "");
    return s.length >= 8 ? s.slice(4, 8) : s;
  }

  function fullBleUuid(suffix4) {
    const s = String(suffix4 || "")
      .toLowerCase()
      .replace(/[^0-9a-f]/g, "")
      .slice(-4);
    return `0000${s}-0000-1000-8000-00805f9b34fb`;
  }

  function bytesFromReadResult(result) {
    if (!result?.value) return [];
    const v = result.value;
    if (typeof v === "string") {
      const hex = v.replace(/[^0-9a-fA-F]/g, "");
      const out = [];
      for (let i = 0; i + 1 < hex.length; i += 2) {
        out.push(parseInt(hex.slice(i, i + 2), 16));
      }
      return out;
    }
    return dataViewToNumbers(v);
  }

  function parseWwAdvTelemetry(result) {
    const md = result?.manufacturerData;
    if (!md || typeof md !== "object") return null;
    for (const val of Object.values(md)) {
      const nums = dataViewToNumbers(val);
      for (let i = 0; i <= nums.length - 6; i++) {
        if (nums[i] === 0xa5 && nums[i + 1] === 8 && nums[i + 2] === 0 && nums[i + 3] === 1) {
          const out = {};
          if (nums.length > i + 6 && nums[i + 6] <= 100) out.chargeValue = nums[i + 6];
          if (nums.length > i + 7 && nums[i + 7] >= 1 && nums[i + 7] <= 20) out.bleType = nums[i + 7];
          if (nums.length > i + 8 && nums[i + 8] <= 10) out.power = nums[i + 8];
          if (Object.keys(out).length) return out;
        }
      }
    }
    return null;
  }

  function findCharInServices(services, serviceSuffix, charSuffix) {
    if (!services?.length) return null;
    for (const svc of services) {
      if (uuidSuffix(svc.uuid) !== serviceSuffix) continue;
      for (const ch of svc.characteristics || []) {
        if (uuidSuffix(ch.uuid) !== charSuffix) continue;
        if (ch.properties?.read === false) continue;
        return { service: svc.uuid, characteristic: ch.uuid };
      }
    }
    return null;
  }

  function applyByteCandidates(out, suffix, bytes) {
    if (!bytes?.length) return;
    const b0 = bytes[0] & 0xff;
    if (out.chargeValue == null && b0 <= 100 && (suffix === "2a19" || suffix === "fff2" || suffix === "fff3" || bytes.length === 1)) {
      out.chargeValue = b0;
    }
    if (out.power == null && b0 <= 10 && (suffix === "fff6" || suffix === "fff5")) {
      out.power = b0;
    }
    if (out.frequency == null && b0 <= 20 && suffix === "fff8") {
      out.frequency = b0;
    }
    if (out.bleType == null && b0 >= 1 && b0 <= 20 && suffix !== "fff6" && suffix !== "fff8" && suffix !== "2a19") {
      out.bleType = b0;
    }
  }

  async function readGattBytes(p, deviceId, service, characteristic, timeoutMs = GATT_READ_TIMEOUT_MS) {
    const result = await p.read({
      deviceId,
      service,
      characteristic,
      timeout: timeoutMs,
    });
    return bytesFromReadResult(result);
  }

  function gattReadTimeoutLeft(deadlineMs) {
    return Math.max(400, Math.min(GATT_READ_TIMEOUT_MS, deadlineMs - Date.now()));
  }

  /** Чтение заряда и типа с метки — последовательно, только известные UUID (как NativeBleService). */
  async function readTagGattTelemetry(deviceId, tag, scanHint) {
    const p = plugin();
    if (!p) throw new Error("BluetoothLe plugin недоступен");
    const deadlineMs = Date.now() + GATT_TELEMETRY_DEADLINE_MS;
    const out = {
      chargeValue: null,
      power: null,
      frequency: null,
      bleType: null,
      rssi: scanHint?.rssi ?? null,
      fromGatt: false,
      debug: { services: 0, reads: [] },
    };

    const recordRead = (suffix, bytes) => {
      if (!bytes?.length) return;
      out.debug.reads.push({
        suffix,
        hex: bytes.map((b) => b.toString(16).padStart(2, "0")).join(""),
      });
      applyByteCandidates(out, suffix, bytes);
    };

    await new Promise((r) => setTimeout(r, 350));

    if (Date.now() < deadlineMs) {
      try {
        const rssiRes = await p.readRssi({
          deviceId,
          timeout: gattReadTimeoutLeft(deadlineMs),
        });
        if (rssiRes?.value != null) out.rssi = rssiRes.value;
      } catch {
        /* ignore */
      }
    }

    let services = [];
    try {
      const res = await p.getServices({ deviceId });
      services = res?.services || [];
      out.debug.services = services.length;
    } catch (e) {
      console.warn("[ble-field] getServices", e?.message || e);
    }

    const seen = new Set();
    const readOne = async (serviceSuffix, charSuffix) => {
      if (Date.now() >= deadlineMs) return;
      const key = `${serviceSuffix}:${charSuffix}`;
      if (seen.has(key)) return;
      seen.add(key);
      const timeoutMs = gattReadTimeoutLeft(deadlineMs);
      const hit = findCharInServices(services, serviceSuffix, charSuffix);
      const service = hit?.service || fullBleUuid(serviceSuffix);
      const characteristic = hit?.characteristic || fullBleUuid(charSuffix);
      try {
        const bytes = await readGattBytes(p, deviceId, service, characteristic, timeoutMs);
        recordRead(charSuffix, bytes);
      } catch (e) {
        console.warn("[ble-field] GATT read", charSuffix, e?.message || e);
      }
    };

    await readOne("180f", "2a19");
    for (const suffix of GATT_WW_READ_SUFFIXES) {
      await readOne("fff0", suffix);
    }

    if (out.chargeValue != null && out.chargeValue > 100) out.chargeValue = null;

    const adv = scanHint?.advTelemetry;
    if (adv) {
      if (out.chargeValue == null && adv.chargeValue != null) out.chargeValue = adv.chargeValue;
      if (out.power == null && adv.power != null) out.power = adv.power;
      if (out.bleType == null && adv.bleType != null) out.bleType = adv.bleType;
    }

    out.fromGatt =
      out.debug.reads.length > 0 ||
      out.chargeValue != null ||
      out.power != null ||
      out.bleType != null ||
      out.frequency != null;

    if (!out.fromGatt) {
      console.warn("[ble-field] GATT: no telemetry", tag?.ble || deviceId, out.debug);
    } else {
      console.info("[ble-field] GATT telemetry", tag?.ble || deviceId, out);
    }

    return out;
  }

  async function pauseScanForGatt() {
    stopRenderTimer();
    const p = plugin();
    if (!scanActive || !p) return;
    try {
      await p.stopLEScan();
    } catch {
      /* ignore */
    }
    scanActive = false;
  }

  async function resumeScanForGatt() {
    const p = plugin();
    if (scanActive || scanPaused || !scanListener || !p) return;
    try {
      await p.requestLEScan({ allowDuplicates: true });
      scanActive = true;
      startRenderTimer();
      updateScanButton();
    } catch (e) {
      console.warn("[ble-field] resume scan", e?.message || e);
    }
  }

  async function withGattSession(deviceId, fn) {
    const wasScanning = scanActive;
    gattBusy = true;
    renderTagPatrolBlock();
    try {
      await pauseScanForGatt();
      await connectToDevice(deviceId);
      return await fn();
    } finally {
      await disconnectDevice();
      if (wasScanning) await resumeScanForGatt();
      gattBusy = false;
      renderTagPatrolBlock();
    }
  }

  function scrollToPendingSection() {
    const section = document.querySelector(".ble-field-section--pending");
    if (!section) return;
    section.classList.add("ble-field-section--highlight");
    section.scrollIntoView({ behavior: "smooth", block: "nearest" });
    window.setTimeout(() => section.classList.remove("ble-field-section--highlight"), 1400);
  }

  function saveCheckinRecord(tag, dev, live) {
    const route = getRoute();
    const routeId = route.routeId ? String(route.routeId) : String(tag.routeId ?? "");
    const routeTitle = route.routeId ? route.routeTitle : tag.routeTitle || "—";
    const store = loadStore();
    const keyBle = normalizeBle(tag.ble);
    const chargeValue = live?.chargeValue ?? tag.charge ?? 100;
    const power = live?.power ?? tag.power ?? 6;
    const frequency = live?.frequency ?? tag.frequency ?? 3;
    const bleType = live?.bleType ?? tag.bleTypeNum ?? 10;
    store.checkins = store.checkins.filter(
      (c) => !(normalizeBle(c.bleNumber) === keyBle && String(c.routeId) === routeId && !c.uploaded)
    );
    store.checkins.push({
      id: `${Date.now()}-${keyBle}`,
      routeId,
      routeTitle,
      bleNumber: tag.ble,
      ble_id: tag.id ?? null,
      mac_address: dev.deviceId,
      latitude: tag.lat ?? null,
      longitude: tag.lng ?? null,
      rssi: live?.rssi ?? dev.rssi ?? null,
      checkedAt: new Date().toISOString(),
      uploaded: false,
      movabilityType: tag.movabilityType ?? 1,
      chargeValue,
      statusCode: tag.statusCode ?? 4,
      power,
      frequency,
      bleType,
      firmwareVersion: tag.firmwareVersion || "bt1",
      gattLive: !!live?.fromGatt,
    });
    persistStore(store);
    recordDailyVisit(routeId, tag.ble);
    lastSavedBle = tag.ble;
    hapticSaved();
    pulsePendingSection();
    const chargeLabel = chargeNumValue(chargeValue);
    if (isLowBatteryCharge(chargeValue)) {
      setStatus(`Обход #${tag.ble} отправлен. Батарейки, брат! (${chargeLabel}%)`, "warn");
    } else if (live?.fromGatt) {
      setStatus(
        `Обход #${tag.ble} отправлен (заряд ${chargeLabel ?? "—"}%, мощность ${power}, тип ${bleType})`,
        "ok"
      );
    } else {
      setStatus(`Обход #${tag.ble} добавлен в сохранённые`, "ok");
    }
  }

  async function saveCheckinForBle(bleNum) {
    if (gattBusy) return;
    const tag =
      getScopeMarkers().find((t) => normalizeBle(t.ble) === normalizeBle(bleNum)) ||
      deps?.findTag?.(bleNum);
    if (!tag) {
      setStatus("Метка не найдена в данных карты", "error");
      return;
    }
    const dev = findDeviceForTag(tag, { ignoreTtl: scanPaused });
    if (!dev) {
      setStatus(
        scanPaused
          ? "Метки нет в замороженном списке. Нажмите «Продолжить» и поднесите телефон."
          : "Метка не видна по Bluetooth. Подойдите ближе и дождитесь сканирования.",
        "error"
      );
      return;
    }
    await ensureBleReady();
    setStatus(`Подключение к метке #${tag.ble}…`, "busy");
    let live;
    try {
      live = await withGattSession(dev.deviceId, () =>
        readTagGattTelemetry(dev.deviceId, tag, {
          rssi: dev.rssi,
          advTelemetry: dev.advTelemetry,
        })
      );
    } catch (e) {
      setStatus(`Подключение/чтение: ${String(e?.message || e).slice(0, 140)}`, "error");
      return;
    }
    if (!live?.fromGatt) {
      const n = live?.debug?.services ?? 0;
      setStatus(
        `GATT: данных нет (сервисов ${n}). Убедитесь, что метка bt1/WW, не чужой BLE.`,
        "error"
      );
      return;
    }
    saveCheckinRecord(tag, dev, live);
    renderAll();
  }

  async function saveCheckinForFocus() {
    if (!tagPatrolMode || !focusBle || !connectedDeviceId || gattBusy) return;
    const tag = tagByBle(focusBle);
    if (!tag) {
      setStatus("Метка не найдена в данных карты", "error");
      return;
    }
    const dev = focusConnectedDev || { deviceId: connectedDeviceId, rssi: null, lastSeen: Date.now() };
    gattBusy = true;
    renderTagPatrolBlock();
    setStatus(`Читаем данные метки #${tag.ble}…`, "busy");
    let live;
    try {
      live = await readTagGattTelemetry(connectedDeviceId, tag, {
        rssi: dev.rssi,
        advTelemetry: focusConnectedDev?.advTelemetry || dev.advTelemetry,
      });
    } catch (e) {
      gattBusy = false;
      renderTagPatrolBlock();
      setStatus(`Не удалось прочитать метку: ${String(e?.message || e).slice(0, 140)}`, "error");
      return;
    }
    gattBusy = false;
    if (!live?.fromGatt) {
      renderTagPatrolBlock();
      const n = live?.debug?.services ?? 0;
      setStatus(`GATT: данных нет (сервисов ${n}). Повторите подключение.`, "error");
      return;
    }
    saveCheckinRecord(tag, { ...dev, rssi: live.rssi ?? dev.rssi }, live);
    await disconnectDevice();
    tagPatrolMode = false;
    focusBle = null;
    focusConnectedDev = null;
    await stopScan();
    renderAll();
    scrollToPendingSection();
    setStatus(`Обход #${tag.ble} сохранён. Отправьте на сервер, когда будет интернет.`, "ok");
  }

  async function ensureBleReady() {
    const p = plugin();
    if (!p) throw new Error("BluetoothLe plugin недоступен. Пересоберите APK (cap sync).");
    await p.initialize({ androidNeverForLocation: true });
    const enabled = await p.isEnabled();
    if (!enabled?.value) {
      await p.requestEnable();
    }
  }

  function stopRenderTimer() {
    if (renderTimer) {
      clearInterval(renderTimer);
      renderTimer = null;
    }
  }

  function startRenderTimer() {
    stopRenderTimer();
    renderTimer = setInterval(() => renderNearbyList(), 2000);
  }

  async function disconnectDevice() {
    const p = plugin();
    if (!p || !connectedDeviceId) return;
    const id = connectedDeviceId;
    connectedDeviceId = null;
    focusConnectedDev = null;
    try {
      await p.disconnect({ deviceId: id });
    } catch {
      /* ignore */
    }
  }

  async function connectToDevice(deviceId) {
    const p = plugin();
    if (!p) throw new Error("BluetoothLe plugin недоступен");
    if (connectedDeviceId === deviceId) return;
    if (connectedDeviceId) await disconnectDevice();
    await p.connect({ deviceId, timeout: GATT_CONNECT_TIMEOUT_MS });
    await p.discoverServices({ deviceId, timeout: GATT_CONNECT_TIMEOUT_MS });
    connectedDeviceId = deviceId;
  }

  async function tryAutoConnectForFocus(dev, tag) {
    if (!tagPatrolMode || connecting || connectedDeviceId) return;
    const matched = resolveTagForDevice(dev, [tag]);
    if (!matched || normalizeBle(matched.ble) !== normalizeBle(tag.ble)) return;
    connecting = true;
    renderTagPatrolBlock();
    setStatus(`Подключение к метке #${tag.ble}…`, "busy");
    try {
      await connectToDevice(dev.deviceId);
      focusConnectedDev = { ...dev, lastSeen: Date.now() };
      setStatus(`Метка #${tag.ble} подключена. Нажмите «Отправить обход».`, "ok");
    } catch (e) {
      setStatus(`Не удалось подключиться: ${String(e?.message || e).slice(0, 120)}`, "error");
    } finally {
      connecting = false;
      renderTagPatrolBlock();
    }
  }

  async function connectToTagFromCache(bleNum) {
    if (connecting || gattBusy) return;
    const tag = tagByBle(bleNum) || deps?.findTag?.(bleNum);
    if (!tag) {
      setStatus("Метка не найдена в данных карты", "error");
      return;
    }
    const dev = findDeviceForTag(tag, { ignoreTtl: true });
    if (!dev) {
      setStatus("Метки нет в списке. Нажмите «Продолжить» и поднесите телефон.", "error");
      return;
    }
    await ensureBleReady();
    connecting = true;
    renderTagPatrolBlock();
    setStatus(`Подключение к метке #${tag.ble}…`, "busy");
    try {
      if (scanActive) await pauseScan();
      await connectToDevice(dev.deviceId);
      focusConnectedDev = { ...dev, lastSeen: Date.now() };
      setStatus(`Метка #${tag.ble} подключена. Можно отправить обход.`, "ok");
    } catch (e) {
      setStatus(`Не удалось подключиться: ${String(e?.message || e).slice(0, 120)}`, "error");
    } finally {
      connecting = false;
      renderTagPatrolBlock();
    }
  }

  async function pauseScan() {
    if (!scanActive) return;
    stopRenderTimer();
    const p = plugin();
    if (p) {
      try {
        await p.stopLEScan();
      } catch {
        /* ignore */
      }
    }
    scanActive = false;
    scanPaused = true;
    updateScanButton();
    renderNearbyList();
    renderTagPatrolBlock();
  }

  async function resumeScan() {
    if (scanActive) return;
    await ensureBleReady();
    if (!scanListener) {
      await beginScanOnly({ fresh: false });
      return;
    }
    const p = plugin();
    if (!p) return;
    scanPaused = false;
    try {
      await p.requestLEScan({ allowDuplicates: true });
      scanActive = true;
      startRenderTimer();
      updateScanButton();
      const route = getRoute();
      setStatus(
        tagPatrolMode && focusBle
          ? `Сканирование метки #${focusBle}… поднесите телефон`
          : route.routeId
            ? `Сканирование маршрута «${route.routeTitle}»…`
            : "Сканирование всех меток… подойдите к метке",
        "busy"
      );
    } catch (e) {
      setStatus(String(e?.message || e), "error");
      return;
    }
    renderNearbyList();
    renderTagPatrolBlock();
  }

  async function stopScan() {
    stopRenderTimer();
    const p = plugin();
    if (scanActive && p) {
      try {
        if (scanListener?.remove) await scanListener.remove();
      } catch {
        /* ignore */
      }
      scanListener = null;
      try {
        await p.stopLEScan();
      } catch {
        /* ignore */
      }
    } else if (scanListener?.remove) {
      try {
        await scanListener.remove();
      } catch {
        /* ignore */
      }
      scanListener = null;
    }
    scanActive = false;
    scanPaused = false;
    devices.clear();
    updateScanButton();
    renderNearbyList();
    renderTagPatrolBlock();
  }

  async function beginScanOnly(opts = {}) {
    const fresh = opts.fresh !== false;
    if (fresh) {
      devices.clear();
      scanPaused = false;
    }
    renderNearbyList();

    const p = plugin();
    if (scanListener?.remove) {
      try {
        await scanListener.remove();
      } catch {
        /* ignore */
      }
    }
    scanListener = await p.addListener("onScanResult", (result) => {
      if (!result?.device?.deviceId) return;
      if (!acceptScanResult(result)) return;
      const id = result.device.deviceId;
      const prev = devices.get(id);
      const bleFromAdv = bleFromManufacturerData(result) || prev?.bleFromAdv || "";
      const advTelemetry = parseWwAdvTelemetry(result) || prev?.advTelemetry || null;
      devices.set(id, {
        deviceId: id,
        name: result.device.name || result.localName || prev?.name,
        rssi: result.rssi ?? prev?.rssi,
        lastSeen: Date.now(),
        bleFromAdv,
        advTelemetry,
        isWw: isWwAdvertisement(result),
      });
      if (tagPatrolMode && focusBle && !connectedDeviceId && !connecting) {
        const focusTag = tagByBle(focusBle);
        const devEntry = devices.get(id);
        if (focusTag && devEntry) {
          void tryAutoConnectForFocus(devEntry, focusTag);
        }
      }
      renderNearbyList();
      renderTagPatrolBlock();
    });
    await p.requestLEScan({ allowDuplicates: true });
    scanActive = true;
    scanPaused = false;
    startRenderTimer();
    updateScanButton();
    const route = getRoute();
    setStatus(
      tagPatrolMode && focusBle
        ? `Сканирование метки #${focusBle}… поднесите телефон`
        : route.routeId
          ? `Сканирование маршрута «${route.routeTitle}»…`
          : "Сканирование всех меток… подойдите к метке",
      "busy"
    );
    renderTagPatrolBlock();
  }

  async function startScan() {
    await ensureBleReady();
    if (scanActive) {
      await pauseScan();
      return;
    }
    if (scanPaused) {
      await resumeScan();
      return;
    }
    await beginScanOnly();
  }

  async function uploadPending() {
    if (!deps?.apiMutate) {
      setStatus("API карты не инициализирован", "error");
      return;
    }
    if (!navigator.onLine) {
      setStatus("Нужен интернет (Wi‑Fi или мобильная сеть)", "error");
      return;
    }
    const store = loadStore();
    const pending = store.checkins.filter((c) => !c.uploaded);
    if (!pending.length) {
      setStatus("Нет обходов для отправки", "info");
      return;
    }
    setStatus(`Отправка ${pending.length} обходов…`, "busy");
    let ok = 0;
    let fail = 0;
    let lastErr = "";
    for (const c of pending) {
      const tag = deps?.findTag?.(c.bleNumber);
      const body = deps?.buildInspectionBody?.(c, tag) || {
        bleId: c.ble_id,
        ble_number: Number(c.bleNumber),
        mac_address: c.mac_address,
        latitude: c.latitude,
        longitude: c.longitude,
        movabilityType: c.movabilityType ?? 1,
        recordDt: c.checkedAt || new Date().toISOString(),
        chargeValue: c.chargeValue ?? 100,
        status: c.statusCode ?? 4,
        power: c.power ?? 6,
        frequency: c.frequency ?? 3,
        bleType: c.bleType ?? 10,
        firmwareVersion: c.firmwareVersion || "bt1",
        rssi: c.rssi,
      };
      try {
        await deps.apiMutate("POST", "/api/v2/ble_inspection", body);
        c.uploaded = true;
        c.uploadedAt = new Date().toISOString();
        ok++;
      } catch (e) {
        fail++;
        lastErr = e?.message || String(e);
        console.warn("[ble-field] upload", c.bleNumber, lastErr);
      }
    }
    persistStore(store);
    renderAll();
    if (fail && ok) {
      setStatus(`Отправлено ${ok}, ошибок ${fail}. ${lastErr}`, "error");
    } else if (fail) {
      setStatus(
        lastErr.includes("HTTP 422")
          ? `Сервер отклонил обход: ${lastErr.replace(/^HTTP 422:\s*/, "").slice(0, 160)}`
          : `Не удалось отправить: ${lastErr.slice(0, 160)}`,
        "error"
      );
    } else {
      setStatus(`Все обходы отправлены на сервер (${ok})`, "ok");
    }
  }

  function openPanel(tag) {
    void window.WwBleFinder?.close?.();
    focusBle = tag?.ble ? String(tag.ble) : null;
    const panel = $("bleFieldPanel");
    if (panel) {
      panel.hidden = false;
      panel.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("ble-field-open");
    renderAll();
    const route = getRoute();
    if (tagPatrolMode && focusBle) {
      setStatus(`Метка #${focusBle}. Идёт сканирование и подключение…`, "busy");
    } else if (focusBle) {
      setStatus(
        route.routeId
          ? `Метка #${focusBle} · «${route.routeTitle}». Нажмите «Сканировать».`
          : `Метка #${focusBle}. Нажмите «Сканировать» (все маршруты).`,
        "info"
      );
    } else if (route.routeId) {
      setStatus(`Маршрут «${route.routeTitle}». Сканируйте и сохраняйте обходы.`, "info");
    } else {
      setStatus("Все маршруты. Сканируйте — покажем любую видимую метку из базы.", "info");
    }
  }

  async function openTagPatrol(tag) {
    await disconnectDevice();
    tagPatrolMode = true;
    connectedDeviceId = null;
    focusConnectedDev = null;
    connecting = false;
    focusBle = tag?.ble ? String(tag.ble) : null;
    openPanel(tag || null);
    syncPatrolSearchInput();
    try {
      await ensureBleReady();
      if (!scanActive) await beginScanOnly();
    } catch (e) {
      setStatus(String(e?.message || e), "error");
    }
  }

  async function closePanel() {
    void stopScan();
    await disconnectDevice();
    closePhotoModal();
    tagPatrolMode = false;
    focusBle = null;
    focusConnectedDev = null;
    connecting = false;
    pendingExpanded = false;
    clearPatrolSearch();
    const panel = $("bleFieldPanel");
    if (panel) {
      panel.hidden = true;
      panel.setAttribute("aria-hidden", "true");
      panel.classList.remove("ble-field-panel--tag-focus");
    }
    document.body.classList.remove("ble-field-open");
  }

  function bindUi() {
    $("bleFieldScanBtn")?.addEventListener("click", () => {
      void startScan().catch((e) => setStatus(String(e?.message || e), "error"));
    });
    $("bleFieldUploadBtn")?.addEventListener("click", () => {
      void uploadPending();
    });
    $("bleFieldPendingToggle")?.addEventListener("click", () => {
      if (!pendingCheckins().length) return;
      hapticTap(18);
      pendingExpanded = !pendingExpanded;
      renderPendingBlock();
    });
    $("bleFieldFocusConnectBtn")?.addEventListener("click", () => {
      if (focusBle) void connectToTagFromCache(focusBle);
    });
    $("bleFieldFocusSaveBtn")?.addEventListener("click", () => {
      hapticTap(28);
      void saveCheckinForFocus();
    });
    $("bleFieldCloseBtn")?.addEventListener("click", () => {
      void closePanel();
    });
    $("bleFieldResetRouteBtn")?.addEventListener("click", () => {
      const route = getRoute();
      if (!route?.routeId) {
        setStatus("Сначала выберите маршрут", "error");
        return;
      }
      const again = isRouteResetToday(route.routeId);
      const ok = confirm(
        `${again ? "Снова обнулить" : "Обнулить"} маршрут «${route.routeTitle}»?\n\n` +
          "На этом устройстве все метки маршрута снова будут показаны как требующие обхода.\n" +
          "На сервер ничего не отправляется."
      );
      if (!ok) return;
      resetRouteToday(route.routeId);
      focusBle = null;
      tagPatrolMode = false;
      clearPatrolSearch();
      renderAll();
      setStatus(`Маршрут «${route.routeTitle}» локально обнулён. Считаем только новые обходы за сегодня.`, "warn");
    });
    $("bleFieldPhotoCloseBtn")?.addEventListener("click", closePhotoModal);
    $("bleFieldPhotoModal")?.addEventListener("click", (e) => {
      if (e.target?.id === "bleFieldPhotoModal") closePhotoModal();
    });
    $("mapBleFieldBtn")?.addEventListener("click", () => {
      tagPatrolMode = false;
      connectedDeviceId = null;
      focusConnectedDev = null;
      connecting = false;
      clearPatrolSearch();
      openPanel(null);
    });
    $("bleFieldSearchForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      void searchPatrolTag();
    });
    $("bleFieldSearchClear")?.addEventListener("click", () => {
      clearPatrolSearch();
      tagPatrolMode = false;
      focusBle = null;
      void disconnectDevice();
      renderAll();
      $("bleFieldSearchInput")?.focus();
    });
    $("bleFieldSearchInput")?.addEventListener("input", () => {
      const input = $("bleFieldSearchInput");
      const clearBtn = $("bleFieldSearchClear");
      if (clearBtn) clearBtn.hidden = !input?.value?.trim();
    });
    window.addEventListener("online", () => renderPendingBlock());
    window.addEventListener("offline", () => renderPendingBlock());
  }

  function init(api) {
    deps = api || null;
    if (!api?.isNative?.()) return false;
    bindUi();
    updateToolbarBadge();
    const btn = $("mapBleFieldBtn");
    if (btn) {
      btn.hidden = false;
      btn.title = "Обход маршрута: BLE-скан, сохранение на телефоне, отправка из офиса";
    }
    return true;
  }

  window.WwBleField = {
    init,
    openForTag(tag) {
      void openTagPatrol(tag);
    },
    close: closePanel,
    suspendScan: stopScan,
    onRouteChanged() {
      renderAll();
    },
    refresh: renderAll,
    getPatrolStats(routeId, totalMarkers) {
      return patrolStatsForRoute(routeId, totalMarkers);
    },
    isRouteReset(routeId) {
      return isRouteResetToday(routeId);
    },
    getDailyDoneBles(routeId) {
      return [...getDailyDoneSet(routeId)];
    },
    isTagDoneToday,
  };
})();
