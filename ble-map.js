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
  const BLE_MAP_BUILD = "20260522b";
  const BLE_GENPLAN_META_URL = "data/ble-genplan-meta.json";
  const M_PER_DEG_LAT = 111320;
  const BLE_MAP_ACCESS_PASSWORD = "VELES_2024";
  const BLE_OFFLINE_MARKER_EDITS_KEY = "ww-ble-offline-marker-edits";
  const BLE_FIELD_SYNC_STATE_KEY = "ww-ble-field-sync-state";
  const BLE_FIELD_PACK_FETCH_TIMEOUT_MS = 25 * 60 * 1000;
  const BLE_DOT_PX = 20;
  const BLE_FIELD_DB = "ww-ble-field-v1";
  const BLE_FIELD_META_STORE = "meta";
  const BLE_FIELD_PHOTOS_STORE = "photos";
  const BLE_FIELD_PACK_KEY = "pack";
  const BLE_FIELD_MARKERS_KEY = "markers";
  const BLE_FIELD_PACK_VERSION = 3;
  const BLE_FIELD_PACK_META_URL = "data/ble-field-pack-meta.json";
  const BLE_FIELD_PHOTO_MAX_BYTES = 2.5 * 1024 * 1024;
  const BLE_FIELD_PHOTO_BATCH = 8;
  const BLE_FIELD_YIELD_EVERY = 1;
  const BLE_DEFAULT_CENTER_BLE = "20";
  const BLE_DEFAULT_CENTER_ZOOM = 18;
  const BLE_MAP_MIN_ZOOM = 14;
  /** Esri в этом районе без тайлов выше ~18 — выше только upscale, не новые запросы */
  const BLE_SATELLITE_NATIVE_ZOOM = 18;
  const BLE_STREET_NATIVE_ZOOM = 19;
  const BLE_MAP_MAX_ZOOM = 19;
  const BLE_MAP_EDIT_MAX_ZOOM = 20;
  const BLE_DEFAULT_CENTER_RETRY_MS = 220;
  const BLE_DEFAULT_CENTER_MAX_ATTEMPTS = 18;
  const BLE_ZONE_NEON = "#00e5ff";
  const BLE_ZONE_NEON_FILL = "#66f0ff";
  const BLE_ZONE_SMALL_MAX_PTS = 12;
  const BLE_BASE_LAYER_KEY = "ww-ble-base-layer";
  const BLE_BASE_LAYERS = ["street", "satellite", "hybrid", "genplan"];

  const BLE_TOKEN_KEY = "accessToken";
  const BLE_AUTO_USER = "impl_dept";
  const BLE_AUTO_PASS = "impl_dept_vsm_2024";

  let bleMap = null;
  let bleMapData = [];
  let bleMapFilter = "all";
  let bleMapRouteFilter = "";
  let bleRoutes = [];
  let bleMapInitialized = false;
  let bleDefaultCenterSeq = 0;
  let bleDefaultCenterLocked = false;
  let bleZoneData = [];
  const fieldPhotoBlobUrls = new Map();
  let fieldPackDownloadActive = false;
  let fieldPackMetaCache = null;
  let fieldPackAbort = null;
  let fieldSyncIdbChain = Promise.resolve();
  let fieldSyncPhotosSinceAuth = 0;

  function fieldPackConcurrency() {
    return isCoarseMobile() ? 1 : 3;
  }

  function fieldSyncPhotoBatchSize() {
    return isCoarseMobile() ? 1 : BLE_FIELD_PHOTO_BATCH;
  }

  function resetFieldSyncIdbChain() {
    fieldSyncIdbChain = Promise.resolve();
  }

  function enqueueFieldSyncIdbWrite(fn) {
    const run = fieldSyncIdbChain.then(() => fn());
    fieldSyncIdbChain = run.catch((e) => {
      console.warn("[ble-map] field sync idb", e?.message || e);
    });
    return run;
  }

  function commitFieldPackMetaQueued(meta) {
    return enqueueFieldSyncIdbWrite(() => commitFieldPackMeta(meta));
  }

  function appendFieldPackPhotosBatchQueued(entries) {
    if (!entries?.length) return Promise.resolve();
    return enqueueFieldSyncIdbWrite(() => appendFieldPackPhotosBatch(entries));
  }

  function commitFieldPackMarkersQueued(slimRaw) {
    return enqueueFieldSyncIdbWrite(() => commitFieldPackMarkers(slimRaw));
  }

  function yieldToMain() {
    return new Promise((r) => setTimeout(r, 0));
  }

  function formatFieldPackMb(bytes) {
    if (!bytes) return "0 МБ";
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  }

  function setFieldPackCancelVisible(show) {
    const el = document.getElementById("mapFieldPackCancel");
    if (el) el.hidden = !show;
  }

  function abortFieldPackDownload() {
    if (fieldPackAbort) fieldPackAbort.abort();
  }

  function getFflate() {
    return typeof globalThis.fflate !== "undefined" ? globalThis.fflate : null;
  }

  function unzipFieldPackAsync(buf) {
    const ff = getFflate();
    if (!ff?.unzip) return Promise.reject(new Error("fflate_missing"));
    return new Promise((resolve, reject) => {
      ff.unzip(buf, (err, data) => (err ? reject(err) : resolve(data)));
    });
  }

  let hostedFieldPackMetaCache = null;

  async function fetchHostedFieldPackMeta() {
    if (hostedFieldPackMetaCache) return hostedFieldPackMetaCache;
    try {
      const res = await fetch(BLE_FIELD_PACK_META_URL, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.packUrl || !data?.photosOk) return null;
      hostedFieldPackMetaCache = data;
      return data;
    } catch {
      return null;
    }
  }

  function openFieldPackFilePicker() {
    const input = document.getElementById("mapFieldPackFile");
    if (!input) {
      alert("Выбор файла недоступен в этой версии страницы.");
      return;
    }
    input.value = "";
    input.click();
  }

  async function importFieldPackZipBlob(blob, opts = {}) {
    if (fieldPackDownloadActive) return;
    const ff = getFflate();
    if (!ff) {
      alert("Не загружена библиотека распаковки. Обновите страницу (Ctrl+F5).");
      return;
    }
    fieldPackDownloadActive = true;
    fieldPackAbort = new AbortController();
    const btn = document.getElementById("mapFieldPackBtn");
    if (btn) btn.disabled = true;
    setFieldPackCancelVisible(true);
    setFieldPackStatus("Чтение архива…", "busy");
    try {
      await yieldToMain();
      const buf = new Uint8Array(await blob.arrayBuffer());
      if (fieldPackAbort?.signal.aborted) return;
      setFieldPackStatus("Распаковка…", "busy");
      await yieldToMain();
      const files = await unzipFieldPackAsync(buf);
      const metaU8 = files["meta.json"];
      const markersU8 = files["markers.json"];
      if (!metaU8 || !markersU8) throw new Error("invalid_zip");
      const packMeta = JSON.parse(ff.strFromU8(metaU8));
      if (packMeta.format !== "ww-ble-field-zip" || !packMeta.photoIndex) {
        throw new Error("unsupported_pack");
      }
      const slimRaw = JSON.parse(ff.strFromU8(markersU8));
      if (!Array.isArray(slimRaw) || !slimRaw.length) throw new Error("empty_markers");

      const photoEntries = Object.entries(packMeta.photoIndex);
      const total = photoEntries.length;
      let written = 0;
      let bytesTotal = 0;

      revokeFieldPhotoBlobUrls();
      await resetFieldPackStorage();
      setFieldPackStatus(`Запись фото: 0 / ${total}`, "busy");
      await yieldToMain();

      const batch = [];
      for (const [url, zipPath] of photoEntries) {
        if (fieldPackAbort?.signal.aborted) break;
        const u8 = files[zipPath];
        if (!u8?.length) continue;
        const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        batch.push([url, new Blob([ab], { type: "image/jpeg" })]);
        bytesTotal += u8.length;
        if (batch.length >= BLE_FIELD_PHOTO_BATCH) {
          const chunk = batch.splice(0, batch.length);
          await appendFieldPackPhotosBatch(chunk);
          written += chunk.length;
          setFieldPackStatus(`Запись фото: ${Math.min(written, total)} / ${total}`, "busy");
          await yieldToMain();
        }
      }
      if (batch.length) await appendFieldPackPhotosBatch(batch);
      if (fieldPackAbort?.signal.aborted) {
        await resetFieldPackStorage();
        setFieldPackStatus("Импорт отменён", "busy");
        return;
      }

      const idbMeta = {
        version: BLE_FIELD_PACK_VERSION,
        companyId: packMeta.companyId,
        savedAt: packMeta.savedAt || new Date().toISOString(),
        markerCount: slimRaw.length,
        photoCount: total,
        photosOk: packMeta.photosOk ?? total,
        photosFail: packMeta.photosFail ?? 0,
        bytesTotal: packMeta.bytesTotal ?? bytesTotal,
        tagOnly: !!packMeta.tagOnly,
        packSource: opts.source || "zip",
      };
      setFieldPackStatus("Запись меток…", "busy");
      await yieldToMain();
      await commitFieldPackMarkers(slimRaw);
      await commitFieldPackMeta(idbMeta);
      if (!bleMap) initBleMap([53.038, 39.011], 15);
      bleCompanyId = packMeta.companyId || bleCompanyId;
      await applyBleListToMap(slimRaw, "");
      try {
        sessionStorage.setItem(BLE_OFFLINE_FIRST_KEY, "1");
      } catch {
        /* ignore */
      }
      setRetryVisible(!navigator.onLine);
      await refreshFieldPackChrome();
      alert(
        `Импорт zip завершён.\n\nМеток: ${slimRaw.length}\nФото: ${idbMeta.photosOk}` +
          (idbMeta.photosFail ? ` (${idbMeta.photosFail} не попали в архив)` : "") +
          `\n\nВ поле без связи откройте карту — данные из памяти телефона.`
      );
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (msg.includes("QuotaExceeded") || msg.includes("quota")) {
        alert("Недостаточно места в браузере. Удалите старые данные сайта или используйте пакет только с фото меток (npm run ble-field-pack).");
      } else {
        alert(`Не удалось загрузить пакет: ${msg.slice(0, 180)}`);
      }
      setFieldPackStatus("");
    } finally {
      fieldPackDownloadActive = false;
      fieldPackAbort = null;
      setFieldPackCancelVisible(false);
      if (btn) btn.disabled = false;
    }
  }

  function fieldPackNeedsProxy(packUrl) {
    try {
      const u = new URL(packUrl, window.location.href);
      if (u.origin === window.location.origin) return false;
      return /github\.com\/ITS-helper\/tabel\/releases\/download\//i.test(u.href);
    } catch {
      return false;
    }
  }

  function fieldPackFetchUrl(packUrl) {
    if (!fieldPackNeedsProxy(packUrl)) return packUrl;
    return `${BLE_SUPABASE_BASE}?path=${encodeURIComponent("/field-pack")}&url=${encodeURIComponent(packUrl)}`;
  }

  async function downloadHostedFieldPack() {
    const hosted = await fetchHostedFieldPackMeta();
    if (!hosted?.packUrl) {
      alert(
        "Готовый пакет на сайте ещё не выложен.\n\nНа компьютере с VPN: npm run ble-field-pack\nЗатем перекиньте data/ble-field-pack.zip на телефон → «Загрузить файл»."
      );
      return;
    }
    if (!navigator.onLine) {
      alert("Нужен интернет, чтобы скачать пакет с сайта.");
      return;
    }
    const mb = hosted.bytesTotal
      ? (hosted.bytesTotal / (1024 * 1024)).toFixed(0)
      : "?";
    if (
      !confirm(
        `Скачать готовый пакет (~${mb} МБ)?\n\nОдин файл — надёжнее для телефона, чем сотни загрузок в браузере.\n\nНе сворачивайте вкладку до конца.`
      )
    ) {
      return;
    }
    fieldPackDownloadActive = true;
    fieldPackAbort = new AbortController();
    const btn = document.getElementById("mapFieldPackBtn");
    if (btn) btn.disabled = true;
    setFieldPackCancelVisible(true);
    try {
      setFieldPackStatus("Скачивание пакета…", "busy");
      const fetchUrl = fieldPackFetchUrl(hosted.packUrl);
      const fetchCtrl = new AbortController();
      const fetchTimer = setTimeout(() => fetchCtrl.abort(), BLE_FIELD_PACK_FETCH_TIMEOUT_MS);
      if (fieldPackAbort?.signal) {
        fieldPackAbort.signal.addEventListener("abort", () => fetchCtrl.abort(), { once: true });
      }
      const res = await fetch(fetchUrl, {
        cache: "no-store",
        signal: fetchCtrl.signal,
        headers: fetchUrl.includes("ble-map-proxy")
          ? mergeSupabaseHeaders({ Accept: "application/zip,*/*" })
          : undefined,
      });
      clearTimeout(fetchTimer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("Content-Length")) || 0;
      const reader = res.body?.getReader();
      if (!reader) {
        await importFieldPackZipBlob(await res.blob(), { source: "hosted" });
        return;
      }
      const chunks = [];
      let got = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (fieldPackAbort?.signal.aborted) throw new Error("aborted");
        chunks.push(value);
        got += value.length;
        if (total > 0) {
          setFieldPackStatus(
            `Скачивание: ${((got / total) * 100).toFixed(0)}% · ${formatFieldPackMb(got)}`,
            "busy"
          );
        } else if (got % (512 * 1024) < value.length) {
          setFieldPackStatus(`Скачивание: ${formatFieldPackMb(got)}`, "busy");
        }
        await yieldToMain();
      }
      const blob = new Blob(chunks, { type: "application/zip" });
      fieldPackDownloadActive = false;
      fieldPackAbort = null;
      setFieldPackCancelVisible(false);
      if (btn) btn.disabled = false;
      await importFieldPackZipBlob(blob, { source: "hosted" });
    } catch (e) {
      if (String(e?.message || e) === "aborted") {
        setFieldPackStatus("Скачивание отменено", "busy");
      } else {
        const msg = String(e?.message || e);
        const hint = fieldPackNeedsProxy(hosted?.packUrl)
          ? "\n\nЕсли ошибка повторяется — обновите Edge Function ble-map-proxy в Supabase или загрузите .zip вручную (Офлайн-пакет → выбрать файл)."
          : "\n\nПопробуйте «Загрузить .zip» с телефона (файл с Release).";
        alert(`Не удалось скачать пакет: ${msg.slice(0, 120)}${hint}`);
        setFieldPackStatus("");
      }
      fieldPackDownloadActive = false;
      fieldPackAbort = null;
      setFieldPackCancelVisible(false);
      if (btn) btn.disabled = false;
    }
  }

  function loadFieldSyncState() {
    try {
      const raw = localStorage.getItem(BLE_FIELD_SYNC_STATE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s && typeof s === "object" ? s : null;
    } catch {
      return null;
    }
  }

  function saveFieldSyncState(state) {
    try {
      localStorage.setItem(BLE_FIELD_SYNC_STATE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }

  function clearFieldSyncState() {
    try {
      localStorage.removeItem(BLE_FIELD_SYNC_STATE_KEY);
    } catch {
      /* ignore */
    }
  }

  async function getFieldPhotoKeysSet() {
    try {
      const db = await openFieldDb();
      const tx = db.transaction(BLE_FIELD_PHOTOS_STORE, "readonly");
      const keys = await idbGetAllKeys(tx.objectStore(BLE_FIELD_PHOTOS_STORE));
      db.close();
      return new Set(keys.map(String));
    } catch {
      return new Set();
    }
  }

  async function countFieldPhotosInDb() {
    try {
      const db = await openFieldDb();
      const tx = db.transaction(BLE_FIELD_PHOTOS_STORE, "readonly");
      const n = await new Promise((resolve, reject) => {
        const req = tx.objectStore(BLE_FIELD_PHOTOS_STORE).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return n;
    } catch {
      return 0;
    }
  }

  function normalizeRouteTitle(s) {
    return String(s || "")
      .replace(/\s*\d+\/\d+\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function rawPointRouteId(p) {
    if (!p) return null;
    const r = p.bleRoute ?? p.ble_route;
    if (r != null && typeof r === "object" && r.id != null) return String(r.id);
    if (p.ble_route_id != null) return String(p.ble_route_id);
    if (typeof r === "number" || typeof r === "string") return String(r);
    return null;
  }

  function rawPointRouteTitle(p) {
    const r = p?.bleRoute ?? p?.ble_route;
    if (r && typeof r === "object" && r.title) return String(r.title);
    if (typeof p?.route_title === "string") return p.route_title;
    return "";
  }

  function filterRawByRoute(raw, routeRef) {
    if (!Array.isArray(raw)) return [];
    const routeId =
      routeRef != null && typeof routeRef === "object"
        ? routeRef.routeId ?? routeRef.id
        : routeRef;
    const routeTitle =
      routeRef != null && typeof routeRef === "object" ? routeRef.routeTitle || routeRef.title || "" : "";
    if (!routeId && !routeTitle) return raw;

    const rid = routeId != null ? String(routeId) : "";
    let out = rid ? raw.filter((p) => rawPointRouteId(p) === rid) : [];
    if (out.length) return out;

    const titleNorm = normalizeRouteTitle(routeTitle);
    if (titleNorm) {
      out = raw.filter((p) => {
        const t = normalizeRouteTitle(rawPointRouteTitle(p));
        return t === titleNorm || t.includes(titleNorm) || titleNorm.includes(t);
      });
      if (out.length) return out;
    }

    const mapOnRoute = bleMapData.filter((pt) => {
      if (rid && pt.routeId != null && String(pt.routeId) === rid) return true;
      if (!titleNorm || !pt.routeTitle) return false;
      const t = normalizeRouteTitle(pt.routeTitle);
      return t === titleNorm || t.includes(titleNorm) || titleNorm.includes(t);
    });
    if (!mapOnRoute.length) return [];

    const byId = new Set(mapOnRoute.map((pt) => Number(pt.id)).filter((id) => !Number.isNaN(id)));
    const byBle = new Set(mapOnRoute.map((pt) => String(pt.ble || "").toLowerCase()).filter(Boolean));
    return raw.filter((p) => {
      if (p.id != null && byId.has(Number(p.id))) return true;
      const bn = String(p.ble_number ?? p.bleNumber ?? "").toLowerCase();
      return bn && byBle.has(bn);
    });
  }

  function getActiveRouteForFieldSync() {
    const routeId = bleMapRouteFilter ? String(bleMapRouteFilter) : "";
    if (!routeId) return null;
    const route = bleRoutes.find((r) => String(r.id) === routeId);
    return {
      routeId,
      routeTitle: route ? routeOptionLabel(route) : `Маршрут ${routeId}`,
    };
  }

  function estimateMarkersOnRoute(routeId) {
    if (!routeId) return 0;
    const route = getActiveRouteForFieldSync() || {
      routeId: String(routeId),
      routeTitle: "",
    };
    const prev = bleMapRouteFilter;
    bleMapRouteFilter = String(routeId);
    const onMap = bleMapData.filter((pt) => pointPassesRouteFilter(pt)).length;
    bleMapRouteFilter = prev;
    if (onMap > 0) return onMap;
    const snap = bleListSnapshot?.raw;
    if (snap?.length) return filterRawByRoute(snap, route).length;
    return onMap;
  }

  async function pruneFieldPhotosNotInUrls(keepUrls) {
    const keep = new Set(keepUrls || []);
    const keys = await getFieldPhotoKeysSet();
    const drop = [...keys].filter((k) => !keep.has(k));
    if (!drop.length) return 0;
    revokeFieldPhotoBlobUrls();
    const db = await openFieldDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BLE_FIELD_PHOTOS_STORE, "readwrite");
      const store = tx.objectStore(BLE_FIELD_PHOTOS_STORE);
      for (const key of drop) {
        if (fieldPhotoBlobUrls.has(key)) {
          try {
            URL.revokeObjectURL(fieldPhotoBlobUrls.get(key));
          } catch {
            /* ignore */
          }
          fieldPhotoBlobUrls.delete(key);
        }
        store.delete(key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return drop.length;
  }

  async function fieldSyncSummaryLine() {
    const meta = await loadFieldPackMeta();
    const inDb = await countFieldPhotosInDb();
    const markers = meta?.markerCount || 0;
    const photos = Math.max(meta?.photosOk || 0, inDb);
    if (!markers && !photos) return "";
    const routeBit = meta?.routeTitle ? `${meta.routeTitle} · ` : "";
    const need = meta?.photoCount ? meta.photoCount - photos : 0;
    if (need > 0) return `${routeBit}${markers} меток · ${photos} фото (ещё ~${need})`;
    return `${routeBit}${markers} меток · ${photos} фото`;
  }

  async function onFieldPackPrimaryClick() {
    if (fieldPackDownloadActive) return;

    const route = getActiveRouteForFieldSync();
    if (!route) {
      alert(
        "Сначала выберите маршрут в списке «Маршрут» (не «Все маршруты»), затем нажмите «Подготовка к полю»."
      );
      return;
    }

    const summary = await fieldSyncSummaryLine();
    const est = estimateMarkersOnRoute(route.routeId);
    const estLine = est > 0 ? `~${est} меток` : "метки маршрута";
    const mobile = isCoarseMobile();
    let intro =
      `Подготовка к полю — только выбранный маршрут:\n\n«${route.routeTitle}»\n${estLine}, координаты и фото (метка + место).\n\n`;
    if (summary) intro += `Сейчас в памяти: ${summary}\nДокачаем только недостающее по этому маршруту.\n\n`;
    intro += mobile
      ? "Нужен Wi‑Fi/VPN. Можно остановить и продолжить позже (Safari).\n\nНачать синхронизацию?"
      : "Нужен интернет (Wi‑Fi/VPN). Можно прервать и продолжить позже.\n\nНачать синхронизацию?";

    if (!confirm(intro)) {
      const more = confirm(
        "Другие способы:\n\nОК — импорт .zip (если есть архив с ПК)\nОтмена — закрыть"
      );
      if (more) openFieldPackFilePicker();
      return;
    }

    void syncFieldDataBeforeWork({ resume: true, routeId: route.routeId, routeTitle: route.routeTitle });
  }

  async function onFieldPackAdvancedMenu() {
    if (fieldPackDownloadActive) return;
    const hosted = await fetchHostedFieldPackMeta();
    const choice = prompt(
      "Дополнительно (обычно не нужно):\n\n" +
        "1 — импорт .zip с телефона\n" +
        (hosted?.packUrl ? "2 — скачать готовый zip с сайта (~146 МБ)\n" : "") +
        "3 — очистить и скачать всё заново\n" +
        "4 — только координаты (без фото)\n\n" +
        "Введите номер или Отмена:",
      ""
    );
    if (!choice) return;
    if (choice.trim() === "1") {
      openFieldPackFilePicker();
      return;
    }
    if (choice.trim() === "2" && hosted?.packUrl && navigator.onLine) {
      void downloadHostedFieldPack();
      return;
    }
    if (choice.trim() === "3") {
      const route = getActiveRouteForFieldSync();
      if (!route) {
        alert("Выберите маршрут в списке «Маршрут».");
        return;
      }
      if (confirm(`Удалить данные и скачать заново маршрут «${route.routeTitle}»?`)) {
        void syncFieldDataBeforeWork({
          fullReset: true,
          resume: false,
          routeId: route.routeId,
          routeTitle: route.routeTitle,
        });
      }
      return;
    }
    if (choice.trim() === "4") {
      const route = getActiveRouteForFieldSync();
      if (!route) {
        alert("Выберите маршрут в списке «Маршрут».");
        return;
      }
      void syncFieldDataBeforeWork({
        markersOnly: true,
        resume: true,
        routeId: route.routeId,
        routeTitle: route.routeTitle,
      });
    }
  }
  let bleClusterGroup = null;

  let bleMapFS = null;
  let bleMapFSFilter = "all";
  let bleMapFSInitialized = false;
  let bleTileLayers = null;
  let bleGenplanMeta = null;
  let bleGenplanMask = null;
  let bleGenplanCalibMode = false;
  let bleGenplanCalibSavedLayer = null;
  let bleDrawTool = null;
  const bleDrawGroupByMap = new WeakMap();
  const BLE_DRAW_SNAP_DEG = 15;
  const BLE_DRAW_PARALLEL_HALF_M = 200;
  let bleBaseLayerCurrent = "street";
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
  let bleListSnapshot = null;
  const BLE_LIST_SNAPSHOT_MS = 4 * 60 * 1000;

  const bleMarkerRegistry = new Map();
  const bleByBleNumber = new Map();
  let bleInspectionCount = 0;
  let lastRenderKey = "";
  let lastRenderKeyFS = "";
  let pendingRenderRaf = 0;
  let pendingInvalidateRaf = 0;
  const BLE_RENDER_DEBOUNCE_MS = 110;

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[m]
    );
  }

  function attrEsc(str) {
    return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }

  function pickFirstUrl(obj, keys) {
    if (!obj) return "";
    for (const k of keys) {
      const v = obj[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  }

  function isPhotoUrlExpired(url) {
    if (!url) return true;
    const dateM = String(url).match(/[?&]X-Amz-Date=([^&]+)/);
    const expM = String(url).match(/[?&]X-Amz-Expires=(\d+)/);
    if (!dateM || !expM) return false;
    const d = dateM[1];
    const t0 = Date.UTC(
      +d.slice(0, 4),
      +d.slice(4, 6) - 1,
      +d.slice(6, 8),
      +d.slice(9, 11),
      +d.slice(11, 13),
      +d.slice(13, 15)
    );
    return Date.now() > t0 + parseInt(expM[1], 10) * 1000;
  }

  function resolvePhotoUrl(rawPoint, keys, prevUrl) {
    const fromApi = pickFirstUrl(rawPoint, keys);
    if (fromApi && !isPhotoUrlExpired(fromApi)) return fromApi;
    if (prevUrl && !isPhotoUrlExpired(prevUrl)) return prevUrl;
    return "";
  }

  function mergeBleMapDataFromRaw(rawBle) {
    const prevById = new Map(bleMapData.map((p) => [p.id, p]));
    return rawBle.map((point) => {
      const prev = point.id != null ? prevById.get(point.id) : null;
      return classifyBle(point, prev);
    });
  }

  function invalidateMarkerRegistry() {
    bleMarkerRegistry.forEach(({ marker }) => {
      try {
        marker.off();
        marker.unbindPopup?.();
      } catch {
        /* ignore */
      }
    });
    bleMarkerRegistry.clear();
  }

  function rebuildBleIndex() {
    bleByBleNumber.clear();
    let insp = 0;
    bleMapData.forEach((pt) => {
      if (pt.ble) bleByBleNumber.set(pt.ble.toLowerCase(), pt);
      if (pt.status === "inspection") insp++;
    });
    bleInspectionCount = insp;
  }

  function normalizeBleNumber(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^ble/i, "");
  }

  function findBlePointByNumber(num) {
    const key = normalizeBleNumber(num);
    if (!key) return null;
    return bleByBleNumber.get(key) || bleMapData.find((p) => normalizeBleNumber(p.ble) === key) || null;
  }

  function centerMapOnDefaultBle(targetMap = bleMap, opts = {}) {
    if (!targetMap) return false;
    const pt = findBlePointByNumber(BLE_DEFAULT_CENTER_BLE);
    if (!pt?.lat || !pt.lng) return false;
    const zoom = opts.zoom ?? BLE_DEFAULT_CENTER_ZOOM;
    const latlng = L.latLng(pt.lat, pt.lng);
    try {
      targetMap.invalidateSize(true);
    } catch {
      /* ignore */
    }
    targetMap.setView(latlng, zoom, { animate: opts.animate === true });
    try {
      targetMap.panTo(latlng, { animate: false, noMoveStart: true });
    } catch {
      /* ignore */
    }
    return true;
  }

  function focusDefaultBleOnMap(targetMap = bleMap) {
    const pt = findBlePointByNumber(BLE_DEFAULT_CENTER_BLE);
    if (!pt?.lat || !pt.lng) return false;
    const cluster = targetMap === bleMapFS ? bleClusterGroupFS : bleClusterGroup;
    const marker = bleMarkerRegistry.get(pt.id)?.marker;
    if (marker && cluster?.zoomToShowLayer) {
      cluster.zoomToShowLayer(marker, () => {
        centerMapOnDefaultBle(targetMap, { animate: false });
      });
      return true;
    }
    return centerMapOnDefaultBle(targetMap, { animate: false });
  }

  function scheduleDefaultMapCenter(opts = {}) {
    const force = !!opts.force;
    const fromLive = !!opts.fromLive;
    if (bleDefaultCenterLocked && !force) return;
    const seq = ++bleDefaultCenterSeq;
    let attempt = 0;

    const run = () => {
      if (seq !== bleDefaultCenterSeq) return;
      if (!bleMap) {
        if (attempt++ < BLE_DEFAULT_CENTER_MAX_ATTEMPTS) {
          setTimeout(run, BLE_DEFAULT_CENTER_RETRY_MS);
        }
        return;
      }
      if (!findBlePointByNumber(BLE_DEFAULT_CENTER_BLE)) {
        if (attempt++ < BLE_DEFAULT_CENTER_MAX_ATTEMPTS) {
          setTimeout(run, BLE_DEFAULT_CENTER_RETRY_MS);
        }
        return;
      }
      const ok = focusDefaultBleOnMap(bleMap);
      if (!ok) {
        if (attempt++ < BLE_DEFAULT_CENTER_MAX_ATTEMPTS) {
          setTimeout(run, BLE_DEFAULT_CENTER_RETRY_MS);
        }
        return;
      }
      if (fromLive || force) bleDefaultCenterLocked = true;
      setTimeout(() => {
        if (!bleMap || seq !== bleDefaultCenterSeq) return;
        try {
          bleMap.invalidateSize(true);
        } catch {
          /* ignore */
        }
        centerMapOnDefaultBle(bleMap, { animate: false });
      }, 320);
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  }

  function setBleMapData(next) {
    bleMapData = next;
    invalidateMarkerRegistry();
    rebuildBleIndex();
    lastRenderKey = "";
    lastRenderKeyFS = "";
    if (bleClusterGroup) {
      try {
        bleClusterGroup.clearLayers();
      } catch {
        /* ignore */
      }
    }
    if (bleClusterGroupFS) {
      try {
        bleClusterGroupFS.clearLayers();
      } catch {
        /* ignore */
      }
    }
  }

  function scheduleInvalidateSize(map) {
    if (!map) return;
    if (pendingInvalidateRaf) cancelAnimationFrame(pendingInvalidateRaf);
    pendingInvalidateRaf = requestAnimationFrame(() => {
      pendingInvalidateRaf = 0;
      try {
        map.invalidateSize();
      } catch {
        /* ignore */
      }
    });
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

  function loadOfflineMarkerQueue() {
    try {
      const raw = localStorage.getItem(BLE_OFFLINE_MARKER_EDITS_KEY);
      if (!raw) return { version: 1, companyId: null, edits: [] };
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.edits)) return { version: 1, companyId: null, edits: [] };
      return data;
    } catch {
      return { version: 1, companyId: null, edits: [] };
    }
  }

  function saveOfflineMarkerQueue(queue) {
    try {
      localStorage.setItem(BLE_OFFLINE_MARKER_EDITS_KEY, JSON.stringify(queue));
    } catch (e) {
      console.warn("[ble-map] offline queue save", e?.message || e);
    }
  }

  function countOfflinePendingEdits() {
    return loadOfflineMarkerQueue().edits.length;
  }

  function upsertOfflineMarkerEdit(rec) {
    if (!rec?.point?.id) return;
    const q = loadOfflineMarkerQueue();
    const entry = {
      id: rec.point.id,
      ble: rec.point.ble || String(rec.point.id),
      lat: rec.lat,
      lng: rec.lng,
      origLat: rec.origLat,
      origLng: rec.origLng,
      updatedAt: new Date().toISOString(),
    };
    const idx = q.edits.findIndex((e) => e.id === entry.id);
    if (idx >= 0) q.edits[idx] = entry;
    else q.edits.push(entry);
    q.companyId = bleCompanyId ?? q.companyId;
    saveOfflineMarkerQueue(q);
    updateOfflineEditChrome();
  }

  function removeOfflineMarkerEdit(id) {
    const q = loadOfflineMarkerQueue();
    const next = q.edits.filter((e) => e.id !== id);
    if (next.length === q.edits.length) return;
    q.edits = next;
    saveOfflineMarkerQueue(q);
    updateOfflineEditChrome();
  }

  function clearOfflineMarkerEditsByIds(ids) {
    if (!ids?.length) return;
    const set = new Set(ids);
    const q = loadOfflineMarkerQueue();
    const next = q.edits.filter((e) => !set.has(e.id));
    if (next.length === q.edits.length) return;
    q.edits = next;
    saveOfflineMarkerQueue(q);
    updateOfflineEditChrome();
  }

  function mergeDirtyMarkersIntoOfflineQueue() {
    if (!bleDirtyMarkers.size) return;
    bleDirtyMarkers.forEach((rec) => upsertOfflineMarkerEdit(rec));
  }

  function applyOfflineMarkerQueueToMapData() {
    const q = loadOfflineMarkerQueue();
    if (!q.edits.length) return 0;
    let n = 0;
    for (const e of q.edits) {
      const pt = bleMapData.find((p) => p.id === e.id);
      if (!pt || e.lat == null || e.lng == null) continue;
      pt.lat = e.lat;
      pt.lng = e.lng;
      n++;
    }
    if (n) invalidateMarkerRegistry();
    return n;
  }

  function setOfflineSyncStatus(text, kind = "") {
    const el = document.getElementById("mapOfflineSyncStatus");
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      el.className = "map-offline-sync-status";
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.className = `map-offline-sync-status${kind ? ` map-offline-sync-status--${kind}` : ""}`;
  }

  function updateOfflineEditChrome() {
    const pending = countOfflinePendingEdits();
    const offline = !navigator.onLine;
    document.body.classList.toggle("ble-map--offline", offline);
    document.body.classList.toggle("ble-map--offline-pending", pending > 0);

    const saveBtn = document.getElementById("mapSaveBtn");
    if (saveBtn && bleEditMode) {
      if (offline && hasUnsavedEdits()) {
        saveBtn.textContent = "Сохранить локально";
      } else if (!offline && pending > 0) {
        saveBtn.textContent = pending === 1 ? "Отправить (1)" : `Отправить (${pending})`;
      } else {
        saveBtn.textContent = "Сохранить";
      }
    }

    if (offline || pending > 0) {
      const parts = [];
      if (offline) parts.push("Офлайн");
      if (pending) parts.push(`${pending} ${pending === 1 ? "правка" : "правок"} ждёт отправки`);
      setOfflineSyncStatus(parts.join(" · "), offline ? "offline" : "pending");
    } else {
      setOfflineSyncStatus("");
    }
  }

  async function flushOfflineMarkerEditQueue(opts = {}) {
    const q = loadOfflineMarkerQueue();
    if (!q.edits.length) return 0;
    if (!navigator.onLine) return 0;

    if (!(await ensureBleTokenForField())) {
      throw new Error("auth_failed");
    }

    const prevDirty = bleDirtyMarkers;
    bleDirtyMarkers = new Map();
    for (const e of q.edits) {
      let pt = bleMapData.find((p) => p.id === e.id);
      if (!pt) {
        pt = {
          id: e.id,
          ble: e.ble || String(e.id),
          lat: e.lat,
          lng: e.lng,
          origLat: e.origLat,
          origLng: e.origLng,
        };
      }
      bleDirtyMarkers.set(e.id, {
        point: pt,
        lat: e.lat,
        lng: e.lng,
        origLat: e.origLat,
        origLng: e.origLng,
      });
    }

    try {
      const n = await saveDirtyMarkers();
      saveOfflineMarkerQueue({ version: 1, companyId: bleCompanyId ?? q.companyId, edits: [] });
      updateOfflineEditChrome();
      if (!opts.silent && n > 0) {
        showMapMsg(`Отправлено на сервер: ${n} ${n === 1 ? "метка" : "меток"}`, "");
        setTimeout(hideMapMsg, 4000);
      }
      return n;
    } catch (e) {
      bleDirtyMarkers = prevDirty;
      throw e;
    }
  }

  function getZoneDisplayPts(z) {
    const dirty = bleDirtyZones.get(Number(z.id));
    return dirty ? dirty.pts : z.pts;
  }

  function resolveZoneRecordName(zoneId, nameHint) {
    const hint = String(nameHint ?? "").trim();
    if (hint) return hint;
    const zone = getZoneById(zoneId);
    return String(zone?.name ?? "").trim();
  }

  function markZoneDirty(zoneId, pts, name, description) {
    const id = Number(zoneId);
    const zone = getZoneById(id);
    bleDirtyZones.set(id, {
      name: resolveZoneRecordName(id, name),
      description: description ?? zone?.description ?? null,
      pts: pts.map((p) => [p[0], p[1]]),
    });
    updateEditBarState();
  }

  function isNarrowLayout() {
    return window.matchMedia("(max-width: 768px)").matches;
  }

  function isZoneEditAllowed() {
    return bleEditMode;
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

  const BLE_VERTEX_HIT_PX = 24;

  function clearZoneVertexHandles(targetMap) {
    if (!targetMap) return;
    const state = bleZoneVertexByMap.get(targetMap);
    if (!state) return;
    try {
      const c = state.container || targetMap.getContainer();
      if (c && state.onPointerDown) {
        c.removeEventListener("pointerdown", state.onPointerDown, true);
        c.removeEventListener("pointermove", state.onPointerMove, true);
        c.removeEventListener("pointerup", state.onPointerUp, true);
        c.removeEventListener("pointercancel", state.onPointerUp, true);
      }
      state.handles?.forEach((h) => {
        try {
          if (h._map) targetMap.removeLayer(h);
        } catch {
          /* ignore */
        }
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

  const bleDrawArtifacts = {
    rulers: [],
    polylines: [],
    parallels: [],
  };
  let bleDrawSession = {
    rulerStart: null,
    linePts: [],
    parallelAxis: null,
  };
  let bleDrawMapListeners = null;
  let bleDrawPreview = null;

  function formatDrawMeters(m) {
    const v = Math.max(0, m);
    if (v >= 1000) return `${(v / 1000).toFixed(2)} км`;
    if (v >= 100) return `${Math.round(v)} м`;
    return `${v.toFixed(1)} м`;
  }

  function distanceMeters(a, b) {
    const R = 6371000;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function bearingDeg(a, b) {
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function destinationLatLng(from, bearing, distM) {
    const R = 6371000;
    const br = (bearing * Math.PI) / 180;
    const lat1 = (from.lat * Math.PI) / 180;
    const lng1 = (from.lng * Math.PI) / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distM / R) +
        Math.cos(lat1) * Math.sin(distM / R) * Math.cos(br)
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(br) * Math.sin(distM / R) * Math.cos(lat1),
        Math.cos(distM / R) - Math.sin(lat1) * Math.sin(lat2)
      );
    return L.latLng((lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI);
  }

  function snapDrawLatLng(from, to, shiftKey) {
    if (!shiftKey || !from) return to;
    const brg = bearingDeg(from, to);
    const snapped = Math.round(brg / BLE_DRAW_SNAP_DEG) * BLE_DRAW_SNAP_DEG;
    const dist = distanceMeters(from, to);
    return destinationLatLng(from, snapped, dist);
  }

  function midpointLatLng(a, b) {
    return L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
  }

  function parallelSegmentThrough(axisA, axisB, point) {
    const brg = bearingDeg(axisA, axisB);
    const half = BLE_DRAW_PARALLEL_HALF_M;
    return [destinationLatLng(point, brg, half), destinationLatLng(point, brg + 180, half)];
  }

  function getBleDrawGroup(map) {
    if (!map) return null;
    let group = bleDrawGroupByMap.get(map);
    if (!group) {
      group = L.layerGroup();
      group.addTo(map);
      bleDrawGroupByMap.set(map, group);
    }
    return group;
  }

  function makeDrawLabel(text, latlng) {
    return L.marker(latlng, {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: "ble-draw-label-wrap",
        html: `<span class="ble-draw-label">${text}</span>`,
        iconSize: undefined,
      }),
    });
  }

  function drawSegmentWithLabel(group, a, b, opts = {}) {
    const line = L.polyline([a, b], {
      color: opts.color || "#ff6f00",
      weight: opts.weight ?? 2.5,
      dashArray: opts.dashArray || null,
      interactive: false,
    });
    line.addTo(group);
    const dist = distanceMeters(a, b);
    const label = makeDrawLabel(formatDrawMeters(dist), midpointLatLng(a, b));
    label.addTo(group);
    return { line, label, dist };
  }

  function renderBleDrawLayers(map) {
    const group = getBleDrawGroup(map);
    if (!group) return;
    group.clearLayers();
    bleDrawPreview = null;

    for (const seg of bleDrawArtifacts.rulers) {
      drawSegmentWithLabel(group, seg.a, seg.b, { color: "#1565c0", weight: 3 });
    }
    for (const pts of bleDrawArtifacts.polylines) {
      if (pts.length < 2) continue;
      L.polyline(pts, { color: "#ff6f00", weight: 2.5, interactive: false }).addTo(group);
      for (let i = 1; i < pts.length; i++) {
        makeDrawLabel(
          formatDrawMeters(distanceMeters(pts[i - 1], pts[i])),
          midpointLatLng(pts[i - 1], pts[i])
        ).addTo(group);
      }
    }
    for (const seg of bleDrawArtifacts.parallels) {
      drawSegmentWithLabel(group, seg.a, seg.b, { color: "#7b1fa2", dashArray: "4 8" });
    }

    if (bleDrawSession.parallelAxis?.length === 2) {
      const [a, b] = bleDrawSession.parallelAxis;
      L.polyline([a, b], {
        color: "#7b1fa2",
        weight: 2,
        dashArray: "6 6",
        interactive: false,
      }).addTo(group);
    }

    if (bleDrawSession.linePts.length >= 1) {
      const pts = [...bleDrawSession.linePts];
      const renderPts = bleDrawPreview?.cursor ? [...pts, bleDrawPreview.cursor] : pts;
      if (renderPts.length >= 2) {
        L.polyline(renderPts, { color: "#ff6f00", weight: 2.5, interactive: false }).addTo(group);
        for (let i = 1; i < renderPts.length; i++) {
          makeDrawLabel(
            formatDrawMeters(distanceMeters(renderPts[i - 1], renderPts[i])),
            midpointLatLng(renderPts[i - 1], renderPts[i])
          ).addTo(group);
        }
      }
    }

    if (bleDrawSession.rulerStart && bleDrawPreview?.cursor) {
      drawSegmentWithLabel(group, bleDrawSession.rulerStart, bleDrawPreview.cursor, {
        color: "#1565c0",
        weight: 2,
        dashArray: "5 5",
      });
    }
  }

  function renderBleDrawOnAllMaps() {
    renderBleDrawLayers(bleMap);
    if (bleMapFS) renderBleDrawLayers(bleMapFS);
  }

  function updateDrawToolButtons() {
    document.querySelectorAll("[data-draw-tool]").forEach((btn) => {
      const on = btn.dataset.drawTool === bleDrawTool;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    document.body.classList.toggle("ble-map--draw-active", !!bleDrawTool);
    document.body.classList.toggle("ble-map--draw-ruler", bleDrawTool === "ruler");
    document.body.classList.toggle("ble-map--draw-line", bleDrawTool === "line");
    document.body.classList.toggle("ble-map--draw-parallel", bleDrawTool === "parallel");
    const toZone = document.getElementById("mapDrawToZoneBtn");
    const showToZone =
      bleDrawTool === "line" && bleSelectedZoneId != null && bleDrawSession.linePts.length > 0;
    if (toZone) toZone.hidden = !showToZone;
    const finishBtn = document.getElementById("mapDrawFinishBtn");
    const clearBtn = document.getElementById("mapDrawClearBtn");
    if (finishBtn) finishBtn.hidden = bleDrawTool !== "line";
    if (clearBtn) clearBtn.hidden = !bleDrawTool;
    const extras = document.getElementById("mapDrawExtras");
    if (extras) extras.hidden = !bleDrawTool;
  }

  function updateDrawHint() {
    if (!bleDrawTool) {
      if (bleEditMode && isZoneEditAllowed()) {
        updateZoneEditHint(
          "Чертёж: линейка, линия (Shift — угол 15°), параллельные. Выберите инструмент."
        );
      }
      return;
    }
    if (bleDrawTool === "ruler") {
      updateZoneEditHint(
        bleDrawSession.rulerStart
          ? "Линейка: второй клик — конец отрезка."
          : "Линейка: первый клик — начало отрезка."
      );
      return;
    }
    if (bleDrawTool === "line") {
      updateZoneEditHint(
        "Линия: клики — вершины; Shift — ровный угол; «Готово» — завершить; «В зону» — точка в выбранную зону."
      );
      return;
    }
    if (bleDrawTool === "parallel") {
      if (!bleDrawSession.parallelAxis) {
        updateZoneEditHint("Параллельные: два клика — направление оси (∥).");
      } else {
        updateZoneEditHint("Параллельные: клик — линия через точку, параллельная оси.");
      }
    }
  }

  function resetBleDrawSession() {
    bleDrawSession = { rulerStart: null, linePts: [], parallelAxis: null };
    bleDrawPreview = null;
  }

  function detachDrawMapListeners() {
    if (!bleDrawMapListeners) return;
    const { map, onClick, onMove } = bleDrawMapListeners;
    map.off("click", onClick);
    map.off("mousemove", onMove);
    bleDrawMapListeners = null;
  }

  function attachDrawMapListeners() {
    detachDrawMapListeners();
    if (!bleDrawTool || !bleEditMode) return;
    const map = getActiveMap();
    if (!map) return;
    const onClick = (e) => {
      if (!bleDrawTool || !bleEditMode) return;
      L.DomEvent.stopPropagation(e);
      const shift = !!(e.originalEvent?.shiftKey);
      let ll = e.latlng;
      if (bleDrawTool === "ruler") {
        if (!bleDrawSession.rulerStart) {
          bleDrawSession.rulerStart = ll;
        } else {
          bleDrawArtifacts.rulers.push({ a: bleDrawSession.rulerStart, b: ll });
          bleDrawSession.rulerStart = null;
          bleDrawPreview = null;
        }
      } else if (bleDrawTool === "line") {
        if (bleDrawSession.linePts.length) {
          const prev = bleDrawSession.linePts[bleDrawSession.linePts.length - 1];
          ll = snapDrawLatLng(prev, ll, shift);
        }
        bleDrawSession.linePts.push(ll);
      } else if (bleDrawTool === "parallel") {
        if (!bleDrawSession.parallelAxis) {
          if (!bleDrawSession.linePts.length) {
            bleDrawSession.linePts = [ll];
          } else {
            const a = bleDrawSession.linePts[0];
            let b = ll;
            if (shift) b = snapDrawLatLng(a, b, true);
            bleDrawSession.parallelAxis = [a, b];
            bleDrawSession.linePts = [];
          }
        } else {
          const [axisA, axisB] = bleDrawSession.parallelAxis;
          const [p1, p2] = parallelSegmentThrough(axisA, axisB, ll);
          bleDrawArtifacts.parallels.push({ a: p1, b: p2 });
        }
      }
      updateDrawToolButtons();
      updateDrawHint();
      renderBleDrawOnAllMaps();
    };
    const onMove = (e) => {
      if (!bleDrawTool) return;
      let ll = e.latlng;
      if (bleDrawTool === "line" && bleDrawSession.linePts.length) {
        const prev = bleDrawSession.linePts[bleDrawSession.linePts.length - 1];
        if (e.originalEvent?.shiftKey) ll = snapDrawLatLng(prev, ll, true);
      }
      if (bleDrawTool === "ruler" && bleDrawSession.rulerStart) {
        bleDrawPreview = { cursor: ll };
        renderBleDrawOnAllMaps();
      } else if (bleDrawTool === "line" && bleDrawSession.linePts.length) {
        bleDrawPreview = { cursor: ll };
        renderBleDrawOnAllMaps();
      }
    };
    map.on("click", onClick);
    map.on("mousemove", onMove);
    bleDrawMapListeners = { map, onClick, onMove };
  }

  function setBleDrawTool(tool) {
    const next = bleDrawTool === tool ? null : tool;
    bleDrawTool = next;
    resetBleDrawSession();
    updateDrawToolButtons();
    updateDrawHint();
    attachDrawMapListeners();
    renderBleDrawOnAllMaps();
  }

  function finishBleDrawPolyline() {
    if (bleDrawSession.linePts.length >= 2) {
      bleDrawArtifacts.polylines.push([...bleDrawSession.linePts]);
    }
    bleDrawSession.linePts = [];
    bleDrawPreview = null;
    updateDrawToolButtons();
    renderBleDrawOnAllMaps();
    updateDrawHint();
  }

  function clearBleDrawArtifacts() {
    bleDrawArtifacts.rulers = [];
    bleDrawArtifacts.polylines = [];
    bleDrawArtifacts.parallels = [];
    resetBleDrawSession();
    renderBleDrawOnAllMaps();
    updateDrawHint();
  }

  function appendLastDrawPointToZone() {
    if (bleSelectedZoneId == null || !bleDrawSession.linePts.length) return;
    const ll = bleDrawSession.linePts[bleDrawSession.linePts.length - 1];
    const entry = bleZoneLayers.get(bleSelectedZoneId);
    if (!entry?.layer) return;
    const ring = latLngsToPts(polygonLatLngs(entry.layer));
    ring.push([ll.lat, ll.lng]);
    markZoneDirty(bleSelectedZoneId, ring);
    entry.layer.setLatLngs(ring.map((p) => L.latLng(p[0], p[1])));
    entry.data.pts = ring;
    scheduleZoneVertexHandles(entry.layer, entry.data);
    redrawMapLayers({ markers: false });
    updateZoneEditHint(`Точка добавлена в зону ${bleSelectedZoneId}. «Сохранить» — на сервер.`);
    updateDrawToolButtons();
  }

  function stopBleDrawTools() {
    bleDrawTool = null;
    detachDrawMapListeners();
    resetBleDrawSession();
    updateDrawToolButtons();
    document.body.classList.remove(
      "ble-map--draw-active",
      "ble-map--draw-ruler",
      "ble-map--draw-line",
      "ble-map--draw-parallel"
    );
  }

  function wireBleDrawUi() {
    if (document.body.dataset.bleDrawWired === "1") return;
    document.body.dataset.bleDrawWired = "1";
    document.getElementById("mapDrawFinishBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      finishBleDrawPolyline();
    });
    document.getElementById("mapDrawClearBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      clearBleDrawArtifacts();
    });
    document.getElementById("mapDrawToZoneBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      appendLastDrawPointToZone();
    });
  }

  function clientPointToLatLng(map, clientX, clientY) {
    const rect = map.getContainer().getBoundingClientRect();
    const pt = L.point(clientX - rect.left, clientY - rect.top);
    return map.containerPointToLatLng(pt);
  }

  function clientPointToContainer(map, clientX, clientY) {
    const rect = map.getContainer().getBoundingClientRect();
    return L.point(clientX - rect.left, clientY - rect.top);
  }

  function findVertexIndexNearPoint(map, layer, clientX, clientY, thresholdPx) {
    const ring = polygonLatLngs(layer);
    if (!ring.length) return -1;
    const clickPt = clientPointToContainer(map, clientX, clientY);
    let best = -1;
    let bestD = thresholdPx;
    ring.forEach((ll, i) => {
      const d = map.latLngToContainerPoint(ll).distanceTo(clickPt);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function setPolygonVertex(layer, index, latlng) {
    const ring = polygonLatLngs(layer).map((p) => L.latLng(p.lat, p.lng));
    if (index < 0 || index >= ring.length) return;
    ring[index] = latlng;
    layer.setLatLngs(ring);
  }

  function refreshVertexHandlePositions(handles, layer) {
    const ring = polygonLatLngs(layer);
    handles.forEach((h, i) => {
      if (ring[i]) h.setLatLng(ring[i]);
    });
  }

  function syncZoneVertexHandles(layer, zoneData) {
    const map = layer?._map;
    if (!map || !isZoneEditAllowed() || !zoneData) return;
    clearZoneVertexHandles(map);

    const ring = polygonLatLngs(layer);
    if (ring.length < 3) return;

    const group = L.layerGroup().addTo(map);
    const handles = [];

    ring.forEach((ll) => {
      const handle = L.circleMarker([ll.lat, ll.lng], {
        radius: 12,
        color: "#ffffff",
        weight: 3,
        opacity: 1,
        fillColor: "#ff6f00",
        fillOpacity: 1,
        interactive: false,
        className: "ble-zone-vertex-handle",
      });
      handle.addTo(group);
      handles.push(handle);
    });

    let drag = null;
    const container = map.getContainer();

    const finishDrag = () => {
      if (!drag) return;
      drag = null;
      container.style.cursor = "";
      if (map.dragging) map.dragging.enable();
      refreshVertexHandlePositions(handles, layer);
      const entry = bleZoneLayers.get(zoneData.id);
      const pts = latLngsToPts(polygonLatLngs(layer));
      if (entry) entry.data.pts = pts;
      onZoneGeometryChanged(layer);
    };

    const onPointerMove = (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (e.cancelable) e.preventDefault();
      const ll = clientPointToLatLng(map, e.clientX, e.clientY);
      if (drag.kind === "zone") {
        const dLat = ll.lat - drag.anchor.lat;
        const dLng = ll.lng - drag.anchor.lng;
        layer.setLatLngs(
          drag.startRing.map((p) => L.latLng(p.lat + dLat, p.lng + dLng))
        );
        refreshVertexHandlePositions(handles, layer);
        return;
      }
      setPolygonVertex(layer, drag.index, ll);
      refreshVertexHandlePositions(handles, layer);
    };

    const onPointerUp = (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      finishDrag();
    };

    const onPointerDown = (e) => {
      if (!isZoneEditAllowed() || bleSelectedZoneId !== zoneData.id) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const clickLl = clientPointToLatLng(map, e.clientX, e.clientY);
      const currentRing = polygonLatLngs(layer);
      const ringPts = latLngsToPts(currentRing);
      const insideZone = pointInPolygon(clickLl.lat, clickLl.lng, ringPts);
      if (e.shiftKey && insideZone) {
        e.preventDefault();
        e.stopPropagation();
        drag = {
          kind: "zone",
          pointerId: e.pointerId,
          anchor: clickLl,
          startRing: currentRing.map((p) => ({ lat: p.lat, lng: p.lng })),
        };
        container.style.cursor = "grabbing";
        if (map.dragging) map.dragging.disable();
        layer.closeTooltip?.();
        map.closeTooltip?.();
        return;
      }

      const idx = findVertexIndexNearPoint(map, layer, e.clientX, e.clientY, BLE_VERTEX_HIT_PX);
      if (idx < 0) return;
      e.preventDefault();
      e.stopPropagation();
      drag = { kind: "vertex", index: idx, pointerId: e.pointerId };
      container.style.cursor = "grabbing";
      if (map.dragging) map.dragging.disable();
      layer.closeTooltip?.();
      map.closeTooltip?.();
    };

    container.addEventListener("pointerdown", onPointerDown, true);
    container.addEventListener("pointermove", onPointerMove, true);
    container.addEventListener("pointerup", onPointerUp, true);
    container.addEventListener("pointercancel", onPointerUp, true);

    try {
      layer.closeTooltip?.();
      map.closeTooltip?.();
      group.bringToFront?.();
    } catch {
      /* ignore */
    }

    bleZoneVertexByMap.set(map, {
      group,
      layer,
      zoneId: zoneData.id,
      handles,
      container,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    });
    updateZoneEditHint(
      `Вершин: ${ring.length} — тяните оранжевые точки; Shift + перетаскивание — зона целиком.`
    );
  }

  function scheduleZoneVertexHandles(layer, zoneData) {
    syncZoneVertexHandles(layer, zoneData);
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
    renderBleMarkers();
    if (bleMap) drawZones(bleMap);
    if (bleMapFS && isMapFullscreenOpen()) drawZones(bleMapFS);
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
    updateDrawToolButtons();
    updateEditBarState();
  }

  function updateEditBarState() {
    const saveBtn = document.getElementById("mapSaveBtn");
    const pending = countOfflinePendingEdits();
    const canSave = hasUnsavedEdits() || (pending > 0 && navigator.onLine);
    if (saveBtn) saveBtn.disabled = !canSave;
    const toggle = document.getElementById("mapEditToggle");
    if (toggle) toggle.classList.toggle("active", bleEditMode);
    const toolsRow = document.getElementById("mapEditToolsRow");
    if (toolsRow) toolsRow.hidden = !bleEditMode;
    syncGenplanCalibMenuVisibility();
    syncGenplanPanelForEditMode();
    updateNativeToolbarForEdit();
    const editBtn = document.getElementById("mapEditModeBtn");
    if (editBtn) {
      editBtn.classList.toggle("active", bleEditMode);
      editBtn.setAttribute("aria-pressed", bleEditMode ? "true" : "false");
    }
    updateOfflineEditChrome();
  }

  function cancelAllEdits() {
    bleDirtyMarkers.forEach(({ point, origLat, origLng }) => {
      point.lat = origLat;
      point.lng = origLng;
      removeOfflineMarkerEdit(point.id);
    });
    bleDirtyMarkers.clear();
    [...bleDirtyZones.keys()].forEach((zid) => revertZoneGeometry(zid));
    bleDirtyZones.clear();
    stopBleDrawTools();
    clearBleDrawArtifacts();
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
    const savedIds = entries.map(([, { point }]) => point.id);
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
    clearOfflineMarkerEditsByIds(savedIds);
    return entries.length;
  }

  function formatZoneSaveError(err) {
    const raw = String(err?.message || err || "");
    if (raw.includes("BLE_ZONE_VALIDATION_NAME_EXIST")) {
      return "Конфликт имени зоны на сервере. Обновите страницу и сохраните снова.";
    }
    return raw;
  }

  async function saveDirtyZones() {
    if (!bleDirtyZones.size) return 0;
    let saved = 0;
    for (const [zoneId, dirty] of bleDirtyZones) {
      const pts = dirty.pts;
      if (pts.length < 3) throw new Error(`У зоны ${zoneId} должно быть минимум 3 точки`);
      try {
        await bleApiMutate("PUT", `/api/v1/ble_zone/${zoneId}`, {
          points: ptsToApiPoints(pts),
        });
      } catch (e) {
        if (String(e.message || "").includes("BLE_ZONE_VALIDATION_NAME_EXIST")) {
          const fresh = await bleApiFetch(`/api/v1/ble_zone/${zoneId}`);
          await bleApiMutate("PUT", `/api/v1/ble_zone/${zoneId}`, {
            name: fresh?.name || `Зона ${zoneId}`,
            description: fresh?.description ?? null,
            points: ptsToApiPoints(pts),
          });
        } else {
          throw e;
        }
      }
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
      mergeDirtyMarkersIntoOfflineQueue();

      if (!navigator.onLine) {
        const pending = countOfflinePendingEdits();
        showMapMsg(
          pending
            ? `Офлайн: ${pending} ${pending === 1 ? "правка сохранена" : "правок сохранено"} на устройстве. Отправка — при появлении сети.`
            : "Нет правок для сохранения.",
          ""
        );
        bleDirtyMarkers.clear();
        redrawMapLayers();
        updateEditBarState();
        return;
      }

      let nMarkers = await flushOfflineMarkerEditQueue({ silent: true });
      if (hasUnsavedEdits()) {
        nMarkers += await saveDirtyMarkers();
      }
      let nZone = 0;
      if (bleDirtyZones.size) {
        nZone = await saveDirtyZones();
      }
      const parts = [];
      if (nMarkers) parts.push(`меток: ${nMarkers}`);
      if (nZone) parts.push(`зон: ${nZone}`);
      if (parts.length) {
        showMapMsg(`Сохранено на сервере (${parts.join(", ")})`, "");
        setTimeout(hideMapMsg, 3500);
      }
      bleEditMapMsg = "";
      redrawMapLayers();
      updateEditBarState();
    } catch (e) {
      const msg = formatZoneSaveError(e);
      showMapMsg(
        "Ошибка сохранения: " +
          msg +
          (countOfflinePendingEdits() ? " Правки остались в очереди на устройстве." : ""),
        "error"
      );
      throw e;
    } finally {
      if (btn) {
        updateEditBarState();
      }
    }
  }

  function redrawMapLayers(opts = {}) {
    const drawMarkers = opts.markers !== false;
    const drawZonesFlag = opts.zones !== false;
    if (drawMarkers) {
      renderBleMarkers();
      if (isMapFullscreenOpen()) renderFsMarkers();
    }
    if (drawZonesFlag) {
      if (bleMap) drawZones(bleMap);
      if (bleMapFS && isMapFullscreenOpen()) drawZones(bleMapFS);
    }
  }

  function setEditMode(on, opts = {}) {
    if (on === bleEditMode) return;
    if (!on && hasUnsavedEdits() && !opts.skipConfirm) {
      if (!window.confirm("Отменить несохранённые изменения?")) return;
      cancelAllEdits();
    }
    if (on) {
      const mobile = isCoarseMobile();
      const offlineHint = !navigator.onLine
        ? "\n\nСейчас без сети: метки можно двигать, правки сохранятся на телефоне и уйдут на сервер, когда появится интернет."
        : "";
      const confirmText = mobile
        ? `Режим редактирования меток VSM.\n\n• Удержите метку 1 сек., затем перетащите${offlineHint}\n\nПродолжить?`
        : `Режим редактирования меняет данные на сервере VSM.\n\n• Метки: удержите 1 сек., затем перетащите\n• Зоны: оранжевые точки — вершины; Shift + перетаскивание — зона целиком\n• «Сохранить» — записать на сервер (или локально без сети)${offlineHint}\n\nПродолжить?`;
      if (!opts.skipConfirm && !window.confirm(confirmText)) {
        return;
      }
    }
    bleEditMode = on;
    applyBleMapZoomLimits(bleEditMode);
    document.body.classList.toggle("ble-map--edit", bleEditMode);
    document.body.classList.toggle("ble-map--zone-edit", bleEditMode && isZoneEditAllowed());
    if (bleEditMode) {
      if (bleBaseLayerCurrent === "street" && !opts.keepBaseLayer) {
        setBleBaseLayer("hybrid");
      }
      enterEmbeddedEditLayout();
      syncZoneEditUiClasses();
      updateDrawHint();
      bleEditMapMsg = isCoarseMobile()
        ? navigator.onLine
          ? "Удержите метку 1 сек., перетащите. «Сохранить» — на сервер."
          : "Офлайн: удержите метку 1 сек., перетащите. Правки сохранятся на устройстве."
        : navigator.onLine
          ? "Метки: удержите 1 сек. Зоны: вершины; Shift — перетащить. «Сохранить» — на сервер."
          : "Офлайн: метки можно двигать; «Сохранить локально» — в очередь на отправку.";
      hideMapMsg();
    } else {
      if (bleGenplanCalibMode) finishGenplanCalibMode({ save: false });
      stopBleDrawTools();
      closeAllToolsMenus();
      clearBleDrawArtifacts();
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
    if (bleEditMode) updateNativeToolbarForEdit();
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
      const layerMode = bleBaseLayerCurrent;
      const zoneStyle = getZonePolygonStyle(z, {
        dimmed,
        forEdit,
        isSelected,
        layerMode,
        ptCount: pts.length,
      });
      const layer = L.polygon(pts, {
        color: zoneStyle.color,
        fillColor: zoneStyle.fillColor,
        opacity: zoneStyle.opacity,
        fillOpacity: zoneStyle.fillOpacity,
        weight: zoneStyle.weight,
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
          if (bleDrawTool) return;
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

  function isMainSitePolygonZone(z) {
    const label = `${z.name || ""} ${z.description || ""}`.toLowerCase();
    return label.includes("spg_tsb") || label.includes("spg-tsb");
  }

  function isMarkerClusterZone(z, ptCount) {
    return ptCount > BLE_ZONE_SMALL_MAX_PTS;
  }

  function isSmallZonePolygon(z, ptCount) {
    return ptCount >= 3 && ptCount <= BLE_ZONE_SMALL_MAX_PTS && !isMainSitePolygonZone(z);
  }

  function getZonePolygonStyle(z, ctx) {
    const isSatellite = ctx.layerMode === "satellite";
    const isHybrid = ctx.layerMode === "hybrid";
    const isGenplan = ctx.layerMode === "genplan";
    const onPhoto = isSatellite || isHybrid || isGenplan;
    const stroke = ctx.isSelected ? "#ffffff" : onPhoto ? BLE_ZONE_NEON : z.color || BLE_ZONE_NEON;
    const fillColor = isHybrid ? BLE_ZONE_NEON_FILL : z.color || BLE_ZONE_NEON_FILL;
    const weight = ctx.isSelected ? 2 : onPhoto ? 1.15 : 1.75;
    const strokeOpacity = ctx.dimmed ? 0.32 : onPhoto ? 0.94 : 0.72;

    if (isSatellite) {
      return {
        color: stroke,
        fillColor,
        opacity: strokeOpacity,
        fillOpacity: 0,
        weight,
      };
    }

    if (isMainSitePolygonZone(z) || isMarkerClusterZone(z, ctx.ptCount)) {
      return {
        color: stroke,
        fillColor,
        opacity: strokeOpacity,
        fillOpacity: 0,
        weight,
      };
    }

    if (isSmallZonePolygon(z, ctx.ptCount) && isHybrid) {
      const fill = ctx.dimmed ? 0.08 : ctx.forEdit ? 0.34 : 0.28;
      return {
        color: stroke,
        fillColor,
        opacity: strokeOpacity,
        fillOpacity: fill,
        weight: ctx.isSelected ? 2 : 1.35,
      };
    }

    if (isHybrid) {
      return {
        color: stroke,
        fillColor,
        opacity: strokeOpacity,
        fillOpacity: ctx.dimmed ? 0.04 : ctx.forEdit ? 0.12 : 0.08,
        weight,
      };
    }

    return {
      color: ctx.isSelected ? "#ffffff" : z.color || BLE_ZONE_NEON,
      fillColor: z.color || BLE_ZONE_NEON_FILL,
      opacity: ctx.dimmed ? 0.2 : 0.75,
      fillOpacity: ctx.dimmed ? 0.05 : ctx.forEdit ? 0.2 : 0.14,
      weight: ctx.isSelected ? 2.5 : 1.75,
    };
  }

  async function fetchBleGenplanMeta() {
    try {
      const res = await fetch(`${BLE_GENPLAN_META_URL}?v=${BLE_MAP_BUILD}`, { cache: "no-cache" });
      if (!res.ok) return null;
      const meta = await res.json();
      if (
        !meta ||
        !Array.isArray(meta.southWest) ||
        meta.southWest.length < 2 ||
        !Array.isArray(meta.northEast) ||
        meta.northEast.length < 2
      ) {
        return null;
      }
      return meta;
    } catch {
      return null;
    }
  }

  function buildGenplanOverlay() {
    return L.layerGroup();
  }

  function ensureBleGenplanMask() {
    if (bleGenplanMask || !bleGenplanMeta || !window.BleGenplanMask) return;
    bleGenplanMask = window.BleGenplanMask.create({
      getMap: () => bleMap,
      getMapFs: () => bleMapFS,
      getMeta: () => bleGenplanMeta,
      getBuild: () => BLE_MAP_BUILD,
      getEditMode: () => bleEditMode,
      onSaved: () => updateGenplanMaskVisibility(),
      onCancel: () => finishGenplanCalibMode({ save: false }),
    });
    bleGenplanMask.init();
    syncGenplanPanelForEditMode();
  }

  function syncGenplanPanelForEditMode() {
    if (!bleEditMode || !bleGenplanCalibMode) {
      bleGenplanCalibMode = false;
      document.body.classList.remove("ble-map--genplan-calib", "ble-map--genplan-calib-expanded");
      const panel = document.getElementById("mapGenplanMaskPanel");
      if (panel) panel.setAttribute("hidden", "");
    }
    if (!bleGenplanMask) return;
    if (!bleEditMode || !bleGenplanCalibMode) {
      bleGenplanMask.setSettingsOpen(false);
      bleGenplanMask.setEditMode(false);
    }
  }

  function updateGenplanMaskVisibility() {
    if (!bleGenplanMask) return;
    if (bleMap) {
      bleGenplanMask.attachMap(bleMap);
      const show = bleGenplanCalibMode || bleBaseLayerCurrent === "genplan";
      bleGenplanMask.setVisibleOnMap(bleMap, show);
    }
    if (bleMapFS) {
      bleGenplanMask.attachMap(bleMapFS);
      const show = bleGenplanCalibMode || fsTileLayerCurrent === "genplan";
      bleGenplanMask.setVisibleOnMap(bleMapFS, show);
    }
    bleGenplanMask.renderAll();
  }

  function remountGenplanLayers() {
    if (!bleGenplanMeta) return;
    if (bleTileLayers) bleTileLayers.genplan = buildGenplanOverlay();
    if (fsTileLayers) fsTileLayers.genplan = buildGenplanOverlay();
    updateGenplanMaskVisibility();
    if (bleBaseLayerCurrent === "genplan" && bleMap) {
      applyBleBaseLayerToMap(bleMap, bleTileLayers, "genplan", "");
    }
    if (fsTileLayerCurrent === "genplan" && bleMapFS) {
      applyBleBaseLayerToMap(bleMapFS, fsTileLayers, "genplan", "");
    }
  }

  function finishGenplanCalibMode(opts = {}) {
    if (!bleGenplanMeta || !bleGenplanMask) return;
    if (opts.save) bleGenplanMask.save();
    setGenplanCalibMode(false, { save: false, restoreLayer: opts.restoreLayer !== false });
  }

  function positionGenplanPanel() {
    const panel = document.getElementById("mapGenplanMaskPanel");
    const anchor = document.getElementById("mapToolsPicker") || document.getElementById("mapEditTools");
    if (!panel || !anchor || panel.hidden) return;
    const r = anchor.getBoundingClientRect();
    const panelH = panel.offsetHeight || 220;
    const gap = 6;
    let top = r.bottom + gap;
    if (top + panelH > window.innerHeight - 8) {
      top = Math.max(8, r.top - panelH - gap);
    }
    panel.style.position = "fixed";
    panel.style.zIndex = "100010";
    panel.style.top = `${top}px`;
    panel.style.left = `${Math.max(8, r.left)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  function setGenplanCalibMode(on, opts = {}) {
    if (!bleGenplanMeta) return;
    ensureBleGenplanMask();
    if (!bleGenplanMask) return;
    const menuBtn = document.getElementById("mapGenplanCalibMenuBtn");
    if (on) {
      if (!bleEditMode) return;
      bleGenplanCalibMode = true;
      bleGenplanCalibSavedLayer = bleBaseLayerCurrent;
      setBleBaseLayer("hybrid", { syncUi: opts.syncUi !== false });
      bleGenplanMask.setSettingsOpen(true);
      bleGenplanMask.setEditMode(true);
      updateGenplanMaskVisibility();
      menuBtn?.setAttribute("aria-pressed", "true");
      updateDrawToolButtons();
      requestAnimationFrame(positionGenplanPanel);
      return;
    }
    bleGenplanCalibMode = false;
    bleGenplanMask.setSettingsOpen(false);
    bleGenplanMask.setEditMode(false);
    menuBtn?.setAttribute("aria-pressed", "false");
    updateGenplanMaskVisibility();
    updateDrawToolButtons();
    const restore = bleGenplanCalibSavedLayer || "genplan";
    bleGenplanCalibSavedLayer = null;
    if (opts.restoreLayer !== false) {
      setBleBaseLayer(normalizeBaseLayerId(restore), { syncUi: opts.syncUi !== false });
    }
  }

  function syncGenplanCalibMenuVisibility() {
    const show = isGenplanLayerAvailable() && bleEditMode;
    const opt = document.getElementById("mapEditToolsGenplanOpt");
    if (opt) opt.hidden = !show;
  }

  function updateNativeToolbarForEdit() {
    const layerActions = document.getElementById("mapLayerFieldActions");
    const layerDock = document.getElementById("mapLayerFieldDock");
    const toolsField = document.getElementById("mapToolsFieldDock");
    if (layerActions) layerActions.hidden = bleEditMode;
    if (layerDock) layerDock.hidden = !bleEditMode;
    if (toolsField) toolsField.hidden = !bleEditMode;
    syncGenplanCalibMenuVisibility();
  }

  function wireGenplanCalibUi() {
    if (document.body.dataset.genplanCalibWired === "1") return;
    document.body.dataset.genplanCalibWired = "1";
    document.getElementById("mapGenplanMaskSaveBtn")?.addEventListener("click", () => {
      if (!bleGenplanMask) return;
      if (bleGenplanMask.save()) {
        bleGenplanMask.showMsg("Настройки генплана сохранены");
        finishGenplanCalibMode({ save: false });
      } else {
        bleGenplanMask.showMsg("Не удалось сохранить", "err");
      }
    });
    document.getElementById("mapGenplanMaskCancelBtn")?.addEventListener("click", () => {
      bleGenplanMask?.reloadFromStorage();
      finishGenplanCalibMode({ save: false });
    });
  }

  function tileLayerZoomOpts(mobile, nativeZoom) {
    return {
      updateWhenIdle: mobile,
      updateWhenZooming: true,
      keepBuffer: 4,
      minZoom: BLE_MAP_MIN_ZOOM,
      maxZoom: BLE_MAP_EDIT_MAX_ZOOM,
      maxNativeZoom: nativeZoom,
    };
  }

  function createBleSatelliteUnderlay(mobile) {
    return L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Esri",
        opacity: 0.38,
        ...tileLayerZoomOpts(mobile, BLE_SATELLITE_NATIVE_ZOOM),
      }
    );
  }

  function applyBleMapZoomLimits(forEdit) {
    const maxZ = forEdit ? BLE_MAP_EDIT_MAX_ZOOM : BLE_MAP_MAX_ZOOM;
    for (const map of [bleMap, bleMapFS]) {
      if (!map) continue;
      map.setMinZoom(BLE_MAP_MIN_ZOOM);
      map.setMaxZoom(maxZ);
    }
  }

  function buildBleTileLayers(mobile) {
    const satellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Esri", ...tileLayerZoomOpts(mobile, BLE_SATELLITE_NATIVE_ZOOM) }
    );
    const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      ...tileLayerZoomOpts(mobile, BLE_STREET_NATIVE_ZOOM),
    });
    const layers = { satellite, street, hybrid: satellite, satelliteUnderlay: null };
    if (bleGenplanMeta) {
      layers.genplan = buildGenplanOverlay();
    }
    return layers;
  }

  function isGenplanLayerAvailable() {
    return !!bleGenplanMeta;
  }

  function normalizeBaseLayerId(layerId) {
    if (layerId === "genplan" && !isGenplanLayerAvailable()) return "hybrid";
    if (BLE_BASE_LAYERS.includes(layerId)) return layerId;
    return "street";
  }

  function syncGenplanLayerMenuVisibility() {
    const show = isGenplanLayerAvailable();
    document
      .querySelectorAll(
        "#mapBaseLayerGenplanOpt, #mapBaseLayerGenplanOptActions, #mapFsBaseLayerGenplanOpt"
      )
      .forEach((opt) => {
        opt.hidden = !show;
      });
    syncGenplanCalibMenuVisibility();
  }

  const MAP_LAYER_SELECT_IDS = [
    "mapBaseLayerSelect",
    "mapBaseLayerSelectActions",
    "mapFsBaseLayerSelect",
  ];

  function readStoredBaseLayer() {
    try {
      const stored = localStorage.getItem(BLE_BASE_LAYER_KEY);
      return normalizeBaseLayerId(stored);
    } catch {
      /* ignore */
    }
    return "street";
  }

  function usesFixedLayerMenu() {
    return (
      document.body.classList.contains("ble-map--edit") ||
      isCoarseMobile() ||
      window.matchMedia("(max-width: 768px)").matches
    );
  }

  function resetLayerMenuPosition(menu) {
    if (!menu) return;
    menu.style.position = "";
    menu.style.top = "";
    menu.style.right = "";
    menu.style.left = "";
    menu.style.bottom = "";
    menu.style.zIndex = "";
  }

  function positionLayerMenu(picker) {
    const btn = picker.querySelector(".map-layer-mode-btn");
    const menu = picker.querySelector(".map-layer-menu");
    if (!btn || !menu || !usesFixedLayerMenu()) return;
    const r = btn.getBoundingClientRect();
    const menuH = menu.offsetHeight || 132;
    const gap = 4;
    const below = r.bottom + gap;
    const above = r.top - menuH - gap;
    const openUp = below + menuH > window.innerHeight - 8 && above > 8;
    menu.style.position = "fixed";
    menu.style.zIndex = "12000";
    menu.style.top = `${openUp ? above : below}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    menu.style.left = "auto";
    menu.style.bottom = "auto";
  }

  function closeAllLayerMenus() {
    document.body.classList.remove("ble-map-layer-menu-open");
    document.querySelectorAll(".map-layer-picker").forEach((picker) => {
      const btn = picker.querySelector(".map-layer-mode-btn");
      const menu = picker.querySelector(".map-layer-menu");
      picker.classList.remove("map-layer-picker--open");
      hideMapDropdownMenu(menu);
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  function resetToolsMenuPosition(menu) {
    if (!menu) return;
    menu.style.position = "";
    menu.style.top = "";
    menu.style.right = "";
    menu.style.left = "";
    menu.style.bottom = "";
    menu.style.zIndex = "";
  }

  function closeAllToolsMenus() {
    document.body.classList.remove("ble-map-tools-menu-open");
    document.querySelectorAll("[data-tools-picker]").forEach((picker) => {
      const btn = picker.querySelector(".map-tools-mode-btn");
      const menu = picker.querySelector(".map-tools-menu");
      picker.classList.remove("map-tools-picker--open");
      hideMapDropdownMenu(menu);
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  function closeAllMapDropdowns() {
    closeAllLayerMenus();
    closeAllToolsMenus();
  }

  function positionToolsMenu(picker) {
    const btn = picker.querySelector(".map-tools-mode-btn");
    const menu = picker.querySelector(".map-tools-menu");
    if (!btn || !menu || !usesFixedLayerMenu()) return;
    const r = btn.getBoundingClientRect();
    const menuH = menu.offsetHeight || 200;
    const gap = 4;
    const below = r.bottom + gap;
    const above = r.top - menuH - gap;
    const openUp = below + menuH > window.innerHeight - 8 && above > 8;
    menu.style.position = "fixed";
    menu.style.zIndex = "12000";
    menu.style.top = `${openUp ? above : below}px`;
    menu.style.left = `${Math.max(8, r.left)}px`;
    menu.style.right = "auto";
    menu.style.bottom = "auto";
  }

  function revealMapDropdownMenu(menu) {
    if (!menu) return;
    menu.hidden = false;
    menu.style.display = "block";
    menu.style.visibility = "visible";
  }

  function hideMapDropdownMenu(menu) {
    if (!menu) return;
    menu.hidden = true;
    menu.style.display = "";
    menu.style.visibility = "";
    if (menu.classList.contains("map-layer-menu")) resetLayerMenuPosition(menu);
    else resetToolsMenuPosition(menu);
  }

  function openToolsMenu(picker) {
    const btn = picker.querySelector(".map-tools-mode-btn");
    const menu = picker.querySelector(".map-tools-menu");
    if (!btn || !menu) return;
    closeAllMapDropdowns();
    revealMapDropdownMenu(menu);
    btn.setAttribute("aria-expanded", "true");
    picker.classList.add("map-tools-picker--open");
    document.body.classList.add("ble-map-tools-menu-open");
    requestAnimationFrame(() => positionToolsMenu(picker));
  }

  function toggleToolsMenu(picker) {
    const btn = picker.querySelector(".map-tools-mode-btn");
    if (!btn) return;
    if (btn.getAttribute("aria-expanded") === "true") {
      closeAllToolsMenus();
      return;
    }
    openToolsMenu(picker);
  }

  function wireNativeToolbarControls() {
    MAP_LAYER_SELECT_IDS.forEach((id) => {
      const sel = document.getElementById(id);
      if (!sel || sel.dataset.nativeWired === "1") return;
      sel.dataset.nativeWired = "1";
      sel.addEventListener("change", () => {
        const layerId = normalizeBaseLayerId(sel.value);
        if (BLE_BASE_LAYERS.includes(layerId)) {
          setBleBaseLayer(layerId);
          syncBaseLayerPickers(layerId);
        }
      });
    });

    const toolsSel = document.getElementById("mapEditToolsSelect");
    if (toolsSel && toolsSel.dataset.nativeWired !== "1") {
      toolsSel.dataset.nativeWired = "1";
      toolsSel.addEventListener("change", () => {
        const action = toolsSel.value;
        toolsSel.value = "";
        if (!action) return;
        if (action === "genplan-calib") {
          if (!bleEditMode) return;
          if (bleGenplanCalibMode) finishGenplanCalibMode({ save: false });
          else setGenplanCalibMode(true);
          return;
        }
        if (!bleEditMode) return;
        setBleDrawTool(action);
      });
    }
  }

  function wireMapDropdownUi() {
    wireNativeToolbarControls();
  }

  function wireMapToolsPickers() {
    wireNativeToolbarControls();
  }

  function openLayerMenu(picker) {
    const btn = picker.querySelector(".map-layer-mode-btn");
    const menu = picker.querySelector(".map-layer-menu");
    if (!btn || !menu) return;
    closeAllMapDropdowns();
    revealMapDropdownMenu(menu);
    btn.setAttribute("aria-expanded", "true");
    picker.classList.add("map-layer-picker--open");
    document.body.classList.add("ble-map-layer-menu-open");
    requestAnimationFrame(() => positionLayerMenu(picker));
  }

  function toggleLayerMenu(picker) {
    const btn = picker.querySelector(".map-layer-mode-btn");
    if (!btn) return;
    if (btn.getAttribute("aria-expanded") === "true") {
      closeAllLayerMenus();
      return;
    }
    openLayerMenu(picker);
  }

  function syncBaseLayerPickers(layerId) {
    layerId = normalizeBaseLayerId(layerId);
    MAP_LAYER_SELECT_IDS.forEach((id) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const opt = sel.querySelector(`option[value="${layerId}"]`);
      if (opt && !opt.hidden) sel.value = layerId;
    });
  }

  function wireMapLayerPicker(picker) {
    if (!picker) return;
    picker.dataset.layerPickerWired = "1";
  }

  function wireBaseLayerPickers() {
    wireMapDropdownUi();
    document.querySelectorAll(".map-layer-picker").forEach(wireMapLayerPicker);
    wireMapToolsPickers();
  }
  window.wireMapLayerPicker = wireMapLayerPicker;
  window.syncBaseLayerPickers = syncBaseLayerPickers;

  function syncBaseLayerBodyClass(layerId) {
    document.body.classList.toggle("ble-map--layer-hybrid", layerId === "hybrid");
    document.body.classList.toggle("ble-map--layer-satellite", layerId === "satellite");
    document.body.classList.toggle("ble-map--layer-genplan", layerId === "genplan");
  }

  function applyBleBaseLayerToMap(map, tileLayers, nextId, prevId) {
    if (!map || !tileLayers || nextId === prevId) return prevId;
    if (tileLayers[prevId]) map.removeLayer(tileLayers[prevId]);
    if (map._bleGenplanUnderlay) {
      try {
        map.removeLayer(map._bleGenplanUnderlay);
      } catch {
        /* ignore */
      }
      map._bleGenplanUnderlay = null;
    }
    if (nextId === "genplan" && tileLayers.genplan) {
      if (!tileLayers.satelliteUnderlay) {
        tileLayers.satelliteUnderlay = createBleSatelliteUnderlay(isCoarseMobile());
      }
      map._bleGenplanUnderlay = tileLayers.satelliteUnderlay;
      map._bleGenplanUnderlay.addTo(map);
      ensureBleGenplanMask();
      updateGenplanMaskVisibility();
    } else if (tileLayers[nextId]) {
      tileLayers[nextId].addTo(map);
    }
    return nextId;
  }

  function setBleBaseLayer(layerId, opts = {}) {
    layerId = normalizeBaseLayerId(layerId);
    if (!BLE_BASE_LAYERS.includes(layerId)) return;
    const prevMain = bleBaseLayerCurrent;
    const prevFs = fsTileLayerCurrent;
    if (layerId === prevMain && layerId === prevFs && !opts.force) return;
    if (layerId === "genplan" && bleMap && !bleTileLayers?.genplan) {
      layerId = "hybrid";
    }
    if (layerId === "genplan" && bleGenplanMeta) {
      if (bleTileLayers) bleTileLayers.genplan = buildGenplanOverlay();
      if (fsTileLayers) fsTileLayers.genplan = buildGenplanOverlay();
    }

    bleBaseLayerCurrent = layerId;
    fsTileLayerCurrent = layerId;

    if (bleMap && bleTileLayers) {
      bleBaseLayerCurrent = applyBleBaseLayerToMap(bleMap, bleTileLayers, layerId, prevMain);
    }
    if (bleMapFS && fsTileLayers) {
      fsTileLayerCurrent = applyBleBaseLayerToMap(bleMapFS, fsTileLayers, layerId, prevFs);
    }

    if (opts.syncUi !== false) syncBaseLayerPickers(layerId);
    syncBaseLayerBodyClass(layerId);
    try {
      localStorage.setItem(BLE_BASE_LAYER_KEY, layerId);
    } catch {
      /* ignore */
    }
    updateGenplanMaskVisibility();
    if (layerId !== prevMain || layerId !== prevFs) {
      redrawMapLayers({ markers: false });
    }
  }
  window.setBleBaseLayer = setBleBaseLayer;


  function mountBleBaseLayer(map, tileLayers, layerId) {
    if (!map || !tileLayers?.[layerId]) return layerId;
    return applyBleBaseLayerToMap(map, tileLayers, layerId, "");
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
      fadeAnimation: false,
      markerZoomAnimation: !mobile,
      wheelPxPerZoomLevel: 80,
      minZoom: BLE_MAP_MIN_ZOOM,
      maxZoom: BLE_MAP_MAX_ZOOM,
    }).setView(center, zoom);
    applyBleMapZoomLimits(bleEditMode);
    L.control
      .zoom({
        position: mobile ? "bottomright" : "topright",
      })
      .addTo(bleMap);
    bleTileLayers = buildBleTileLayers(mobile);
    bleBaseLayerCurrent = readStoredBaseLayer();
    mountBleBaseLayer(bleMap, bleTileLayers, bleBaseLayerCurrent);
    wireBaseLayerPickers();
    syncBaseLayerPickers(bleBaseLayerCurrent);
    syncBaseLayerBodyClass(bleBaseLayerCurrent);
    setTimeout(() => bleMap.invalidateSize(), 200);
  }

  function classifyBle(point, prev) {
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
      photoTag: resolvePhotoUrl(point, ["ble_image_url", "bleImageUrl", "ble_image"], prev?.photoTag),
      photoPlace: resolvePhotoUrl(
        point,
        ["location_image_url", "locationImageUrl", "location_image"],
        prev?.photoPlace
      ),
      routeId: point.bleRoute?.id ?? null,
      routeTitle: point.bleRoute?.title || "",
      zoneId: point.ble_zone_id ?? point.ble_zoneId ?? null,
    };
  }

  function createBleIcon(point, editTouchTarget = false) {
    const hitSize = editTouchTarget ? (isCoarseMobile() ? 30 : 26) : BLE_DOT_PX;
    const anchor = hitSize / 2;
    return L.divIcon({
      className: editTouchTarget ? "ble-marker-icon--edit" : "",
      html: `<div class="ble-dot ble-dot-${point.status}">${point.ble}</div>`,
      iconSize: [hitSize, hitSize],
      iconAnchor: [anchor, anchor],
    });
  }

  window.openPhotoViewer = function openPhotoViewer(url) {
    const img = document.getElementById("photoViewerImg");
    const overlay = document.getElementById("photoViewerOverlay");
    if (!img || !overlay) return;
    img.src = photoSrcForDisplay(url) || url;
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
  };

  function closePhotoViewer() {
    document.getElementById("photoViewerOverlay")?.classList.remove("open");
    document.body.style.overflow = "";
  }

  function needsPhotoRefresh(pt) {
    const urls = [pt.photoTag, pt.photoPlace].filter(Boolean);
    if (!urls.length) return true;
    return urls.some(isPhotoUrlExpired);
  }

  function isYandexPhotoUrl(url) {
    try {
      return new URL(String(url)).hostname.toLowerCase().includes("storage.yandexcloud.net");
    } catch {
      return false;
    }
  }

  function toBlePhotoProxyUrl(url) {
    if (!url || !isYandexPhotoUrl(url)) return url;
    return (
      BLE_SUPABASE_BASE +
      "?path=" +
      encodeURIComponent("/ble-image") +
      "&url=" +
      encodeURIComponent(url)
    );
  }

  function isOfflineFirstMode() {
    try {
      return sessionStorage.getItem(BLE_OFFLINE_FIRST_KEY) === "1";
    } catch {
      return false;
    }
  }

  function photoSrcForDisplay(url) {
    if (!url) return "";
    const local = fieldPhotoBlobUrls.get(url);
    if (local) return local;
    if (!navigator.onLine && isYandexPhotoUrl(url)) return toBlePhotoProxyUrl(url);
    return url;
  }

  async function fetchBleListLive(companyId) {
    const cid = companyId ?? bleCompanyId;
    if (!cid) return null;
    try {
      await ensureBleTokenForField();
      const rawBle = await bleApiFetch(`/api/v1/map/ble/${cid}`);
      if (Array.isArray(rawBle) && rawBle.length) {
        bleListSnapshot = { at: Date.now(), raw: rawBle, companyId: cid, live: true };
        return rawBle;
      }
    } catch (e) {
      console.warn("[ble-map] live BLE list", e?.message || e);
    }
    return null;
  }

  function revokeFieldPhotoBlobUrls() {
    fieldPhotoBlobUrls.forEach((blobUrl) => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        /* ignore */
      }
    });
    fieldPhotoBlobUrls.clear();
  }

  function openFieldDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("indexeddb_unavailable"));
        return;
      }
      const req = indexedDB.open(BLE_FIELD_DB, 1);
      req.onerror = () => reject(req.error || new Error("idb_open"));
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(BLE_FIELD_META_STORE)) {
          db.createObjectStore(BLE_FIELD_META_STORE);
        }
        if (!db.objectStoreNames.contains(BLE_FIELD_PHOTOS_STORE)) {
          db.createObjectStore(BLE_FIELD_PHOTOS_STORE);
        }
      };
    });
  }

  function idbGet(store, key) {
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGetAll(store) {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGetAllKeys(store) {
    return new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadFieldPackMeta() {
    if (fieldPackMetaCache) return fieldPackMetaCache;
    try {
      const db = await openFieldDb();
      const tx = db.transaction(BLE_FIELD_META_STORE, "readonly");
      const meta = await idbGet(tx.objectStore(BLE_FIELD_META_STORE), BLE_FIELD_PACK_KEY);
      db.close();
      fieldPackMetaCache =
        meta && meta.version >= 1 && meta.version <= BLE_FIELD_PACK_VERSION ? meta : null;
      return fieldPackMetaCache;
    } catch (e) {
      console.warn("[ble-map] field pack meta", e?.message || e);
      return null;
    }
  }

  async function hydrateFieldPhotoBlobUrls() {
    const meta = await loadFieldPackMeta();
    if (!meta?.photosOk) return 0;
    return meta.photosOk;
  }

  async function clearFieldPackPhotosDb() {
    const db = await openFieldDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BLE_FIELD_PHOTOS_STORE, "readwrite");
      const req = tx.objectStore(BLE_FIELD_PHOTOS_STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  }

  async function resetFieldPackStorage() {
    revokeFieldPhotoBlobUrls();
    fieldPackMetaCache = null;
    setFieldPackStatus("Очистка старого пакета…", "busy");
    await yieldToMain();
    try {
      const db = await openFieldDb();
      db.close();
    } catch {
      /* ignore */
    }
    await new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      const req = indexedDB.deleteDatabase(BLE_FIELD_DB);
      req.onsuccess = finish;
      req.onerror = finish;
      req.onblocked = () => {
        setFieldPackStatus("Закройте другие вкладки с картой…", "busy");
      };
      setTimeout(finish, isCoarseMobile() ? 15000 : 8000);
    });
    await yieldToMain();
  }

  function slimBlePointForFieldPack(p) {
    if (!p) return null;
    return {
      id: p.id,
      ble_number: p.ble_number ?? p.bleNumber,
      latitude: p.latitude,
      longitude: p.longitude,
      name_extended: p.name_extended,
      charge_value: p.charge_value,
      record_dt: p.record_dt,
      location_desc: p.location_desc,
      ble_type_desc: p.ble_type_desc,
      mac_address: p.mac_address,
      ble_image_url: p.ble_image_url,
      bleImageUrl: p.bleImageUrl,
      ble_image: p.ble_image,
      location_image_url: p.location_image_url,
      locationImageUrl: p.locationImageUrl,
      location_image: p.location_image,
      bleRoute: p.bleRoute,
      ble_zone_id: p.ble_zone_id ?? p.ble_zoneId,
    };
  }

  function slimBleRawForFieldPack(raw) {
    return raw.map(slimBlePointForFieldPack).filter(Boolean);
  }

  async function loadFieldPackMarkers() {
    try {
      const db = await openFieldDb();
      const tx = db.transaction(BLE_FIELD_META_STORE, "readonly");
      const markers = await idbGet(tx.objectStore(BLE_FIELD_META_STORE), BLE_FIELD_MARKERS_KEY);
      db.close();
      if (Array.isArray(markers) && markers.length) return markers;
    } catch (e) {
      console.warn("[ble-map] field markers load", e?.message || e);
    }
    const meta = fieldPackMetaCache || (await loadFieldPackMeta());
    return meta?.raw?.length ? meta.raw : null;
  }

  async function commitFieldPackMarkers(slimRaw) {
    const db = await openFieldDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BLE_FIELD_META_STORE, "readwrite");
      tx.objectStore(BLE_FIELD_META_STORE).put(slimRaw, BLE_FIELD_MARKERS_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async function resolveRawForFieldPackDownload(cid, opts = {}) {
    await yieldToMain();
    const forceFresh = !!opts.forceFresh;

    if (!forceFresh) {
      const snap = bleListSnapshot;
      if (snap?.raw?.length && Number(snap.companyId) === Number(cid)) {
        const urls = collectPhotoUrlsFromRaw(snap.raw, { tagOnly: false });
        const liveRecent = snap.live && Date.now() - snap.at < 25 * 60 * 1000;
        if (urls.length >= 80 && (liveRecent || urls.length >= snap.raw.length * 0.15)) {
          setFieldPackStatus(`Метки уже на карте (${snap.raw.length})…`, "busy");
          await yieldToMain();
          return snap.raw;
        }
      }
    }

    setFieldPackStatus("Авторизация…", "busy");
    await yieldToMain();
    if (!(await ensureBleTokenForField())) return null;

    setFieldPackStatus("Загрузка списка API…", "busy");
    await yieldToMain();
    const live = await fetchBleListLive(cid);
    if (live?.length) {
      await yieldToMain();
      return live;
    }

    setFieldPackStatus("Резервный кэш меток…", "busy");
    await yieldToMain();
    const off = await fetchBleListOffline(cid);
    return off?.data?.length ? off.data : null;
  }

  async function appendFieldPackPhotosBatch(entries) {
    if (!entries.length) return;
    const db = await openFieldDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BLE_FIELD_PHOTOS_STORE, "readwrite");
      const store = tx.objectStore(BLE_FIELD_PHOTOS_STORE);
      for (const [url, blob] of entries) store.put(blob, url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async function commitFieldPackMeta(meta) {
    const db = await openFieldDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BLE_FIELD_META_STORE, "readwrite");
      const req = tx.objectStore(BLE_FIELD_META_STORE).put(meta, BLE_FIELD_PACK_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
    fieldPackMetaCache = meta;
  }

  function collectPhotoUrlsFromRaw(raw, opts = {}) {
    const tagOnly = opts.tagOnly ?? false;
    const allowExpired = !!opts.allowExpired;
    const urls = new Set();
    if (!Array.isArray(raw)) return [];
    for (const p of raw) {
      const tag = pickFirstUrl(p, ["ble_image_url", "bleImageUrl", "ble_image"]);
      if (tag && (allowExpired || !isPhotoUrlExpired(tag))) urls.add(tag);
      if (!tagOnly) {
        const place = pickFirstUrl(p, ["location_image_url", "locationImageUrl", "location_image"]);
        if (place && (allowExpired || !isPhotoUrlExpired(place))) urls.add(place);
      }
    }
    return [...urls];
  }

  async function compressPhotoBlobForField(blob) {
    if (!blob?.type?.startsWith("image/") || blob.size < 100 * 1024) return blob;
    const maxSide = isCoarseMobile() ? 960 : 1280;
    try {
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height, 1));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bmp.close();
        return blob;
      }
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.76));
      return out && out.size < blob.size ? out : blob;
    } catch {
      return blob;
    }
  }

  async function readFieldPhotoBlobFromDb(url) {
    try {
      const db = await openFieldDb();
      const blob = await new Promise((resolve, reject) => {
        const tx = db.transaction(BLE_FIELD_PHOTOS_STORE, "readonly");
        const req = tx.objectStore(BLE_FIELD_PHOTOS_STORE).get(url);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return blob instanceof Blob ? blob : null;
    } catch {
      return null;
    }
  }

  async function loadFieldPhotoIntoImg(img, url) {
    if (!img || !url) return false;
    if (fieldPhotoBlobUrls.has(url)) {
      img.src = fieldPhotoBlobUrls.get(url);
      return true;
    }
    const blob = await readFieldPhotoBlobFromDb(url);
    if (!blob) return false;
    const blobUrl = URL.createObjectURL(blob);
    fieldPhotoBlobUrls.set(url, blobUrl);
    img.src = blobUrl;
    return true;
  }

  async function ensureBleTokenForField() {
    if (getBleToken()) return true;
    try {
      await bleAutoLogin();
      return !!getBleToken();
    } catch {
      return false;
    }
  }

  async function fetchPhotoBlobForField(url) {
    const fetchUrl = isYandexPhotoUrl(url) ? toBlePhotoProxyUrl(url) : url;
    const token = getBleToken();
    const headers =
      fetchUrl.includes("ble-map-proxy") || fetchUrl.includes("functions/v1")
        ? mergeSupabaseHeaders({}, token)
        : token
          ? { Authorization: `Bearer ${token}` }
          : {};
    const ctrl = new AbortController();
    const timeoutMs = isCoarseMobile() ? 90000 : 70000;
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    if (fieldPackAbort?.signal?.aborted) {
      ctrl.abort();
    } else if (fieldPackAbort?.signal) {
      fieldPackAbort.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }
    try {
      const res = await fetch(fetchUrl, { headers, signal: ctrl.signal });
      if (!res.ok) throw new Error(`photo_http_${res.status}`);
      return res.blob();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchPhotoBlobForFieldWithRetry(url) {
    const maxAttempts = isCoarseMobile() ? 4 : 3;
    let lastErr = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (fieldPackAbort?.signal.aborted) throw new Error("aborted");
      if (fieldSyncPhotosSinceAuth >= 12) {
        await ensureBleTokenForField();
        fieldSyncPhotosSinceAuth = 0;
      }
      try {
        const blob = await fetchPhotoBlobForField(url);
        fieldSyncPhotosSinceAuth++;
        return blob;
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || e || "");
        if (msg === "aborted") throw e;
        if (/photo_http_401|photo_http_403|auth/i.test(msg)) {
          await ensureBleTokenForField();
          fieldSyncPhotosSinceAuth = 0;
        }
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        }
      }
    }
    throw lastErr || new Error("photo_fetch_failed");
  }

  function setFieldPackStatus(text, kind = "") {
    const el = document.getElementById("mapFieldPackStatus");
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      el.className = "map-field-pack-status";
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.className = `map-field-pack-status${kind ? ` map-field-pack-status--${kind}` : ""}`;
  }

  async function refreshFieldPackChrome() {
    const meta = await loadFieldPackMeta();
    const btn = document.getElementById("mapFieldPackBtn");
    const syncHint = "Shift+клик — zip и другие опции";
    if (!meta?.markerCount && !meta?.raw?.length) {
      const syncState = loadFieldSyncState();
      if (syncState?.photosOk) {
        setFieldPackStatus("Синхронизация прервана — нажмите «Подготовка к полю»", "busy");
      } else {
        setFieldPackStatus("");
      }
      if (btn) {
        btn.title = `Синхронизация выбранного маршрута перед выездом (Wi‑Fi/VPN). ${syncHint}`;
      }
      return;
    }
    const markerN = meta.markerCount || meta.raw?.length || 0;
    const photoTotal = meta.photoCount || 0;
    const photoOk = meta.photosOk || 0;
    const routeShort = meta.routeTitle
      ? meta.routeTitle.length > 28
        ? `${meta.routeTitle.slice(0, 26)}…`
        : meta.routeTitle
      : "";
    const routePrefix = routeShort ? `${routeShort} · ` : "";
    if (!photoOk && markerN) {
      setFieldPackStatus(
        `${routePrefix}${markerN} меток, фото нет — синхронизируйте по Wi‑Fi/VPN`,
        "busy"
      );
      if (btn) btn.title = `Докачать фото маршрута. ${syncHint}`;
      return;
    }
    if (photoTotal && photoOk < photoTotal) {
      const when = formatCacheAge(meta.savedAt);
      setFieldPackStatus(
        `${routePrefix}${markerN} меток · фото ${photoOk}/${photoTotal}${when ? ` · ${when}` : ""}`,
        "ready"
      );
      if (btn) btn.title = `Продолжить синхронизацию маршрута (${photoOk}/${photoTotal} фото). ${syncHint}`;
      return;
    }
    const when = formatCacheAge(meta.savedAt);
    const mb = meta.bytesTotal ? ` · ~${(meta.bytesTotal / (1024 * 1024)).toFixed(0)} МБ` : "";
    const photos =
      meta.photosOk != null
        ? `${meta.photosOk}${meta.photosFail ? ` (+${meta.photosFail} ошибок)` : ""} фото`
        : `${meta.photoCount || 0} фото`;
    const modeHint = meta.tagOnly ? " · 1 фото/метка" : "";
    const src = meta.packSource === "sync" ? "синхр." : meta.packSource === "zip" ? "zip" : "";
    setFieldPackStatus(
      `${routePrefix}${markerN} меток, ${photos}${modeHint}${mb}${src ? ` · ${src}` : ""}${when ? ` · ${when}` : ""}`,
      "ready"
    );
    if (btn) {
      btn.title = `Обновить данные для поля (${markerN} меток, ${photos}). ${syncHint}`;
    }
  }

  /**
   * Пошаговая подготовка к полю: метки сразу, фото по одному, с докачкой (без zip).
   */
  async function syncFieldDataBeforeWork(opts = {}) {
    if (fieldPackDownloadActive) return;
    const btn = document.getElementById("mapFieldPackBtn");
    const tagOnly = !!opts.tagOnly;
    const markersOnly = !!opts.markersOnly;
    const fullReset = !!opts.fullReset;
    const route =
      opts.routeId != null
        ? {
            routeId: String(opts.routeId),
            routeTitle: opts.routeTitle || `Маршрут ${opts.routeId}`,
          }
        : getActiveRouteForFieldSync();
    if (!route?.routeId) {
      alert("Выберите маршрут в списке «Маршрут» (не «Все маршруты»).");
      return;
    }
    fieldPackDownloadActive = true;
    fieldPackAbort = new AbortController();
    fieldSyncPhotosSinceAuth = 0;
    resetFieldSyncIdbChain();
    if (btn) btn.disabled = true;
    setFieldPackCancelVisible(true);
    setFieldPackStatus("Подготовка…", "busy");
    try {
      if (!(await ensureBleTokenForField())) {
        alert("Нет доступа к API. Проверьте VPN и обновите страницу.");
        return;
      }
      if (!navigator.onLine) {
        alert("Нужен интернет для синхронизации. Подключитесь к Wi‑Fi или VPN и повторите.");
        return;
      }
      const cid = bleCompanyId || (await resolveCompanyId());
      await yieldToMain();
      const rawAll = await resolveRawForFieldPackDownload(cid, { forceFresh: true });
      if (!rawAll?.length) {
        alert(
          "Не удалось получить список меток. Откройте карту по Wi‑Fi/VPN, дождитесь загрузки меток и повторите."
        );
        return;
      }
      const raw = filterRawByRoute(rawAll, route);
      if (!raw.length) {
        alert(
          `В маршруте «${route.routeTitle}» не найдены метки в ответе API.\n\nНажмите ↺ на карте, убедитесь что выбран нужный маршрут, и повторите синхронизацию.`
        );
        return;
      }
      const slimRaw = slimBleRawForFieldPack(raw);
      const photoUrls = markersOnly
        ? []
        : collectPhotoUrlsFromRaw(raw, { tagOnly, allowExpired: true });

      if (fullReset) {
        revokeFieldPhotoBlobUrls();
        await resetFieldPackStorage();
        clearFieldSyncState();
      }

      const prevMeta = await loadFieldPackMeta();
      const routeChanged =
        prevMeta?.routeId && String(prevMeta.routeId) !== String(route.routeId);
      if (routeChanged && !fullReset) {
        await pruneFieldPhotosNotInUrls(photoUrls);
      }

      const existingKeys = opts.resume !== false ? await getFieldPhotoKeysSet() : new Set();
      const toFetch = photoUrls.filter((u) => !existingKeys.has(u));
      let photosOk = photoUrls.filter((u) => existingKeys.has(u)).length;
      let photosFail = 0;
      let bytesTotal = 0;

      const partialMeta = {
        version: BLE_FIELD_PACK_VERSION,
        companyId: cid,
        savedAt: new Date().toISOString(),
        markerCount: slimRaw.length,
        photoCount: photoUrls.length,
        photosOk,
        photosFail: 0,
        bytesTotal: 0,
        tagOnly,
        packSource: "sync",
        routeId: route.routeId,
        routeTitle: route.routeTitle,
      };
      setFieldPackStatus(`Метки: ${slimRaw.length} (${route.routeTitle})…`, "busy");
      await yieldToMain();
      await commitFieldPackMarkersQueued(slimRaw);
      await commitFieldPackMetaQueued(partialMeta);
      if (!bleMap) initBleMap([53.038, 39.011], 15);
      bleCompanyId = cid;
      await applyBleListToMap(slimRaw, "");
      try {
        sessionStorage.setItem(BLE_OFFLINE_FIRST_KEY, "1");
      } catch {
        /* ignore */
      }

      if (!photoUrls.length && !markersOnly) {
        await refreshFieldPackChrome();
        alert(
          `Маршрут «${route.routeTitle}»: ${slimRaw.length} меток сохранено, но у них нет ссылок на фото в API.\n\nНажмите ↺ при VPN — затем синхронизацию снова. В поле координаты будут, фото — только если появятся в API.`
        );
        return;
      }

      if (markersOnly || !toFetch.length) {
        partialMeta.photosOk = photosOk;
        partialMeta.photosFail = photosFail;
        await commitFieldPackMetaQueued(partialMeta);
        clearFieldSyncState();
        await refreshFieldPackChrome();
        alert(
          markersOnly
            ? `Координаты сохранены: ${slimRaw.length} меток.\nМаршрут: ${route.routeTitle}\n\nФото не скачивались.`
            : `Готово к полю.\n\nМаршрут: ${route.routeTitle}\nМеток: ${slimRaw.length}\nФото в памяти: ${photosOk} из ${photoUrls.length}`
        );
        return;
      }

      saveFieldSyncState({
        startedAt: new Date().toISOString(),
        companyId: cid,
        routeId: route.routeId,
        routeTitle: route.routeTitle,
        markerCount: slimRaw.length,
        photoCount: photoUrls.length,
        pending: toFetch.length,
      });

      let done = 0;
      const total = toFetch.length;
      const batchSize = fieldSyncPhotoBatchSize();
      let lastStatusAt = 0;

      setFieldPackStatus(
        `Фото: 0 / ${total} (всего ${photosOk}/${photoUrls.length}) · 0 МБ`,
        "busy"
      );
      await yieldToMain();

      const queue = [...toFetch];
      const updateSyncProgress = async (force) => {
        const now = Date.now();
        if (!force && now - lastStatusAt < 500 && done < total) return;
        lastStatusAt = now;
        setFieldPackStatus(
          `Фото: ${done} / ${total} (всего ${photosOk}/${photoUrls.length}) · ${formatFieldPackMb(bytesTotal)}`,
          "busy"
        );
        partialMeta.photosOk = photosOk;
        partialMeta.photosFail = photosFail;
        partialMeta.bytesTotal = bytesTotal;
        try {
          await commitFieldPackMetaQueued(partialMeta);
        } catch (e) {
          console.warn("[ble-map] field sync meta", e?.message || e);
        }
        await yieldToMain();
      };

      const runPhotoWorker = async () => {
        const pendingBatch = [];
        const flushBatch = async () => {
          if (!pendingBatch.length) return;
          const chunk = pendingBatch.splice(0, pendingBatch.length);
          await appendFieldPackPhotosBatchQueued(chunk);
        };

        while (queue.length) {
          if (fieldPackAbort?.signal.aborted) return;
          const url = queue.shift();
          if (!url) continue;
          try {
            let blob = await fetchPhotoBlobForFieldWithRetry(url);
            if (fieldPackAbort?.signal.aborted) return;
            if (blob.size > BLE_FIELD_PHOTO_MAX_BYTES) {
              photosFail++;
            } else {
              blob = await compressPhotoBlobForField(blob);
              pendingBatch.push([url, blob]);
              if (pendingBatch.length >= batchSize) {
                await flushBatch();
              }
              photosOk++;
              bytesTotal += blob.size || 0;
            }
          } catch (e) {
            const msg = String(e?.message || e || "");
            if (msg !== "aborted") {
              photosFail++;
              console.warn("[ble-map] field sync photo", url.slice(0, 60), msg);
            }
          }
          done++;
          await updateSyncProgress(done === total);
          if (isCoarseMobile()) {
            await new Promise((r) => setTimeout(r, 180));
          }
        }
        try {
          await flushBatch();
        } catch (e) {
          console.warn("[ble-map] field sync flush", e?.message || e);
        }
      };

      try {
        await Promise.all(
          Array.from({ length: fieldPackConcurrency() }, () => runPhotoWorker())
        );
      } catch (e) {
        console.warn("[ble-map] field sync workers", e?.message || e);
      }
      try {
        await fieldSyncIdbChain;
      } catch {
        /* ignore */
      }

      if (fieldPackAbort?.signal.aborted) {
        partialMeta.photosOk = photosOk;
        partialMeta.photosFail = photosFail;
        partialMeta.bytesTotal = bytesTotal;
        await commitFieldPackMetaQueued(partialMeta);
        saveFieldSyncState({
          ...loadFieldSyncState(),
          pausedAt: new Date().toISOString(),
          photosOk,
          pending: total - done,
        });
        setFieldPackStatus(
          `Остановлено · ${route.routeTitle} · ${photosOk}/${photoUrls.length} фото`,
          "busy"
        );
        alert(
          `Синхронизация остановлена.\n\nМаршрут: ${route.routeTitle}\nМеток: ${slimRaw.length}\nФото: ${photosOk} из ${photoUrls.length}\n\nВыберите тот же маршрут и нажмите «Подготовка к полю» — докачаются недостающие.`
        );
        await refreshFieldPackChrome();
        return;
      }

      const meta = {
        version: BLE_FIELD_PACK_VERSION,
        companyId: cid,
        savedAt: new Date().toISOString(),
        markerCount: slimRaw.length,
        photoCount: photoUrls.length,
        photosOk,
        photosFail,
        bytesTotal,
        tagOnly,
        packSource: "sync",
        routeId: route.routeId,
        routeTitle: route.routeTitle,
      };
      await commitFieldPackMetaQueued(meta);
      clearFieldSyncState();
      setBleMapData(mergeBleMapDataFromRaw(raw));
      updateMapStats();
      renderBleMarkers();
      await refreshFieldPackChrome();

      if (photosOk < 1 && !markersOnly) {
        alert(
          `Координаты сохранены (${slimRaw.length} меток), но фото не скачались (${photosFail} ошибок). Проверьте VPN и повторите синхронизацию.`
        );
        return;
      }

      alert(
        `Готово к полю.\n\nМаршрут: ${route.routeTitle}\nМеток: ${slimRaw.length}\nФото: ${photosOk} из ${photoUrls.length}` +
          (photosFail ? ` (${photosFail} не скачались — повторите синхронизацию)` : "") +
          `\n\nБез связи откройте карту — на карте только этот маршрут.`
      );
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (msg.includes("QuotaExceeded") || msg.includes("quota")) {
        alert(
          "Недостаточно места в браузере. Удалите данные сайта в настройках Safari или синхронизируйте частями (остановить → позже продолжить)."
        );
      } else {
        alert(`Синхронизация не завершена: ${msg.slice(0, 200)}`);
      }
      setFieldPackStatus("");
    } finally {
      fieldPackDownloadActive = false;
      fieldPackAbort = null;
      resetFieldSyncIdbChain();
      setFieldPackCancelVisible(false);
      if (btn) btn.disabled = false;
    }
  }

  async function downloadFieldPack() {
    await syncFieldDataBeforeWork({ fullReset: true, resume: false });
  }

  async function tryLoadFieldPack(companyId) {
    const meta = await loadFieldPackMeta();
    if (!meta?.markerCount && !meta?.raw?.length) return false;
    if (companyId && meta.companyId && Number(meta.companyId) !== Number(companyId)) {
      return false;
    }
    setFieldPackStatus("Загрузка данных для поля…", "busy");
    await yieldToMain();
    const raw = await loadFieldPackMarkers();
    if (!raw?.length) return false;
    if (!bleMap) initBleMap([53.038, 39.011], 15);
    bleCompanyId = meta.companyId || companyId;
    if (meta.routeId) setBleMapRouteFilter(String(meta.routeId));
    await applyBleListToMap(raw, "");
    try {
      sessionStorage.setItem(BLE_OFFLINE_FIRST_KEY, "1");
    } catch {
      /* ignore */
    }
    setRetryVisible(!navigator.onLine);
    const routeHint = meta.routeTitle ? ` · ${meta.routeTitle}` : "";
    if (!navigator.onLine) {
      showMapMsg(
        `Нет сети — карта маршрута из памяти${routeHint}. Фото скачанные открываются; спутник без интернета может не грузиться.`,
        "error"
      );
    } else {
      hideMapMsg();
    }
    await refreshFieldPackChrome();
    return true;
  }

  function shouldPreferFieldPack() {
    return !navigator.onLine;
  }

  async function fetchBleListForPhotos(companyId, opts = {}) {
    const cid = companyId ?? bleCompanyId;
    if (!cid) return null;
    if (opts.apiOnly) {
      return fetchBleListLive(cid);
    }
    const live = await fetchBleListLive(cid);
    if (live?.length) return live;
    try {
      const cached = await fetchBleListCached(cid);
      if (cached?.data?.length) {
        bleListSnapshot = {
          at: Date.now(),
          raw: cached.data,
          companyId: cid,
          live: false,
        };
        return cached.data;
      }
    } catch (e) {
      console.warn("[ble-map] photo list Supabase cache", e?.message || e);
    }
    const offline = await fetchBleListOffline(cid);
    return offline?.data?.length ? offline.data : null;
  }

  async function refreshBleListSnapshot(companyId, opts = {}) {
    const cid = companyId ?? bleCompanyId;
    if (!cid) return null;
    if (opts.forceFresh) {
      return fetchBleListForPhotos(cid, { apiOnly: true });
    }
    const snap = bleListSnapshot;
    if (
      snap?.live &&
      snap?.raw?.length &&
      snap.companyId === cid &&
      Date.now() - snap.at < BLE_LIST_SNAPSHOT_MS
    ) {
      return snap.raw;
    }
    return fetchBleListForPhotos(cid);
  }

  function findRawBlePoint(raw, pt) {
    if (!raw?.length || !pt) return null;
    return (
      raw.find((p) => Number(p.id) === Number(pt.id)) ||
      raw.find((p) => String(p.ble_number ?? p.bleNumber ?? "") === String(pt.ble))
    );
  }

  function makePopup(pt) {
    const routeLine = pt.routeTitle
      ? `<div style="color:#1565C0;font-size:12px;font-weight:600;margin-bottom:3px;">${esc(pt.routeTitle)}</div>`
      : "";
    return `<div class="ble-popup-body" style="font-size:13px;line-height:1.5;min-width:160px;max-width:260px;"><div style="font-family:Oswald,sans-serif;font-size:1em;font-weight:700;color:#37474F;margin-bottom:2px;">Метка #${esc(pt.ble)}</div>${routeLine}${pt.bleType ? `<div style="color:#00897b;font-size:12px;font-weight:600;margin-bottom:3px;">${esc(pt.bleType.replace(/^\d+ - /, ""))}</div>` : ""}${pt.locationDesc ? `<div style="color:#546E7A;font-size:12px;margin-bottom:2px;">${esc(pt.locationDesc)}</div>` : ""}<div class="ble-popup-photos-slot"></div></div>`;
  }

  function renderPhotosInto(container, pt) {
    if (!container) return;
    container.innerHTML = "";
    const urls = [pt.photoTag, pt.photoPlace].filter(Boolean);
    if (!urls.length) {
      const hint = navigator.onLine
        ? "Нет фото в API для этой метки. Нажмите ↺ на карте (VPN) и «Подготовка к полю» для маршрута."
        : "Фото не скачаны. Выберите маршрут и «Подготовка к полю» по Wi‑Fi/VPN.";
      container.innerHTML = `<p class="ble-popup-loading">${hint}</p>`;
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "ble-popup-photos";
    urls.forEach((url) => {
      const a = document.createElement("a");
      a.className = "ble-popup-photo-link";
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.dataset.blePhoto = url;
      const img = document.createElement("img");
      img.className = "ble-popup-photo";
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      const direct = url;
      const proxied = toBlePhotoProxyUrl(url);
      const cached = fieldPhotoBlobUrls.get(url);
      if (cached) {
        img.src = cached;
      } else {
        void (async () => {
          const fromPack = await loadFieldPhotoIntoImg(img, url);
          if (!fromPack && img.isConnected) img.src = photoSrcForDisplay(url);
        })();
      }
      img.addEventListener("error", function onImgErr() {
        if (this.dataset.blePhotoTried === "both") return;
        if (this.src === proxied || this.dataset.blePhotoTried === "proxy") {
          this.dataset.blePhotoTried = "both";
          if (this.src !== direct) this.src = direct;
          return;
        }
        if (proxied && this.src !== proxied) {
          this.dataset.blePhotoTried = "proxy";
          this.src = proxied;
          return;
        }
        this.dataset.blePhotoTried = "both";
      });
      a.appendChild(img);
      wrap.appendChild(a);
    });
    container.appendChild(wrap);
  }

  function popupFooterHtml(extra) {
    return extra ? `<p class="ble-popup-footer">${extra}</p>` : "";
  }

  function getPointForPopup(pt) {
    return bleMapData.find((p) => p.id === pt.id) || pt;
  }

  async function enrichPointPhotos(pt, opts = {}) {
    if (!pt?.id || !bleCompanyId) return pt;
    try {
      let raw = null;
      if (opts.forceFresh && navigator.onLine) {
        raw = await fetchBleListLive(bleCompanyId);
      }
      if (!raw) {
        raw = await refreshBleListSnapshot(bleCompanyId, {
          forceFresh: !!opts.forceFresh,
        });
      }
      if (!raw) return pt;
      const found = findRawBlePoint(raw, pt);
      if (!found) return pt;
      const enriched = classifyBle(found, pt);
      const idx = bleMapData.findIndex((p) => p.id === enriched.id);
      if (idx >= 0) bleMapData[idx] = enriched;
      return enriched;
    } catch (e) {
      console.warn("[ble-map] enrichPointPhotos", e?.message || e);
      return pt;
    }
  }

  function attachMarkerPopup(marker, pt, extraFooter) {
    const footer = popupFooterHtml(extraFooter);
    const renderContent = (p) => makePopup(p) + footer;

    marker.bindPopup(() => renderContent(getPointForPopup(pt)), {
      maxWidth: popupMaxWidth(),
    });
    marker.on("popupopen", async () => {
      let current = getPointForPopup(pt);
      const slot = marker
        .getPopup()
        ?.getElement()
        ?.querySelector(".ble-popup-photos-slot");
      const mustRefresh = needsPhotoRefresh(current);
      try {
        if (!mustRefresh && (current.photoTag || current.photoPlace)) {
          renderPhotosInto(slot, current);
          return;
        }
        if (slot) slot.innerHTML = '<p class="ble-popup-loading">Загрузка фото…</p>';
        current = await enrichPointPhotos(current, { forceFresh: true });
        if (!current.photoTag && !current.photoPlace && navigator.onLine) {
          current = await enrichPointPhotos(current, { forceFresh: true });
        }
      } catch (e) {
        console.warn("[ble-map] popup photos", e?.message || e);
        current = getPointForPopup(pt);
      } finally {
        renderPhotosInto(slot, getPointForPopup(pt));
      }
    });
  }

  function initBlePopupPhotoClicks() {
    if (initBlePopupPhotoClicks.done) return;
    initBlePopupPhotoClicks.done = true;
    document.body.addEventListener("click", (e) => {
      const link = e.target.closest(".ble-popup-photo-link, [data-ble-photo]");
      if (!link) return;
      e.preventDefault();
      const url = link.dataset.blePhoto || link.getAttribute("data-ble-photo");
      if (url) openPhotoViewer(url);
    });
  }

  function makeClusterGroup() {
    return L.markerClusterGroup({
      maxClusterRadius(zoom) {
        if (zoom < 17) return 120;
        if (zoom < 19) return 40;
        return 1;
      },
      disableClusteringAtZoom: 20,
      spiderfyOnMaxZoom: false,
      showCoverageOnHover: false,
      animate: false,
      animateAddingMarkers: false,
      chunkedLoading: true,
      chunkInterval: 80,
      chunkDelay: 16,
      removeOutsideVisibleBounds: true,
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

  function getOrCreateMarkerForPt(pt) {
    if (!pt.lat || !pt.lng) return null;
    let entry = bleMarkerRegistry.get(pt.id);
    if (entry) return entry.marker;
    const marker = L.marker([pt.lat, pt.lng], { icon: createBleIcon(pt) });
    attachMarkerPopup(marker, pt);
    bleMarkerRegistry.set(pt.id, { marker, pt });
    return marker;
  }

  function collectVisibleMarkers(filter, query) {
    const visible = [];
    bleMapData.forEach((pt) => {
      if (!pointVisibleOnMap(pt, { statusFilter: filter, query })) return;
      const m = getOrCreateMarkerForPt(pt);
      if (m) visible.push(m);
    });
    return visible;
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
    const cached = bleMarkerRegistry.get(pt.id);
    if (cached) {
      try {
        cached.marker.setLatLng(ll);
      } catch {
        /* ignore */
      }
    }
    upsertOfflineMarkerEdit(rec);
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

    attachMarkerPopup(
      marker,
      pt,
      "<span style='font-size:12px;color:#546E7A'>Удержите 1 сек., затем перетащите</span>"
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
    document.querySelectorAll("select[data-ble-route-select]").forEach((sel) => {
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
    document.querySelectorAll("select[data-ble-route-select]").forEach((sel) => {
      if (sel.value !== bleMapRouteFilter) sel.value = bleMapRouteFilter;
    });
    bleRouteFilterApplying = false;
    redrawMapLayers({ zones: false });
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
    const q =
      document.getElementById("mapBleSearch")?.value?.trim().toLowerCase().replace(/^ble/i, "") || "";

    if (shouldUseEditMarkersOnMap(bleMap)) {
      if (bleClusterGroup) {
        bleMap.removeLayer(bleClusterGroup);
        bleClusterGroup = null;
      }
      if (bleMarkerLayer) {
        bleMap.removeLayer(bleMarkerLayer);
      }
      bleMarkerLayer = L.layerGroup();
      addEditableMarkersToGroup(bleMarkerLayer, { statusFilter: bleMapFilter, query: q });
      bleMap.addLayer(bleMarkerLayer);
      lastRenderKey = "edit";
      return;
    }

    if (bleMarkerLayer) {
      bleMap.removeLayer(bleMarkerLayer);
      bleMarkerLayer = null;
    }

    const key = `view:${bleMapFilter}:${bleMapRouteFilter}:${q}:${bleMapData.length}`;
    if (key === lastRenderKey && bleClusterGroup) return;
    lastRenderKey = key;

    const visible = collectVisibleMarkers(bleMapFilter, q);

    if (!bleClusterGroup) {
      bleClusterGroup = makeClusterGroup();
      bleMap.addLayer(bleClusterGroup);
    } else {
      bleClusterGroup.clearLayers();
    }
    bleClusterGroup.addLayers(visible);
  }

  function renderFsMarkers() {
    if (!bleMapFS || !isMapFullscreenOpen()) return;
    const q = getFsSearchQuery();

    if (shouldUseEditMarkersOnMap(bleMapFS)) {
      clearFsMarkerLayers();
      bleMarkerLayerFS = L.layerGroup();
      addEditableMarkersToGroup(bleMarkerLayerFS, { statusFilter: bleMapFSFilter, query: q });
      bleMapFS.addLayer(bleMarkerLayerFS);
      lastRenderKeyFS = "edit";
      return;
    }

    if (bleMarkerLayerFS) {
      bleMapFS.removeLayer(bleMarkerLayerFS);
      bleMarkerLayerFS = null;
    }

    const key = `view:${bleMapFSFilter}:${bleMapRouteFilter}:${q}:${bleMapData.length}`;
    if (key === lastRenderKeyFS && bleClusterGroupFS) return;
    lastRenderKeyFS = key;

    const visible = collectVisibleMarkers(bleMapFSFilter, q);

    if (!bleClusterGroupFS) {
      bleClusterGroupFS = makeClusterGroup();
      bleMapFS.addLayer(bleClusterGroupFS);
    } else {
      bleClusterGroupFS.clearLayers();
    }
    bleClusterGroupFS.addLayers(visible);
  }

  function updateMapStats() {
    const all = bleMapData.length;
    const insp = bleInspectionCount;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== String(v)) el.textContent = v;
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
    redrawMapLayers({ zones: false });
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
    scheduleInvalidateSize(bleMap);
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
      bleListSnapshot = { at: Date.now(), raw: rawBle, companyId, live: true };
      setBleMapData(mergeBleMapDataFromRaw(rawBle));
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
      scheduleDefaultMapCenter({ force: true, fromLive: true });
    } catch (e) {
      console.warn("[ble-map] API refresh failed", e?.message || e);
    }
  }

  async function applyBleListToMap(rawBle, cacheNotice, opts = {}) {
    setBleMapData(mergeBleMapDataFromRaw(rawBle));
    applyOfflineMarkerQueueToMapData();
    if (opts.liveApi && Array.isArray(rawBle) && rawBle.length && bleCompanyId) {
      bleListSnapshot = { at: Date.now(), raw: rawBle, companyId: bleCompanyId, live: true };
    }
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
    scheduleDefaultMapCenter({ force: !!opts.liveApi, fromLive: !!opts.liveApi });
    if (!findBlePointByNumber(BLE_DEFAULT_CENTER_BLE) && validPts.length > 1) {
      bleMap.fitBounds(L.latLngBounds(validPts.map((p) => [p.lat, p.lng])), {
        padding: [30, 30],
      });
    }
    revealMapControls();
    loadBleRoutes();
    hideMapMsg();
    bleMapInitialized = true;
    scheduleMapResize();
    updateOfflineEditChrome();
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
    bleDefaultCenterLocked = false;
    bleDefaultCenterSeq++;
    const placeholder = document.getElementById("mapPlaceholder");
    if (placeholder) placeholder.textContent = "Загрузка карты…";
    try {
      if (navigator.onLine) {
        try {
          sessionStorage.removeItem(BLE_OFFLINE_FIRST_KEY);
        } catch {
          /* ignore */
        }
      }
      bleGenplanMeta = await fetchBleGenplanMeta();
      syncGenplanLayerMenuVisibility();

      let center = [59.6603, 28.3967];
      let zoom = 16;
      initBleMap(center, zoom);
      ensureBleGenplanMask();
      remountGenplanLayers();

      const companyId = await resolveCompanyId();
      bleCompanyId = companyId;

      if (shouldPreferFieldPack()) {
        const fromField = await tryLoadFieldPack(companyId);
        if (fromField) return;
      }

      void hydrateFieldPhotoBlobUrls();

      const cached = await fetchBleListOffline(companyId);
      if (cached?.data?.length) {
        await applyBleListToMap(cached.data, "");
        void (async () => {
          try {
            const apiCid = await resolveCompanyIdFromApi();
            if (apiCid && apiCid !== companyId) {
              bleCompanyId = apiCid;
              await refreshBleMapFromApi(apiCid);
            } else {
              await refreshBleMapFromApi(companyId);
            }
          } catch {
            try {
              sessionStorage.setItem(BLE_OFFLINE_FIRST_KEY, "1");
            } catch {
              /* ignore */
            }
          }
        })();
        return;
      }

      try {
        const cfg = await bleApiFetch("/api/v1/map/config");
        if (cfg.defaultView?.latitude) center = [cfg.defaultView.latitude, cfg.defaultView.longitude];
        if (cfg.defaultZoom) zoom = cfg.defaultZoom;
      } catch {
        /* default center */
      }

      const rawBle = await bleApiFetch(`/api/v1/map/ble/${companyId}`);
      try {
        sessionStorage.removeItem(BLE_OFFLINE_FIRST_KEY);
      } catch {
        /* ignore */
      }
      await applyBleListToMap(rawBle, "", { liveApi: true });
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
    bleListSnapshot = null;
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
        fadeAnimation: false,
        markerZoomAnimation: !fsMobile,
        wheelPxPerZoomLevel: 80,
        minZoom: BLE_MAP_MIN_ZOOM,
        maxZoom: BLE_MAP_MAX_ZOOM,
      });
      applyBleMapZoomLimits(bleEditMode);
      L.control
        .zoom({
          position: fsMobile ? "bottomright" : "topright",
        })
        .addTo(bleMapFS);
      fsTileLayers = buildBleTileLayers(fsMobile);
      fsTileLayerCurrent = bleBaseLayerCurrent || readStoredBaseLayer();
      mountBleBaseLayer(bleMapFS, fsTileLayers, fsTileLayerCurrent);
      if (bleMap) {
        bleMapFS.setView(bleMap.getCenter(), bleMap.getZoom());
      } else if (bleMapData.length) {
        const validPts = bleMapData.filter((p) => p.lat && p.lng);
        if (!centerMapOnDefaultBle(bleMapFS, { animate: false }) && validPts.length > 1) {
          bleMapFS.fitBounds(L.latLngBounds(validPts.map((p) => [p.lat, p.lng])), { padding: [30, 30] });
        } else if (!centerMapOnDefaultBle(bleMapFS, { animate: false })) {
          bleMapFS.setView([53.038, 39.011], 15);
        }
      } else {
        bleMapFS.setView([53.038, 39.011], 15);
      }
      wireBaseLayerPickers();
      syncBaseLayerPickers(fsTileLayerCurrent);
      document.querySelectorAll("[data-fsfilter]").forEach((btn) => {
        btn.addEventListener("click", () => setBleMapFilter(btn.dataset.fsfilter));
      });
      const fsSearchEl = document.getElementById("mapFsSearch");
      const fsSearchClear = document.getElementById("mapFsSearchClear");
      if (fsSearchEl && fsSearchClear) {
        let fsSearchTimer = 0;
        const runFsSearch = () => {
          fsSearchTimer = 0;
          renderFsMarkers();
          const q = fsSearchEl.value.trim().toLowerCase().replace(/^ble/i, "");
          if (!q) return;
          const found = bleByBleNumber.get(q);
          if (!found?.lat || !found.lng) return;
          const target = bleMarkerRegistry.get(found.id)?.marker;
          if (target && bleClusterGroupFS?.zoomToShowLayer) {
            bleClusterGroupFS.zoomToShowLayer(target, () => target.openPopup());
          } else if (target) {
            bleMapFS.setView(target.getLatLng(), Math.max(bleMapFS.getZoom(), 17));
            target.openPopup();
          }
        };
        fsSearchEl.addEventListener("input", () => {
          fsSearchClear.style.display = fsSearchEl.value ? "block" : "none";
          if (fsSearchTimer) clearTimeout(fsSearchTimer);
          fsSearchTimer = setTimeout(runFsSearch, BLE_RENDER_DEBOUNCE_MS);
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
      ensureBleGenplanMask();
      updateGenplanMaskVisibility();
    }
    attachDrawMapListeners();
    renderBleDrawOnAllMaps();
    syncFsStats();
    renderFsMarkers();
    if (bleEditMode && bleMapFS) drawZones(bleMapFS);
    updateGenplanMaskVisibility();
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
    document.body.classList.remove("ble-map--genplan-calib", "ble-map--genplan-calib-expanded");
    document.getElementById("mapGenplanMaskPanel")?.setAttribute("hidden", "");
    wireMapDropdownUi();
    wireBaseLayerPickers();
    wireGenplanCalibUi();
    wireBleDrawUi();
    syncBaseLayerPickers(readStoredBaseLayer());
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
      const sel = e.target.closest?.("select[data-ble-route-select]");
      if (!sel) return;
      setBleMapRouteFilter(sel.value);
    });

    const mapBleSearchEl = document.getElementById("mapBleSearch");
    const mapSearchClearEl = document.getElementById("mapSearchClear");
    if (mapBleSearchEl && mapSearchClearEl) {
      let searchTimer = 0;
      const runSearch = () => {
        searchTimer = 0;
        renderBleMarkers();
        const q = mapBleSearchEl.value.trim().toLowerCase().replace(/^ble/i, "");
        if (!q) return;
        const found = bleByBleNumber.get(q);
        if (found?.lat && found.lng) {
          const target = bleMarkerRegistry.get(found.id)?.marker;
          if (target && bleClusterGroup?.zoomToShowLayer) {
            bleClusterGroup.zoomToShowLayer(target, () => target.openPopup());
          }
        }
      };
      mapBleSearchEl.addEventListener("input", () => {
        mapSearchClearEl.style.display = mapBleSearchEl.value ? "block" : "none";
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(runSearch, BLE_RENDER_DEBOUNCE_MS);
      });
      mapSearchClearEl.addEventListener("click", () => {
        mapBleSearchEl.value = "";
        mapSearchClearEl.style.display = "none";
        if (searchTimer) clearTimeout(searchTimer);
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
    document.getElementById("mapFieldPackBtn")?.addEventListener("click", (e) => {
      if (e.shiftKey) {
        void onFieldPackAdvancedMenu();
        return;
      }
      void onFieldPackPrimaryClick();
    });
    document.getElementById("mapFieldPackFile")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) void importFieldPackZipBlob(file, { source: "file" });
    });
    document.getElementById("mapFieldPackCancel")?.addEventListener("click", () => {
      abortFieldPackDownload();
    });
    document.getElementById("photoViewerOverlay")?.addEventListener("click", closePhotoViewer);
    document.getElementById("photoViewerClose")?.addEventListener("click", closePhotoViewer);

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (bleGenplanCalibMode) {
        finishGenplanCalibMode({ save: false });
        return;
      }
      closeAllMapDropdowns();
      if (bleDrawTool) {
        setBleDrawTool(bleDrawTool);
        return;
      }
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

  function bindBleMapBackLogo() {
    const btn = document.getElementById("bleMapBackLogo");
    if (!btn || btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      if (window.self !== window.top) {
        try {
          window.parent.postMessage({ type: "ww-app-nav", page: "tabel" }, "*");
        } catch {
          /* ignore */
        }
        return;
      }
      window.location.href = "index.html";
    });
  }

  function initEmbeddedChrome() {
    bindBleMapBackLogo();
    if (window.self !== window.top) {
      document.getElementById("bleMapPageHeader")?.classList.add("is-embedded");
      const back = document.getElementById("bleMapBackLink");
      if (back) back.hidden = true;
    }
    applyMapLayoutClasses();
    bindMapResizeHandlers();
    window.addEventListener("offline", () => {
      updateOfflineEditChrome();
      void (async () => {
        if (bleMapInitialized) return;
        const cid = bleCompanyId || (await resolveCompanyId());
        await tryLoadFieldPack(cid);
      })();
    });
    window.addEventListener("online", () => {
      hideMapMsg();
      setRetryVisible(false);
      updateOfflineEditChrome();
      void (async () => {
        if (!countOfflinePendingEdits()) return;
        try {
          await flushOfflineMarkerEditQueue();
        } catch (e) {
          console.warn("[ble-map] auto sync offline edits", e?.message || e);
          showMapMsg(
            "Сеть есть, но отправка правок не удалась. Нажмите «Отправить» в режиме правки.",
            "error"
          );
        }
      })();
    });
    window.addEventListener("message", (e) => {
      if (e.data?.type === "ww-ble-map-resize") {
        scheduleMapResize();
        scheduleDefaultMapCenter({ force: true });
      }
    });
    try {
      if (window.self !== window.top && window.parent) {
        window.parent.postMessage({ type: "ww-ble-map-ready" }, "*");
      }
    } catch {
      /* cross-origin */
    }
  }

  let bleMapAppStarted = false;
  let bleMapAccessGranted = false;

  function isBleMapAccessUnlocked() {
    return bleMapAccessGranted;
  }

  function unlockBleMapAccess() {
    bleMapAccessGranted = true;
    try {
      sessionStorage.removeItem("ww-ble-map-access");
    } catch {
      /* ignore */
    }
  }

  function hideBleMapAccessGate() {
    const gate = document.getElementById("bleMapAccessGate");
    if (!gate) return;
    gate.classList.remove("is-active");
    gate.hidden = true;
    gate.setAttribute("aria-hidden", "true");
  }

  function showBleMapAccessGate() {
    const gate = document.getElementById("bleMapAccessGate");
    if (!gate) return;
    gate.hidden = false;
    gate.removeAttribute("hidden");
    gate.classList.add("is-active");
    gate.removeAttribute("aria-hidden");
  }

  function normalizeBleMapAccessPassword(raw) {
    return String(raw || "")
      .trim()
      .replace(/\u00a0/g, " ");
  }

  function isBleMapAccessPasswordOk(raw) {
    return normalizeBleMapAccessPassword(raw) === BLE_MAP_ACCESS_PASSWORD;
  }

  function startBleMapApp() {
    if (bleMapAppStarted) return;
    bleMapAppStarted = true;
    if (typeof L !== "undefined" && L.Layer?.prototype?.pm) {
      console.warn(
        "[ble-map] Загружен старый кэш с Geoman — сделайте жёсткое обновление (Ctrl+F5). Версия:",
        BLE_MAP_BUILD
      );
    }
    initEmbeddedChrome();
    initBlePopupPhotoClicks();
    bindUi();
    void refreshFieldPackChrome();
    updateOfflineEditChrome();
    loadBleMap();
    scheduleMapResize();
  }

  function bindBleMapAccessGate(onUnlocked) {
    const gate = document.getElementById("bleMapAccessGate");
    const form = document.getElementById("bleMapAccessForm");
    const input = document.getElementById("bleMapAccessInput");
    const err = document.getElementById("bleMapAccessErr");
    if (!gate || !form) {
      onUnlocked();
      return;
    }
    if (isBleMapAccessUnlocked()) {
      hideBleMapAccessGate();
      onUnlocked();
      return;
    }
    showBleMapAccessGate();
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (isBleMapAccessPasswordOk(input?.value)) {
        unlockBleMapAccess();
        hideBleMapAccessGate();
        if (err) err.textContent = "";
        onUnlocked();
        return;
      }
      if (err) err.textContent = "Неверный пароль";
      input?.focus();
      input?.select();
    });
    window.setTimeout(() => input?.focus(), 80);
  }

  function bootBleMapPage() {
    bindBleMapAccessGate(() => startBleMapApp());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootBleMapPage);
  } else {
    bootBleMapPage();
  }
})();
