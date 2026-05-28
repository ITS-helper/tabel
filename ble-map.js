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
  /** ble_zone на Edge сейчас отвечает 500 — сначала Worker */
  const BLE_WORKER_PREFERRED_PATHS = ["/api/v1/ble_zone"];

  const BLE_FETCH_TIMEOUT_MS = 120000;
  const BLE_LIST_FETCH_TIMEOUT_MS = 22000;
  const BLE_STATIC_CACHE_FETCH_MS = 90000;
  const BLE_TRANSPORT_KEY = "ww-ble-transport";
  const BLE_CLUSTER_TOGGLE_KEY = "ww-ble-cluster-enabled";
  const BLE_OFFLINE_FIRST_KEY = "ww-ble-offline-first";
  const BLE_FIELD_READY_KEY = "ww-ble-field-ready";
  const ROUTE_EXPORT_SVG_W = 1000;
  const ROUTE_EXPORT_SVG_H = 720;
  const BLE_DEFAULT_COMPANY_ID = 1;
  const BLE_MARKER_HOLD_MS = 1000;
  const BLE_MAP_BUILD = "20260529a";
  const BLE_GENPLAN_META_URL = "data/ble-genplan-meta.json";
  const BLE_SATELLITE_TILES_META_URL = "data/ble-satellite-tiles-meta.json";
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
  const BLE_FIELD_ZONES_KEY = "zones";
  const BLE_FIELD_PHOTO_REVISIONS_KEY = "photoRevisions";
  const BLE_FIELD_PACK_VERSION = 3;
  const BLE_FIELD_PACK_META_URL = "data/ble-field-pack-meta.json";
  const BLE_FIELD_PHOTO_MAX_BYTES = 2.5 * 1024 * 1024;
  const BLE_FIELD_PHOTO_BATCH = 8;
  const BLE_FIELD_YIELD_EVERY = 1;
  const BLE_DEFAULT_CENTER_BLE = "20";
  const BLE_DEFAULT_CENTER_ZOOM = 18;
  const BLE_MAP_MIN_ZOOM = 14;
  /** Esri World Imagery: выше z18 в этом районе — заглушка «Map data not yet available» */
  const BLE_SATELLITE_NATIVE_ZOOM = 18;
  const BLE_STREET_NATIVE_ZOOM = 19;
  const BLE_MAP_MAX_ZOOM = 19;
  const BLE_MAP_EDIT_MAX_ZOOM = 20;
  const BLE_DEFAULT_CENTER_RETRY_MS = 220;
  const BLE_DEFAULT_CENTER_MAX_ATTEMPTS = 18;
  const BLE_CLUSTER_MIN_COUNT = 5;
  const BLE_ZONE_NEON = "#00e5ff";
  const BLE_ZONE_NEON_FILL = "#66f0ff";
  const BLE_ZONE_SMALL_MAX_PTS = 12;
  const BLE_BASE_LAYER_KEY = "ww-ble-base-layer";
  const BLE_BASE_LAYERS = ["street", "satellite", "hybrid", "genplan"];
  const BLE_SATELLITE_ONLINE_URL =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  const BLE_SATELLITE_BUNDLED_URL = "assets/tiles/satellite/{z}/{x}/{y}.jpg";

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
  let fieldPhotoRefreshActive = false;
  let fieldPackMetaCache = null;
  let fieldPackAbort = null;
  let fieldSyncIdbChain = Promise.resolve();
  let fieldSyncPhotosSinceAuth = 0;

  function fieldPackConcurrency() {
    if (isBleNativeApp()) return 6;
    return isCoarseMobile() ? 3 : 6;
  }

  function getCapacitorHttpPlugin() {
    try {
      return window.Capacitor?.Plugins?.CapacitorHttp || null;
    } catch {
      return null;
    }
  }

  function blobFromCapacitorHttpResponse(res) {
    const ct = res.headers?.["Content-Type"] || res.headers?.["content-type"] || "image/jpeg";
    const mime = String(ct).split(";")[0] || "image/jpeg";
    const data = res.data;
    if (data instanceof Blob) return data;
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      return new Blob([data], { type: mime });
    }
    if (typeof data === "string") {
      let b64 = data;
      const comma = b64.indexOf(",");
      if (b64.startsWith("data:") && comma >= 0) b64 = b64.slice(comma + 1);
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    }
    throw new Error("cap_http_bad_data");
  }

  /** Прямая загрузка с Yandex — тот же URL, что в попапе метки (нативный HTTP, без CORS). */
  async function fetchPhotoBlobNativeDirect(url) {
    const http = getCapacitorHttpPlugin();
    if (http?.get) {
      const res = await http.get({
        url: String(url),
        responseType: "blob",
        connectTimeout: 8000,
        readTimeout: 12000,
      });
      if (res.status >= 400) throw new Error(`photo_http_${res.status}`);
      return blobFromCapacitorHttpResponse(res);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(String(url), {
        signal: ctrl.signal,
        referrerPolicy: "no-referrer",
      });
      if (!res.ok) throw new Error(`photo_http_${res.status}`);
      return res.blob();
    } finally {
      clearTimeout(timer);
    }
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

  function withAsyncTimeout(promise, ms, errMsg = "timeout") {
    let timer = 0;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(errMsg)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
      if (packMeta.routeId) {
        setFieldPackReadyMarker(
          { routeId: packMeta.routeId, routeTitle: packMeta.routeTitle || "" },
          packMeta.companyId
        );
      }
      if (!bleMap) initBleMap([53.038, 39.011], 15);
      bleCompanyId = packMeta.companyId || bleCompanyId;
      await applyBleListToMap(slimRaw, "");
      try {
        sessionStorage.setItem(BLE_OFFLINE_FIRST_KEY, "1");
      } catch {
        /* ignore */
      }
      setRetryVisible(true);
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

  /** Маршрут для синхронизации: выбранный или «Все маршруты». */
  function getFieldSyncRouteRef() {
    const routeId = bleMapRouteFilter ? String(bleMapRouteFilter) : "";
    if (!routeId) {
      return { routeId: "", routeTitle: "Все маршруты" };
    }
    const route = bleRoutes.find((r) => String(r.id) === routeId);
    return {
      routeId,
      routeTitle: route ? routeOptionLabel(route) : `Маршрут ${routeId}`,
    };
  }

  function isAllRoutesFieldSync(route) {
    return route != null && !String(route.routeId ?? route.id ?? "");
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

  function fieldPhotoIsStored(url, keysSet) {
    if (!url || !keysSet?.size) return false;
    const exact = String(url);
    if (keysSet.has(exact)) return true;
    const pathKey = photoUrlPathnameKey(exact);
    if (!pathKey) return false;
    for (const key of keysSet) {
      if (photoUrlPathnameKey(key) === pathKey) return true;
    }
    return false;
  }

  function countStoredPhotosForUrls(urls, keysSet) {
    if (!urls?.length || !keysSet?.size) return 0;
    let n = 0;
    for (const url of urls) {
      if (fieldPhotoIsStored(url, keysSet)) n++;
    }
    return n;
  }

  async function pruneFieldPhotosMatchingUrls(urls) {
    const dropPaths = new Set((urls || []).map((u) => photoUrlPathnameKey(u)).filter(Boolean));
    if (!dropPaths.size) return 0;
    const keys = await getFieldPhotoKeysSet();
    const drop = [...keys].filter((k) => dropPaths.has(photoUrlPathnameKey(k)));
    if (!drop.length) return 0;
    for (const key of drop) {
      if (fieldPhotoBlobUrls.has(key)) {
        try {
          URL.revokeObjectURL(fieldPhotoBlobUrls.get(key));
        } catch {
          /* ignore */
        }
        fieldPhotoBlobUrls.delete(key);
      }
    }
    const db = await openFieldDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BLE_FIELD_PHOTOS_STORE, "readwrite");
      const store = tx.objectStore(BLE_FIELD_PHOTOS_STORE);
      for (const key of drop) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return drop.length;
  }

  async function pruneFieldPhotosNotInUrls(keepUrls) {
    const keepPaths = new Set((keepUrls || []).map((u) => photoUrlPathnameKey(u)).filter(Boolean));
    const keys = await getFieldPhotoKeysSet();
    const drop = [...keys].filter((k) => !keepPaths.has(photoUrlPathnameKey(k)));
    if (!drop.length) return 0;
    for (const key of drop) {
      if (fieldPhotoBlobUrls.has(key)) {
        try {
          URL.revokeObjectURL(fieldPhotoBlobUrls.get(key));
        } catch {
          /* ignore */
        }
        fieldPhotoBlobUrls.delete(key);
      }
    }
    const db = await openFieldDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BLE_FIELD_PHOTOS_STORE, "readwrite");
      const store = tx.objectStore(BLE_FIELD_PHOTOS_STORE);
      for (const key of drop) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return drop.length;
  }

  function fieldMemoryLabel() {
    return isBleNativeApp() ? "память телефона" : "кэш браузера";
  }

  async function fieldSyncSummaryLine() {
    const meta = await loadFieldPackMeta();
    const inDb = await countFieldPhotosInDb();
    const markers =
      meta?.markerCount ||
      (await loadFieldPackMarkers())?.length ||
      bleListSnapshot?.raw?.length ||
      0;
    const photos = Math.max(meta?.photosOk || 0, inDb);
    if (!markers && !photos) return "";
    const routeBit = meta?.routeTitle ? `${meta.routeTitle} · ` : "";
    if (meta?.photoCount && photos < meta.photoCount) {
      return `${routeBit}${photos} фото в ${fieldMemoryLabel()} (ещё ~${meta.photoCount - photos})`;
    }
    if (photos) return `${routeBit}${photos} фото в ${fieldMemoryLabel()}`;
    return `${routeBit}${markers} меток`;
  }

  async function onFieldPackPrimaryClick() {
    if (fieldPackDownloadActive || routeExportActive) return;

    const route = getFieldSyncRouteRef();
    const summary = await fieldSyncSummaryLine();
    const allRoutes = isAllRoutesFieldSync(route);
    const est = allRoutes
      ? bleListSnapshot?.raw?.length || bleMapData.length || 0
      : estimateMarkersOnRoute(route.routeId);
    const estLine = est > 0 ? `~${est} меток` : allRoutes ? "метки всех маршрутов" : "метки маршрута";
    const routeLabel = allRoutes ? "всех маршрутов" : `маршрута «${route.routeTitle}»`;
    const mem = fieldMemoryLabel();

    let intro = `Скачать фото меток ${routeLabel}?\n\n${estLine}.\n\nФото сохранятся в ${mem} (как в попапе метки). Уже скачанные не перекачиваются.\n\nКоординаты и зоны — кнопкой «Обновить» (↺).`;
    if (summary) intro += `\n\nСейчас: ${summary}`;
    intro += "\n\nНужен интернет (Wi‑Fi/VPN). Начать загрузку фото?";

    if (!confirm(intro)) {
      if (confirm("Другие способы:\n\nОК — импорт .zip\nОтмена — закрыть")) {
        openFieldPackFilePicker();
      }
      return;
    }
    void syncFieldDataBeforeWork({
      photosOnly: true,
      resume: true,
      routeId: route.routeId,
      routeTitle: route.routeTitle,
    });
  }

  async function onFieldPackAdvancedMenu() {
    if (fieldPackDownloadActive || routeExportActive) return;
    const hosted = await fetchHostedFieldPackMeta();
    const choice = prompt(
      "Дополнительно:\n\n" +
        "1 — импорт .zip\n" +
        (hosted?.packUrl ? "2 — скачать готовый zip с сайта (~146 МБ)\n" : "") +
        "3 — принудительное обновление фото (удалить и скачать заново)\n" +
        "4 — только координаты маршрута (без фото)\n\n" +
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
      const route = getFieldSyncRouteRef();
      const routeLabel = isAllRoutesFieldSync(route)
        ? "всех маршрутов"
        : `маршрута «${route.routeTitle}»`;
      if (confirm(`Принудительно обновить фото ${routeLabel}?\n\nУже скачанные фото будут удалены и скачаны заново.`)) {
        void syncFieldDataBeforeWork({
          fullReset: true,
          photosOnly: true,
          resume: false,
          routeId: route.routeId,
          routeTitle: route.routeTitle,
        });
      }
      return;
    }
    if (choice.trim() === "4") {
      const route = getFieldSyncRouteRef();
      if (!route.routeId && !confirm("Координаты всех маршрутов? Это может занять время.\n\nОК — продолжить")) {
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
  let bleClusterEnabled = true;

  let bleMapFS = null;
  let bleMapFSFilter = "all";
  let bleMapFSInitialized = false;
  let bleTileLayers = null;
  let bleGenplanMeta = null;
  let bleGenplanMask = null;
  let bleGenplanCalibMode = false;
  let bleGenplanCalibSavedLayer = null;
  let bleDrawTool = null;
  let bleZoneAlignMode = false;
  let bleAlignZoneIds = new Set();
  let bleAlignVertexKeys = new Set();
  let bleAlignLinePts = [];
  let bleAlignPreview = null;
  let bleAlignMapListeners = null;
  const bleAlignSettings = { edge: "top", axis: "horizontal", ref: "max" };
  const bleDrawGroupByMap = new WeakMap();
  const BLE_DRAW_SNAP_DEG = 15;
  const BLE_DRAW_PARALLEL_HALF_M = 200;
  let bleBaseLayerCurrent = "street";
  let fsTileLayers = null;
  let fsTileLayerCurrent = "street";
  let bleClusterGroupFS = null;
  let bleClusterNormalizeBound = false;
  let bleClusterNormalizeBoundFS = false;
  let bleMarkerSpillLayer = null;
  let bleMarkerSpillLayerFS = null;
  let bleClusterEnforceTimer = null;
  let bleClusterEnforceTimerFS = null;
  let bleMarkerLayerFS = null;

  let bleCompanyId = null;
  let bleEditMode = false;
  let bleDirtyMarkers = new Map();
  const bleDirtyZones = new Map();
  let bleSelectedZoneId = null;
  let bleMarkerLayer = null;
  const bleZoneGroups = new WeakMap();
  const bleZoneVertexByMap = new WeakMap();
  const bleAlignPickByMap = new WeakMap();
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
    if (isBleNativeApp()) {
      if (fromApi) return fromApi;
      if (prevUrl) return prevUrl;
    }
    return "";
  }

  function photoUrlPathnameKey(url) {
    try {
      const u = new URL(String(url));
      return `${u.origin}${u.pathname}`.toLowerCase();
    } catch {
      return String(url || "")
        .split("?")[0]
        .toLowerCase();
    }
  }

  function fieldPhotoStorageKey(url) {
    return photoUrlPathnameKey(url) || String(url || "");
  }

  function photoRevisionFromServer(url, point, slot) {
    if (!url || !point) return "";
    const path = photoUrlPathnameKey(url);
    const updated = point.updated_at || point.updatedAt || "";
    const status =
      slot === "tag"
        ? point.ble_image_status || point.bleImageStatus || ""
        : point.ble_location_image_status || point.bleLocationImageStatus || "";
    return `${path}|${updated}|${status}`;
  }

  function photoEntriesFromRawPoint(point) {
    const out = [];
    const bleId = point.id;
    const tagUrl = pickFirstUrl(point, ["ble_image_url", "bleImageUrl", "ble_image"]);
    if (tagUrl) {
      out.push({
        bleId,
        slot: "tag",
        url: tagUrl,
        pathKey: fieldPhotoStorageKey(tagUrl),
        rev: photoRevisionFromServer(tagUrl, point, "tag"),
      });
    }
    const placeUrl = pickFirstUrl(point, ["location_image_url", "locationImageUrl", "location_image"]);
    if (placeUrl) {
      out.push({
        bleId,
        slot: "place",
        url: placeUrl,
        pathKey: fieldPhotoStorageKey(placeUrl),
        rev: photoRevisionFromServer(placeUrl, point, "place"),
      });
    }
    return out;
  }

  function buildPhotoRevisionsFromRaw(raw) {
    const out = {};
    if (!Array.isArray(raw)) return out;
    for (const p of raw) {
      for (const e of photoEntriesFromRawPoint(p)) {
        out[e.pathKey] = {
          rev: e.rev,
          url: e.url,
          bleId: e.bleId,
          slot: e.slot,
        };
      }
    }
    return out;
  }

  function indexPhotoRevisionsByBleSlot(revisions) {
    const byBleSlot = {};
    if (!revisions) return byBleSlot;
    for (const entry of Object.values(revisions)) {
      if (entry?.bleId == null || !entry.slot) continue;
      byBleSlot[`${entry.bleId}:${entry.slot}`] = entry;
    }
    return byBleSlot;
  }

  async function loadFieldPhotoRevisions() {
    try {
      const db = await openFieldDb();
      const tx = db.transaction(BLE_FIELD_META_STORE, "readonly");
      const rev = await idbGet(tx.objectStore(BLE_FIELD_META_STORE), BLE_FIELD_PHOTO_REVISIONS_KEY);
      db.close();
      return rev && typeof rev === "object" ? rev : {};
    } catch {
      return {};
    }
  }

  async function commitFieldPhotoRevisions(revisions) {
    if (!revisions || typeof revisions !== "object") return;
    return enqueueFieldSyncIdbWrite(async () => {
      const db = await openFieldDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(BLE_FIELD_META_STORE, "readwrite");
        tx.objectStore(BLE_FIELD_META_STORE).put(revisions, BLE_FIELD_PHOTO_REVISIONS_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
  }

  async function deleteFieldPhotosByKeys(keys) {
    const drop = [...new Set((keys || []).filter(Boolean))];
    if (!drop.length) return;
    for (const key of drop) {
      for (const k of [key, photoUrlPathnameKey(key)]) {
        const blobUrl = fieldPhotoBlobUrls.get(k);
        if (blobUrl) {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {
            /* ignore */
          }
          fieldPhotoBlobUrls.delete(k);
        }
      }
    }
    const db = await openFieldDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BLE_FIELD_PHOTOS_STORE, "readwrite");
      const store = tx.objectStore(BLE_FIELD_PHOTOS_STORE);
      for (const key of drop) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  function collectPhotoUpdatesAfterRefresh(raw, prevRevisions, existingKeys) {
    const next = buildPhotoRevisionsFromRaw(raw);
    const prevByBleSlot = indexPhotoRevisionsByBleSlot(prevRevisions);
    const toUpdate = [];
    const keysToDelete = [];

    if (!prevRevisions || !Object.keys(prevRevisions).length) {
      return { next, toUpdate, keysToDelete };
    }

    for (const p of raw) {
      for (const e of photoEntriesFromRawPoint(p)) {
        const prevByPath = prevRevisions[e.pathKey];
        if (prevByPath?.rev === e.rev) continue;

        const prevBySlot =
          e.bleId != null ? prevByBleSlot[`${e.bleId}:${e.slot}`] : null;
        const hadLocally =
          prevByPath != null ||
          prevBySlot != null ||
          fieldPhotoIsStored(e.url, existingKeys);

        if (!hadLocally) continue;

        if (prevBySlot?.pathKey && prevBySlot.pathKey !== e.pathKey) {
          keysToDelete.push(prevBySlot.pathKey);
        } else if (prevByPath && prevByPath.rev !== e.rev) {
          keysToDelete.push(e.pathKey);
        }

        toUpdate.push(e);
      }
    }

    return { next, toUpdate, keysToDelete };
  }

  async function syncChangedFieldPhotosAfterRefresh(companyId) {
    if (fieldPackDownloadActive || fieldPhotoRefreshActive || !navigator.onLine) return;
    const raw = bleListSnapshot?.raw;
    if (!Array.isArray(raw) || !raw.length) return;
    if (companyId && bleListSnapshot.companyId && Number(bleListSnapshot.companyId) !== Number(companyId)) {
      return;
    }

    fieldPhotoRefreshActive = true;
    let ok = 0;
    let fail = 0;
    try {
      const prevRevisions = await loadFieldPhotoRevisions();
      const existingKeys = await getFieldPhotoKeysSet();
      const { next, toUpdate, keysToDelete } = collectPhotoUpdatesAfterRefresh(
        raw,
        prevRevisions,
        existingKeys
      );

      if (!Object.keys(prevRevisions).length) {
        await commitFieldPhotoRevisions(next);
        return;
      }

      if (!toUpdate.length) {
        await commitFieldPhotoRevisions(next);
        return;
      }

      if (keysToDelete.length) {
        await deleteFieldPhotosByKeys(keysToDelete);
      }

      const total = toUpdate.length;
      setFieldPackStatus(`Обновление фото: 0 / ${total}…`, "busy");
      showMapMsg(`На сервере изменилось ${total} фото — докачиваем…`, "");

      let done = 0;
      let idx = 0;
      const workers = Math.min(fieldPackConcurrency(), total);

      const worker = async () => {
        while (idx < toUpdate.length) {
          if (fieldPackAbort?.signal.aborted) return;
          const i = idx++;
          const item = toUpdate[i];
          if (!item) continue;
          try {
            const blob = await fetchPhotoBlobForFieldWithRetry(item.url);
            if (blob?.size && blob.size <= BLE_FIELD_PHOTO_MAX_BYTES) {
              await persistFieldPhotoBlob(item.url, blob);
              ok++;
            } else {
              fail++;
            }
          } catch (e) {
            const msg = String(e?.message || e || "");
            if (msg !== "aborted") {
              fail++;
              console.warn("[ble-map] photo refresh", item.url.slice(0, 60), msg);
            }
          }
          done++;
          setFieldPackStatus(`Обновление фото: ${done} / ${total}…`, "busy");
        }
      };

      await Promise.all(Array.from({ length: workers }, () => worker()));
      await commitFieldPhotoRevisions(next);
      await refreshFieldPackChrome();

      if (ok > 0) {
        showMapMsg(
          `Обновлено ${ok} фото${fail ? ` (${fail} ошибок)` : ""} после ↺.`,
          fail ? "error" : ""
        );
        setTimeout(hideMapMsg, fail ? 5000 : 3500);
      } else if (fail > 0) {
        showMapMsg(`Не удалось обновить ${fail} фото. Повторите ↺ или «Скачать фото».`, "error");
      }
    } catch (e) {
      console.warn("[ble-map] photo refresh sync", e?.message || e);
    } finally {
      fieldPhotoRefreshActive = false;
      if (!fieldPackDownloadActive) {
        const st = document.getElementById("mapFieldPackStatus");
        if (st?.textContent?.startsWith("Обновление фото:")) {
          void refreshFieldPackChrome();
        }
      }
    }
  }

  async function findFieldPhotoDbKey(url) {
    if (!url) return null;
    const exact = String(url);
    try {
      const blob = await readFieldPhotoBlobFromDb(exact);
      if (blob) return exact;
    } catch {
      /* ignore */
    }
    const pathKey = photoUrlPathnameKey(exact);
    if (!pathKey) return null;
    try {
      const keys = await getFieldPhotoKeysSet();
      for (const key of keys) {
        if (photoUrlPathnameKey(key) === pathKey) return key;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function rememberFieldPhotoBlobUrl(sourceUrl, dbKey, blobUrl) {
    if (dbKey) fieldPhotoBlobUrls.set(dbKey, blobUrl);
    if (sourceUrl) fieldPhotoBlobUrls.set(String(sourceUrl), blobUrl);
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
    if (!text) return;
    const fsOpen = isMapFullscreenOpen();
    const el = fsOpen ? document.getElementById("mapFsMsg") : document.getElementById("mapMsg");
    if (!el) return;
    const textEl = el.querySelector(".map-msg__text");
    if (textEl) textEl.textContent = text;
    else el.textContent = text;
    const isError = type === "error";
    el.className =
      (el.id === "mapFsMsg" ? "map-msg map-fs-msg" : "map-msg") + (isError ? " error" : "");
    const closeBtn = el.querySelector(".map-msg__close");
    if (closeBtn) closeBtn.hidden = !isError;
    el.hidden = false;
    if (!fsOpen) syncMainMapMsgPosition();
  }

  function hideMapMsg() {
    const main = document.getElementById("mapMsg");
    const fs = document.getElementById("mapFsMsg");
    if (main) {
      main.hidden = true;
      main.style.removeProperty("top");
    }
    if (fs) fs.hidden = true;
  }

  function syncMainMapMsgPosition() {
    const msg = document.getElementById("mapMsg");
    if (!msg || msg.hidden) return;
    const dock = document.getElementById("mapFloatDock");
    if (!dock || dock.hidden) {
      msg.style.removeProperty("top");
      return;
    }
    const top = Math.max(0, dock.offsetTop + dock.offsetHeight + 8);
    msg.style.top = `${top}px`;
  }

  function wireMapMsgDismiss() {
    for (const id of ["mapMsg", "mapFsMsg"]) {
      document.getElementById(id)?.querySelector(".map-msg__close")?.addEventListener("click", hideMapMsg);
    }
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

  function isWorkerPreferredBlePath(path) {
    return BLE_WORKER_PREFERRED_PATHS.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`)
    );
  }

  function isMapDataBlePath(path) {
    return !!path && String(path).includes("/map_data");
  }

  function transportOrder(path) {
    if (path && path.includes("/token")) {
      return ["supabase", "worker"];
    }
    if (path && isWorkerOnlyBlePath(path)) {
      return isBleNativeApp() ? ["worker", "supabase"] : ["supabase", "worker"];
    }
    if (path && (isWorkerPreferredBlePath(path) || isMapDataBlePath(path))) {
      return isBleNativeApp() ? ["worker", "supabase"] : ["worker", "supabase"];
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
    if (isBleNativeApp()) return bleDirtyMarkers.size > 0;
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
    const native = isBleNativeApp();
    document.body.classList.toggle("ble-map--offline", offline);
    document.body.classList.toggle(
      "ble-map--offline-pending",
      native ? pending > 0 && !bleEditMode : pending > 0
    );

    const saveBtn = document.getElementById("mapSaveBtn");
    if (saveBtn && bleEditMode && !native) {
      if (offline && hasUnsavedEdits()) {
        saveBtn.textContent = "Сохранить локально";
      } else if (!offline && pending > 0) {
        saveBtn.textContent = pending === 1 ? "Отправить (1)" : `Отправить (${pending})`;
      } else {
        saveBtn.textContent = "Сохранить";
      }
    }

    const sendBtn = document.getElementById("mapSendPendingBtn");
    if (sendBtn) {
      if (native) {
        sendBtn.hidden = bleEditMode || pending === 0;
        sendBtn.disabled = offline || pending === 0;
        sendBtn.textContent =
          pending === 1 ? "Отправить (1)" : pending > 0 ? `Отправить (${pending})` : "Отправить";
        const long = sendBtn.querySelector(".map-toolbar-text--long");
        const short = sendBtn.querySelector(".map-toolbar-text--short");
        if (long) long.textContent = pending > 0 ? sendBtn.textContent : "Отправить";
        if (short) short.textContent = pending > 0 ? String(pending) : "↑";
      } else {
        sendBtn.hidden = true;
      }
    }

    if (offline || pending > 0) {
      const parts = [];
      if (offline) parts.push("Офлайн");
      if (pending) {
        if (native && bleEditMode) {
          /* статус отправки — только вне режима правки */
        } else {
          parts.push(`${pending} ${pending === 1 ? "правка" : "правок"} ждёт отправки`);
        }
      }
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

  function isNewZoneRecord(zoneId, dirty) {
    return Boolean(dirty?.isNew) || Number(zoneId) < 0;
  }

  function applyZoneNameToLocalState(zoneId, name) {
    const trimmed = normalizeZoneName(name);
    const zone = getZoneById(zoneId);
    if (zone) zone.name = trimmed;
    const entry = bleZoneLayers.get(zoneId);
    if (entry) entry.data.name = trimmed;
    const layer = entry?.layer;
    if (layer?.getTooltip()) {
      layer.setTooltipContent(trimmed || `Зона ${zoneId}`);
    }
    return trimmed;
  }

  function syncActiveZonePanelToDirty() {
    const zoneId = bleSelectedZoneId;
    if (zoneId == null) return;
    const input = document.getElementById("mapZoneNameInput");
    const panel = document.getElementById("mapZonePanel");
    if (!input || !panel || panel.hidden) return;
    const name = normalizeZoneName(input.value);
    if (!name) return;
    const zone = getZoneById(zoneId);
    const dirty = bleDirtyZones.get(zoneId);
    if (!zone && !dirty) return;
    const prevName = normalizeZoneName(dirty?.name ?? zone?.name ?? "");
    if (name === prevName && dirty) return;
    const pts = dirty?.pts ?? zone?.pts ?? [];
    const desc = dirty?.description ?? zone?.description ?? null;
    const isNew = isNewZoneRecord(zoneId, dirty);
    bleDirtyZones.set(zoneId, {
      name,
      description: desc,
      pts: pts.map((p) => [...p]),
      nameChanged: isNew || name !== prevName,
      isNew,
    });
    applyZoneNameToLocalState(zoneId, name);
  }

  function normalizeZoneName(name) {
    return String(name ?? "").trim();
  }

  function isZoneNameTaken(name, excludeZoneId = null) {
    const n = normalizeZoneName(name).toLowerCase();
    if (!n) return false;
    return bleZoneData.some((z) => {
      if (excludeZoneId != null && Number(z.id) === Number(excludeZoneId)) return false;
      return normalizeZoneName(z.name).toLowerCase() === n;
    });
  }

  function makeUniqueZoneName(baseName, excludeZoneId = null) {
    let name = normalizeZoneName(baseName) || "Новая зона";
    if (!isZoneNameTaken(name, excludeZoneId)) return name;
    const stem = name.replace(/\s*\(\d+\)$/, "");
    for (let i = 2; i < 100; i++) {
      const candidate = `${stem} (${i})`;
      if (!isZoneNameTaken(candidate, excludeZoneId)) return candidate;
    }
    return `${stem} (${Date.now() % 10000})`;
  }

  function resolveZoneRecordName(zoneId, nameHint) {
    const hint = normalizeZoneName(nameHint);
    if (hint) return hint;
    const zone = getZoneById(zoneId);
    return normalizeZoneName(zone?.name);
  }

  function markZoneDirty(zoneId, pts, name, description) {
    const id = Number(zoneId);
    const zone = getZoneById(id);
    const prev = bleDirtyZones.get(id);
    bleDirtyZones.set(id, {
      name: resolveZoneRecordName(id, name ?? prev?.name),
      description: description ?? prev?.description ?? zone?.description ?? null,
      pts: pts.map((p) => [p[0], p[1]]),
      nameChanged: prev?.nameChanged ?? false,
      isNew: isNewZoneRecord(id, prev),
    });
    updateEditBarState();
  }

  function isNarrowLayout() {
    return window.matchMedia("(max-width: 768px)").matches;
  }

  function isZoneEditAllowed() {
    if (isBleNativeApp()) return false;
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
    el.textContent = text || "";
  }

  function showZonePanel(zone) {
    const panel = document.getElementById("mapZonePanel");
    const input = document.getElementById("mapZoneNameInput");
    if (!panel || !input) return;
    const dirty = bleDirtyZones.get(zone.id);
    input.value = dirty?.name ?? zone.name ?? "";
    panel.hidden = false;
  }

  function hideZonePanel() {
    const panel = document.getElementById("mapZonePanel");
    if (panel) panel.hidden = true;
  }

  function cloneSelectedZone() {
    const id = bleSelectedZoneId;
    if (!id) return;
    const zone = getZoneById(id);
    if (!zone) return;
    const dirty = bleDirtyZones.get(id);
    const srcPts = (dirty?.pts || zone.pts || []).map((p) => [...p]);
    if (srcPts.length < 3) return;

    // Сдвигаем клон немного к северо-востоку, чтобы он был виден
    const offset = 0.00025;
    const clonedPts = srcPts.map((p) => [p[0] + offset, p[1] + offset]);

    const tempId = -(Date.now() % 100000000);
    const srcName = dirty?.name ?? zone.name ?? `Зона ${id}`;
    const cloneName = makeUniqueZoneName(`Копия — ${srcName}`, tempId);

    const sourceDirty = bleDirtyZones.get(id);
    if (sourceDirty) {
      bleDirtyZones.set(id, {
        name: normalizeZoneName(zone.name),
        description: sourceDirty.description ?? zone.description ?? null,
        pts: sourceDirty.pts.map((p) => [...p]),
        nameChanged: false,
        isNew: false,
      });
    }

    const newZone = {
      id: tempId,
      name: cloneName,
      description: zone.description ?? "",
      color: zone.color ?? "#0088cc",
      pts: clonedPts,
    };
    bleZoneData.push(newZone);
    bleDirtyZones.set(tempId, {
      name: cloneName,
      description: newZone.description,
      pts: clonedPts,
      isNew: true,
    });

    if (bleMap) drawZones(bleMap);
    if (bleMapFS && isMapFullscreenOpen()) drawZones(bleMapFS);
    selectZoneForEdit(tempId);
    updateEditBarState();
  }

  function wireZonePanel() {
    const input = document.getElementById("mapZoneNameInput");
    const cloneBtn = document.getElementById("mapZoneCloneBtn");

    const onZoneNameInput = () => {
      const id = bleSelectedZoneId;
      if (!id) return;
      const zone = getZoneById(id);
      const dirty = bleDirtyZones.get(id);
      const pts = dirty?.pts ?? zone?.pts ?? [];
      const desc = dirty?.description ?? zone?.description ?? null;
      const prevName = normalizeZoneName(dirty?.name ?? zone?.name ?? "");
      const name = normalizeZoneName(input.value);
      const isNew = isNewZoneRecord(id, dirty);
      bleDirtyZones.set(id, {
        name,
        description: desc,
        pts: pts.map((p) => [...p]),
        nameChanged: isNew || name !== prevName,
        isNew,
      });
      applyZoneNameToLocalState(id, name);
      updateEditBarState();
    };

    if (input) {
      input.addEventListener("input", onZoneNameInput);
      input.addEventListener("change", onZoneNameInput);
    }

    if (cloneBtn) {
      cloneBtn.addEventListener("click", cloneSelectedZone);
    }
  }

  function getZonePtsForAlign(zoneId) {
    const zone = getZoneById(zoneId);
    const dirty = bleDirtyZones.get(zoneId);
    const src = dirty?.pts ?? zone?.pts ?? [];
    return src.map((p) => [p[0], p[1]]);
  }

  function isAlignPickMode() {
    return bleAlignSettings.edge === "pick";
  }

  function alignVertexKey(zoneId, ptIndex) {
    return `${zoneId}:${ptIndex}`;
  }

  function toggleAlignVertex(zoneId, ptIndex) {
    const key = alignVertexKey(zoneId, ptIndex);
    if (bleAlignVertexKeys.has(key)) bleAlignVertexKeys.delete(key);
    else bleAlignVertexKeys.add(key);
    const map = getActiveMap();
    if (map) syncAlignPickHandles(map);
    updateZoneAlignUi();
  }

  function zoneHasPickedAlignVertex(zoneId) {
    const prefix = `${zoneId}:`;
    for (const key of bleAlignVertexKeys) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  function clearAlignPickHandles(targetMap) {
    if (!targetMap) return;
    const state = bleAlignPickByMap.get(targetMap);
    if (!state) return;
    try {
      if (state.group?._map) targetMap.removeLayer(state.group);
    } catch {
      /* ignore */
    }
    bleAlignPickByMap.delete(targetMap);
  }

  function syncAlignPickHandles(map) {
    clearAlignPickHandles(map);
    if (!map || !bleZoneAlignMode || !isAlignPickMode()) return;
    const group = L.layerGroup().addTo(map);
    const handles = [];
    bleZoneData.forEach((z) => {
      if (!z.id || z.pts.length < 3) return;
      const pts = getZonePtsForAlign(z.id);
      pts.forEach((p, ptIndex) => {
        const picked = bleAlignVertexKeys.has(alignVertexKey(z.id, ptIndex));
        const handle = L.circleMarker([p[0], p[1]], {
          radius: picked ? 9 : 7,
          color: picked ? "#ffffff" : "#e65100",
          fillColor: picked ? "#76ff03" : "#ff9800",
          fillOpacity: 1,
          weight: picked ? 3 : 2,
          interactive: true,
          className: "ble-zone-align-pick-handle" + (picked ? " is-picked" : ""),
        });
        handle.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          toggleAlignVertex(z.id, ptIndex);
        });
        handle.addTo(group);
        handles.push(handle);
      });
    });
    try {
      group.bringToFront?.();
    } catch {
      /* ignore */
    }
    bleAlignPickByMap.set(map, { group, handles });
  }

  function pickZoneVertexIndex(pts, edge) {
    if (!pts.length) return 0;
    let idx = 0;
    for (let i = 1; i < pts.length; i++) {
      const [lat, lng] = pts[i];
      const [bestLat, bestLng] = pts[idx];
      if (edge === "top" && lat > bestLat) idx = i;
      else if (edge === "bottom" && lat < bestLat) idx = i;
      else if (edge === "left" && lng < bestLng) idx = i;
      else if (edge === "right" && lng > bestLng) idx = i;
    }
    return idx;
  }

  function collectZoneAlignTargets() {
    if (isAlignPickMode()) {
      const targets = [];
      for (const key of bleAlignVertexKeys) {
        const sep = key.indexOf(":");
        if (sep < 0) continue;
        const zoneId = Number(key.slice(0, sep));
        const ptIndex = Number(key.slice(sep + 1));
        const pts = getZonePtsForAlign(zoneId);
        if (ptIndex < 0 || ptIndex >= pts.length) continue;
        const [lat, lng] = pts[ptIndex];
        targets.push({ zoneId, ptIndex, lat, lng });
      }
      return targets;
    }
    const targets = [];
    for (const zoneId of bleAlignZoneIds) {
      const pts = getZonePtsForAlign(zoneId);
      if (pts.length < 3) continue;
      const ptIndex = pickZoneVertexIndex(pts, bleAlignSettings.edge);
      const [lat, lng] = pts[ptIndex];
      targets.push({ zoneId, ptIndex, lat, lng });
    }
    return targets;
  }

  function projectPointOntoLineDeg(point, lineA, lineB) {
    const cosLat = Math.cos((lineA.lat * Math.PI) / 180);
    const bx = (lineB.lng - lineA.lng) * M_PER_DEG_LAT * cosLat;
    const by = (lineB.lat - lineA.lat) * M_PER_DEG_LAT;
    const px = (point.lng - lineA.lng) * M_PER_DEG_LAT * cosLat;
    const py = (point.lat - lineA.lat) * M_PER_DEG_LAT;
    const len2 = bx * bx + by * by;
    if (len2 < 1e-12) return L.latLng(point.lat, point.lng);
    const t = (px * bx + py * by) / len2;
    return L.latLng(
      lineA.lat + (by * t) / M_PER_DEG_LAT,
      lineA.lng + (bx * t) / (M_PER_DEG_LAT * cosLat)
    );
  }

  function applyZoneVertexEdit(zoneId, pts) {
    const zone = getZoneById(zoneId);
    markZoneDirty(
      zoneId,
      pts,
      bleDirtyZones.get(zoneId)?.name ?? zone?.name,
      bleDirtyZones.get(zoneId)?.description ?? zone?.description ?? null
    );
    const entry = bleZoneLayers.get(zoneId);
    if (entry?.layer) {
      entry.layer.setLatLngs(pts.map((p) => L.latLng(p[0], p[1])));
      entry.data.pts = pts.map((p) => [...p]);
    }
  }

  function applyZoneAlign() {
    const targets = collectZoneAlignTargets();
    const pickMode = isAlignPickMode();
    if (targets.length < 2) {
      updateZoneAlignHint(
        pickMode ? "Выберите минимум две вершины (оранжевые точки)." : "Выберите минимум две зоны."
      );
      return;
    }
    if (bleAlignSettings.axis === "line") {
      if (bleAlignLinePts.length < 2) {
        updateZoneAlignHint("Два клика на карте — опорная линия.");
        return;
      }
      const [lineA, lineB] = bleAlignLinePts;
      for (const t of targets) {
        const pts = getZonePtsForAlign(t.zoneId);
        const projected = projectPointOntoLineDeg(L.latLng(t.lat, t.lng), lineA, lineB);
        pts[t.ptIndex][0] = projected.lat;
        pts[t.ptIndex][1] = projected.lng;
        applyZoneVertexEdit(t.zoneId, pts);
      }
    } else if (bleAlignSettings.axis === "horizontal") {
      const lats = targets.map((t) => t.lat);
      const level =
        bleAlignSettings.ref === "min"
          ? Math.min(...lats)
          : bleAlignSettings.ref === "avg"
            ? lats.reduce((a, b) => a + b, 0) / lats.length
            : Math.max(...lats);
      for (const t of targets) {
        const pts = getZonePtsForAlign(t.zoneId);
        pts[t.ptIndex][0] = level;
        applyZoneVertexEdit(t.zoneId, pts);
      }
    } else {
      const lngs = targets.map((t) => t.lng);
      const level =
        bleAlignSettings.ref === "min"
          ? Math.min(...lngs)
          : bleAlignSettings.ref === "avg"
            ? lngs.reduce((a, b) => a + b, 0) / lngs.length
            : Math.max(...lngs);
      for (const t of targets) {
        const pts = getZonePtsForAlign(t.zoneId);
        pts[t.ptIndex][1] = level;
        applyZoneVertexEdit(t.zoneId, pts);
      }
    }
    redrawMapLayers();
    updateZoneAlignUi();
    updateEditBarState();
    updateZoneAlignHint(`Выровнено вершин: ${targets.length}. «Сохранить» — записать на сервер.`);
  }

  function toggleAlignZone(zoneId) {
    const id = Number(zoneId);
    if (!id) return;
    if (bleAlignZoneIds.has(id)) bleAlignZoneIds.delete(id);
    else bleAlignZoneIds.add(id);
    bleSelectedZoneId = null;
    hideZonePanel();
    disableAllZonePm();
    redrawMapLayers();
    updateZoneAlignUi();
    updateEditBarState();
  }

  function resetAlignSelectionKeepMode() {
    const hadSelection = bleAlignZoneIds.size > 0 || bleAlignVertexKeys.size > 0;
    bleAlignZoneIds.clear();
    bleAlignVertexKeys.clear();
    if (hadSelection) updateZoneAlignUi();
    return hadSelection;
  }

  function clearAlignSelection() {
    bleAlignZoneIds.clear();
    bleAlignVertexKeys.clear();
    bleAlignLinePts = [];
    bleAlignPreview = null;
    redrawMapLayers();
    renderBleDrawOnAllMaps();
    updateZoneAlignUi();
  }

  function updateZoneAlignHint(text) {
    const el = document.getElementById("mapZoneAlignHint");
    if (el) el.textContent = text || "";
  }

  function updateZoneAlignUi() {
    const panel = document.getElementById("mapZoneAlignPanel");
    const countEl = document.getElementById("mapZoneAlignCount");
    const applyBtn = document.getElementById("mapZoneAlignApplyBtn");
    const refField = document.getElementById("mapZoneAlignRefField");
    const edgeSel = document.getElementById("mapZoneAlignEdge");
    const axisSel = document.getElementById("mapZoneAlignAxis");
    const refSel = document.getElementById("mapZoneAlignRef");
    if (panel) panel.hidden = !bleZoneAlignMode;
    const pickMode = isAlignPickMode();
    if (countEl) {
      countEl.textContent = pickMode
        ? `Вершин: ${bleAlignVertexKeys.size}`
        : `Зон: ${bleAlignZoneIds.size}`;
    }
    const lineMode = bleAlignSettings.axis === "line";
    if (refField) refField.hidden = lineMode;
    if (edgeSel) edgeSel.value = bleAlignSettings.edge;
    if (axisSel) axisSel.value = bleAlignSettings.axis;
    if (refSel) refSel.value = bleAlignSettings.ref;
    const selectedCount = pickMode ? bleAlignVertexKeys.size : bleAlignZoneIds.size;
    const canApply = selectedCount >= 2 && (!lineMode || bleAlignLinePts.length >= 2);
    if (applyBtn) applyBtn.disabled = !canApply;
    if (!bleZoneAlignMode) return;
    if (pickMode) {
      if (lineMode) {
        updateZoneAlignHint(
          bleAlignLinePts.length >= 2
            ? "Линия задана. «Выровнять» — спроецировать выбранные вершины на неё."
            : bleAlignLinePts.length === 1
              ? "Второй клик на карте — конец опорной линии (Shift — угол 15°)."
              : "Кликайте оранжевые точки на зонах, затем два клика на карте — линия."
        );
      } else {
        updateZoneAlignHint(
          "Кликайте оранжевые точки на зонах — выбранные подсветятся зелёным. Затем «Выровнять»."
        );
      }
      return;
    }
    if (lineMode) {
      updateZoneAlignHint(
        bleAlignLinePts.length >= 2
          ? "Линия задана. «Выровнять» — спроецировать вершины на неё."
          : bleAlignLinePts.length === 1
            ? "Второй клик на карте — конец опорной линии."
            : "Кликайте зоны для выбора. Два клика на карте — линия выравнивания."
      );
    } else {
      updateZoneAlignHint(
        "Кликайте по зонам, чтобы добавить или убрать из выбора. Затем «Выровнять»."
      );
    }
  }

  function detachAlignMapListeners() {
    if (!bleAlignMapListeners) return;
    const { map, onClick, onMove } = bleAlignMapListeners;
    map.off("click", onClick);
    map.off("mousemove", onMove);
    bleAlignMapListeners = null;
  }

  function attachAlignMapListeners() {
    detachAlignMapListeners();
    if (!bleZoneAlignMode || bleAlignSettings.axis !== "line") return;
    const map = getActiveMap();
    if (!map) return;
    const onClick = (e) => {
      if (!bleZoneAlignMode || bleAlignSettings.axis !== "line") return;
      if (bleAlignLinePts.length >= 2) bleAlignLinePts = [];
      L.DomEvent.stopPropagation(e);
      let ll = e.latlng;
      if (bleAlignLinePts.length === 1 && e.originalEvent?.shiftKey) {
        ll = snapDrawLatLng(bleAlignLinePts[0], ll, true);
      }
      bleAlignLinePts.push(ll);
      bleAlignPreview = null;
      updateZoneAlignUi();
      renderBleDrawOnAllMaps();
    };
    const onMove = (e) => {
      if (!bleZoneAlignMode || bleAlignSettings.axis !== "line") return;
      if (bleAlignLinePts.length === 1) {
        let ll = e.latlng;
        if (e.originalEvent?.shiftKey) ll = snapDrawLatLng(bleAlignLinePts[0], ll, true);
        bleAlignPreview = ll;
        renderBleDrawOnAllMaps();
      }
    };
    map.on("click", onClick);
    map.on("mousemove", onMove);
    bleAlignMapListeners = { map, onClick, onMove };
  }

  function setBleZoneAlignMode(on) {
    bleZoneAlignMode = !!on;
    if (bleZoneAlignMode) {
      stopBleDrawTools();
      bleSelectedZoneId = null;
      hideZonePanel();
      disableAllZonePm();
    } else {
      bleAlignZoneIds.clear();
      bleAlignVertexKeys.clear();
      bleAlignLinePts = [];
      bleAlignPreview = null;
      detachAlignMapListeners();
    }
    document.body.classList.toggle("ble-map--zone-align", bleZoneAlignMode);
    updateZoneAlignUi();
    attachAlignMapListeners();
    redrawMapLayers();
    renderBleDrawOnAllMaps();
    updateEditBarState();
  }

  function wireZoneAlignPanel() {
    if (document.body.dataset.bleZoneAlignWired === "1") return;
    document.body.dataset.bleZoneAlignWired = "1";
    document.getElementById("mapZoneAlignEdge")?.addEventListener("change", (e) => {
      bleAlignSettings.edge = e.target.value || "top";
      if (isAlignPickMode()) bleAlignZoneIds.clear();
      else bleAlignVertexKeys.clear();
      bleAlignLinePts = [];
      bleAlignPreview = null;
      redrawMapLayers();
      renderBleDrawOnAllMaps();
      updateZoneAlignUi();
      attachAlignMapListeners();
    });
    document.getElementById("mapZoneAlignAxis")?.addEventListener("change", (e) => {
      bleAlignSettings.axis = e.target.value || "horizontal";
      bleAlignLinePts = [];
      bleAlignPreview = null;
      updateZoneAlignUi();
      attachAlignMapListeners();
      renderBleDrawOnAllMaps();
    });
    document.getElementById("mapZoneAlignRef")?.addEventListener("change", (e) => {
      bleAlignSettings.ref = e.target.value || "max";
      updateZoneAlignUi();
    });
    document.getElementById("mapZoneAlignApplyBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      applyZoneAlign();
    });
    document.getElementById("mapZoneAlignClearBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      clearAlignSelection();
    });
    document.getElementById("mapZoneAlignCloseBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      setBleZoneAlignMode(false);
    });
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
    clearAlignPickHandles(targetMap);
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

    if (bleZoneAlignMode && bleAlignLinePts.length) {
      const pts = [...bleAlignLinePts];
      if (pts.length === 1 && bleAlignPreview) pts.push(bleAlignPreview);
      if (pts.length >= 2) {
        drawSegmentWithLabel(group, pts[0], pts[1], {
          color: "#e65100",
          weight: 3,
          dashArray: "8 6",
        });
      } else if (pts.length === 1) {
        L.circleMarker(pts[0], {
          radius: 5,
          color: "#e65100",
          fillColor: "#ff9800",
          fillOpacity: 1,
          weight: 2,
          interactive: false,
        }).addTo(group);
      }
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
          "Чертёж: линейка, линия, параллельные. «Выровнять зоны» — выстроить вершины по линии."
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
      return;
    }
    if (bleZoneAlignMode) {
      updateZoneAlignUi();
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
    if (tool) setBleZoneAlignMode(false);
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

  function stopZoneAlignTool() {
    setBleZoneAlignMode(false);
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
    hideZonePanel();
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
      hideZonePanel();
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
    const zone = getZoneById(id);
    if (zone) showZonePanel(zone);
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
    const native = isBleNativeApp();
    if (saveBtn) {
      if (native) {
        saveBtn.textContent = "Запомнить";
        saveBtn.disabled = !bleEditMode || !hasUnsavedEdits();
      } else {
        const canSave = hasUnsavedEdits() || (pending > 0 && navigator.onLine);
        saveBtn.disabled = !canSave;
      }
    }
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
    if (isBleNativeApp()) {
      const q = loadOfflineMarkerQueue();
      bleDirtyMarkers.forEach(({ point, origLat, origLng }) => {
        const queued = q.edits.find((e) => e.id === point.id);
        if (queued?.lat != null && queued?.lng != null) {
          point.lat = queued.lat;
          point.lng = queued.lng;
        } else {
          point.lat = origLat;
          point.lng = origLng;
        }
      });
    } else {
      bleDirtyMarkers.forEach(({ point, origLat, origLng }) => {
        point.lat = origLat;
        point.lng = origLng;
        removeOfflineMarkerEdit(point.id);
      });
    }
    bleDirtyMarkers.clear();
    /* Удаляем временные (клонированные) зоны с temp-ID перед откатом */
    bleDirtyZones.forEach((dirty, zid) => {
      if (dirty.isNew) {
        bleZoneData = bleZoneData.filter((z) => z.id !== zid);
        bleZoneLayers.delete(zid);
      }
    });
    [...bleDirtyZones.keys()].forEach((zid) => revertZoneGeometry(zid));
    bleDirtyZones.clear();
    stopBleDrawTools();
    stopZoneAlignTool();
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
    if (raw.includes("supabase_proxy_")) {
      const via = formatBleError(err, err.bleTriedTransports || ["supabase", "worker"]);
      if (via !== raw) return via;
      return "Прокси Supabase временно недоступен для зон. Повторите сохранение или включите VPN.";
    }
    if (raw.includes("BLE_ZONE_VALIDATION_NAME_EXIST")) {
      const quoted = raw.match(/«([^»]+)»/);
      if (quoted) return `Зона «${quoted[1]}» уже существует. Укажите другое имя.`;
      if (/уже существует/i.test(raw)) return raw.replace(/^Error:\s*/i, "").slice(0, 200);
      return "Такое имя зоны уже занято. Укажите другое имя.";
    }
    return raw;
  }

  async function saveDirtyZones() {
    syncActiveZonePanelToDirty();
    if (!bleDirtyZones.size) return 0;
    let saved = 0;
    for (const [zoneId, dirty] of bleDirtyZones) {
      const pts = dirty.pts;
      if (pts.length < 3) throw new Error(`У зоны ${zoneId} должно быть минимум 3 точки`);
      const isNew = isNewZoneRecord(zoneId, dirty);

      if (isNew) {
        let zoneName = normalizeZoneName(dirty.name) || "Новая зона";
        if (isZoneNameTaken(zoneName, zoneId)) {
          if (dirty.nameChanged) {
            throw new Error(`Зона «${zoneName}» уже существует. Укажите другое имя.`);
          }
          zoneName = makeUniqueZoneName(zoneName, zoneId);
        }
        let created = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            created = await bleApiMutate("POST", "/api/v1/ble_zone", {
              name: zoneName,
              description: dirty.description ?? "",
              points: ptsToApiPoints(pts),
            });
            break;
          } catch (e) {
            if (
              attempt < 4 &&
              String(e.message || "").includes("BLE_ZONE_VALIDATION_NAME_EXIST")
            ) {
              zoneName = makeUniqueZoneName(`${zoneName} (${attempt + 2})`, zoneId);
              continue;
            }
            throw e;
          }
        }
        const newId = created?.id;
        const z = bleZoneData.find((x) => x.id === zoneId);
        if (z) {
          z.pts = pts.map((p) => [...p]);
          z.name = zoneName;
          if (newId) z.id = newId;
          z.isNew = false;
        }
      } else {
        const body = { points: ptsToApiPoints(pts) };
        if (dirty.nameChanged) {
          const trimmed = normalizeZoneName(dirty.name);
          if (!trimmed) throw new Error(`У зоны ${zoneId} должно быть имя`);
          if (isZoneNameTaken(trimmed, zoneId)) {
            throw new Error(`Зона «${trimmed}» уже существует. Укажите другое имя.`);
          }
          body.name = trimmed;
          if (dirty.description !== undefined) body.description = dirty.description;
        }
        try {
          await bleApiMutate("PUT", `/api/v1/ble_zone/${zoneId}`, body);
        } catch (e) {
          if (String(e.message || "").includes("BLE_ZONE_VALIDATION_NAME_EXIST")) {
            if (dirty.nameChanged) {
              throw new Error(
                `BLE_ZONE_VALIDATION_NAME_EXIST: «${body.name || dirty.name || ""}»`
              );
            }
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
        if (z) {
          z.pts = pts.map((p) => [...p]);
          if (dirty.nameChanged && dirty.name !== undefined) z.name = normalizeZoneName(dirty.name);
          if (dirty.description !== undefined) z.description = dirty.description;
        }
        const entry = bleZoneLayers.get(zoneId);
        if (entry) {
          entry.data.pts = pts.map((p) => [...p]);
          if (dirty.nameChanged && dirty.name !== undefined) {
            entry.data.name = normalizeZoneName(dirty.name);
          }
        }
      }
      saved++;
    }
    bleDirtyZones.clear();
    bleSelectedZoneId = null;
    disableAllZonePm();
    resetZoneStyles();
    syncZoneEditUiClasses();
    hideZonePanel();
    updateZoneEditHint("");
    return saved;
  }

  async function rememberEdits() {
    if (!isBleNativeApp() || !bleEditMode) return;
    const btn = document.getElementById("mapSaveBtn");
    if (btn) btn.disabled = true;
    try {
      if (hasUnsavedEdits()) {
        mergeDirtyMarkersIntoOfflineQueue();
        bleDirtyMarkers.clear();
      }
      const pending = countOfflinePendingEdits();
      setEditMode(false, { skipConfirm: true });
      if (pending > 0) {
        showMapMsg(
          `Запомнено на устройстве: ${pending} ${pending === 1 ? "метка" : "меток"}. Отправка — кнопкой «Отправить».`,
          ""
        );
        setTimeout(hideMapMsg, 4500);
      }
      redrawMapLayers();
    } finally {
      updateEditBarState();
    }
  }

  async function sendPendingMarkerEdits() {
    if (!isBleNativeApp()) return;
    const btn = document.getElementById("mapSendPendingBtn");
    if (btn) btn.disabled = true;
    try {
      if (!countOfflinePendingEdits()) return;
      if (!navigator.onLine) {
        alert("Нет сети. Подключитесь к Wi‑Fi/VPN и нажмите «Отправить».");
        return;
      }
      const n = await flushOfflineMarkerEditQueue();
      if (!n) showMapMsg("Нечего отправлять.", "");
    } catch (e) {
      showMapMsg(
        "Ошибка отправки: " +
          (e?.message || e) +
          (countOfflinePendingEdits() ? " Правки остались на устройстве." : ""),
        "error"
      );
    } finally {
      updateEditBarState();
    }
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
      resetAlignSelectionKeepMode();
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

  async function onSaveEditClick() {
    if (isBleNativeApp()) await rememberEdits();
    else await saveAllEdits();
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
      const native = isBleNativeApp();
      let confirmText;
      if (native) {
        confirmText = mobile
          ? "Режим редактирования меток.\n\nУдержите метку 1 сек., перетащите.\n«Запомнить» — сохранить на устройстве.\n«Отправить» — на сервер (вне режима правки).\n\nПродолжить?"
          : "Режим редактирования положения меток.\n\n• Удержите метку 1 сек., затем перетащите\n• «Запомнить» — сохранить на устройстве и выйти\n• «Отправить» — отправить на сервер VSM (кнопка вне режима правки)\n\nПродолжить?";
      } else {
        const offlineHint = !navigator.onLine
          ? "\n\nСейчас без сети: метки можно двигать, правки сохранятся на телефоне и уйдут на сервер, когда появится интернет."
          : "";
        confirmText = mobile
          ? `Режим редактирования меток VSM.\n\n• Удержите метку 1 сек., затем перетащите${offlineHint}\n\nПродолжить?`
          : `Режим редактирования меняет данные на сервере VSM.\n\n• Метки: удержите 1 сек., затем перетащите\n• Зоны: оранжевые точки — вершины; Shift + перетаскивание — зона целиком\n• «Сохранить» — записать на сервер (или локально без сети)${offlineHint}\n\nПродолжить?`;
      }
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
      bleEditMapMsg = isBleNativeApp()
        ? isCoarseMobile()
          ? "Удержите метку 1 сек., перетащите. «Запомнить» — на устройство."
          : "Удержите метку 1 сек., перетащите. «Запомнить» — на устройство, «Отправить» — на сервер."
        : isCoarseMobile()
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
      stopZoneAlignTool();
      closeAllToolsMenus();
      clearBleDrawArtifacts();
      disableAllZonePm();
      bleSelectedZoneId = null;
      syncZoneEditUiClasses();
      hideZonePanel();
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
    requestAnimationFrame(updateMapFloatDockTopInset);
  }

  function drawZones(targetMap, opts = {}) {
    if (!targetMap) return;
    const forEdit =
      isZoneEditAllowed() && targetMap === getActiveMap() && opts.forEdit !== false;
    const zoneFocused = forEdit && bleSelectedZoneId != null && !bleZoneAlignMode;
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
      const inAlignSet =
        bleZoneAlignMode &&
        (isAlignPickMode()
          ? zoneHasPickedAlignVertex(z.id)
          : bleAlignZoneIds.has(z.id));
      const isSelected = bleSelectedZoneId === z.id || inAlignSet;
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
        interactive: true,
        className: inAlignSet ? "ble-zone-align-target" : "",
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
          if (bleZoneAlignMode) {
            if (isAlignPickMode()) return;
            toggleAlignZone(z.id);
            return;
          }
          selectZoneForEdit(z.id);
        });
        bleZoneLayers.set(z.id, { layer, data: z });
      }
      layer.addTo(group);
    });
    if (forEdit && bleSelectedZoneId && !bleZoneAlignMode) {
      const entry = bleZoneLayers.get(bleSelectedZoneId);
      if (entry?.layer) scheduleZoneVertexHandles(entry.layer, entry.data);
    }
    if (forEdit && bleZoneAlignMode && isAlignPickMode()) {
      syncAlignPickHandles(targetMap);
    }
  }

  function isMainSitePolygonZone(z) {
    const label = `${z.name || ""} ${z.description || ""}`.toLowerCase();
    return label.includes("spg_tsb") || label.includes("spg-tsb");
  }

  const POLYGON_EXPORT_LABEL_NONE = "Без полигона";
  const POLYGON_EXPORT_LABEL_MAIN = "Основной полигон";

  function polygonAreaSqDeg(ring) {
    if (!ring || ring.length < 3) return 0;
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][0];
      const xi = ring[i][1];
      const yj = ring[j][0];
      const xj = ring[j][1];
      area += (xj + xi) * (yj - yi);
    }
    return Math.abs(area / 2);
  }

  function getZonesForPolygonExport() {
    const out = [];
    for (const z of bleZoneData) {
      const pts = getZoneDisplayPts(z);
      if (!pts || pts.length < 3) continue;
      out.push({
        zone: z,
        pts,
        area: polygonAreaSqDeg(pts),
        isMain: isMainSitePolygonZone(z),
        name: normalizeZoneName(z.name) || `Зона ${z.id}`,
      });
    }
    return out;
  }

  function resolveMarkerPolygonLabel(pt) {
    if (pt?.lat == null || pt?.lng == null) return POLYGON_EXPORT_LABEL_NONE;
    const containing = [];
    for (const z of getZonesForPolygonExport()) {
      if (pointInPolygon(pt.lat, pt.lng, z.pts)) containing.push(z);
    }
    if (!containing.length) return POLYGON_EXPORT_LABEL_NONE;
    const nonMain = containing.filter((z) => !z.isMain);
    const pool = nonMain.length ? nonMain : containing;
    pool.sort((a, b) => a.area - b.area);
    const pick = pool[0];
    if (pick.isMain && !nonMain.length) return POLYGON_EXPORT_LABEL_MAIN;
    return pick.name;
  }

  function collectMarkersForPolygonExport() {
    return bleMapData
      .filter((pt) => pt.lat != null && pt.lng != null && pointPassesRouteFilter(pt))
      .map((pt) => ({
        ble: String(pt.ble || pt.id || "").trim(),
        polygon: resolveMarkerPolygonLabel(pt),
      }))
      .filter((row) => row.ble);
  }

  function csvEscapeCell(value) {
    const v = String(value ?? "");
    if (/[",;\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }

  function buildPolygonMarkersCsv(rows) {
    const lines = ["№ метки;Полигон"];
    for (const row of rows) {
      lines.push(`${csvEscapeCell(row.ble)};${csvEscapeCell(row.polygon)}`);
    }
    return `\uFEFF${lines.join("\r\n")}`;
  }

  function downloadCsvFile(filename, csvText) {
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  let polygonExportActive = false;

  async function onPolygonMarkersExportClick(e) {
    if (polygonExportActive || routeExportActive || fieldPackDownloadActive) return;
    e?.preventDefault?.();
    e?.stopPropagation?.();

    const route = getActiveRouteForFieldSync();
    const routeNote = route
      ? `Только маршрут «${routeTitlePlain(route.routeId)}».`
      : "Все маршруты (фильтр «Все»).";
    if (
      !confirm(
        `Выгрузить CSV: № метки и полигон, в котором она находится?\n\n${routeNote}\n\n` +
          "«Без полигона» — вне зон; «Основной полигон» — внутри контура площадки без вложенной зоны."
      )
    ) {
      return;
    }

    polygonExportActive = true;
    const btn = document.getElementById("mapPolygonExportBtn");
    if (btn) btn.disabled = true;
    setRouteExportStatus("Подготовка выгрузки по полигонам…", "busy");

    try {
      const rows = collectMarkersForPolygonExport();
      if (!rows.length) {
        alert("Нет меток с координатами для выгрузки. Нажмите «Обновить» по Wi‑Fi/VPN.");
        return;
      }
      rows.sort((a, b) => String(a.ble).localeCompare(String(b.ble), "ru", { numeric: true }));

      await yieldToMain();
      const csv = buildPolygonMarkersCsv(rows);
      const date = new Date().toISOString().slice(0, 10);
      const routeSlug = route ? `-${sanitizeRouteFileName(routeTitlePlain(route.routeId))}` : "";
      const fname = `ble-polygons${routeSlug}-${date}.csv`;

      setRouteExportStatus("Скачивание CSV…", "busy");
      downloadCsvFile(fname, csv);
      setRouteExportStatus(`Скачан ${fname} · ${rows.length} меток`);
      setTimeout(() => setRouteExportStatus(""), 5000);
    } catch (err) {
      alert(`Не удалось выгрузить: ${String(err?.message || err).slice(0, 180)}`);
      setRouteExportStatus("");
    } finally {
      polygonExportActive = false;
      if (btn) btn.disabled = false;
    }
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
    if (toolsField) toolsField.hidden = isBleNativeApp() ? true : !bleEditMode;
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
    const native = isBleNativeApp();
    return {
      detectRetina: false,
      updateWhenIdle: mobile || native,
      updateWhenZooming: !native,
      keepBuffer: native ? 2 : 4,
      minZoom: BLE_MAP_MIN_ZOOM,
      maxZoom: BLE_MAP_EDIT_MAX_ZOOM,
      maxNativeZoom: nativeZoom,
    };
  }

  function useBundledSatelliteTiles() {
    return isBleNativeApp();
  }

  function satelliteTileUrlTemplate() {
    return useBundledSatelliteTiles() ? BLE_SATELLITE_BUNDLED_URL : BLE_SATELLITE_ONLINE_URL;
  }

  function satelliteTileLayerOpts(mobile, extra = {}) {
    const bundled = useBundledSatelliteTiles();
    return {
      attribution: bundled ? "Esri (в приложении)" : "Esri",
      ...tileLayerZoomOpts(mobile, BLE_SATELLITE_NATIVE_ZOOM),
      ...(bundled
        ? {
            crossOrigin: false,
            errorTileUrl:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          }
        : {}),
      ...extra,
    };
  }

  function createBleSatelliteUnderlay(mobile) {
    return L.tileLayer(satelliteTileUrlTemplate(), {
      opacity: 0.38,
      ...satelliteTileLayerOpts(mobile),
    });
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
    const satellite = L.tileLayer(satelliteTileUrlTemplate(), satelliteTileLayerOpts(mobile));
    const street = useBundledSatelliteTiles()
      ? satellite
      : L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
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
    if (isBleNativeApp() && (layerId === "street" || layerId === "hybrid")) return "satellite";
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
      if (stored) return normalizeBaseLayerId(stored);
    } catch {
      /* ignore */
    }
    return isBleNativeApp() ? "satellite" : "street";
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
        if (action === "align-zones") {
          if (!bleEditMode || !isZoneEditAllowed()) return;
          setBleZoneAlignMode(!bleZoneAlignMode);
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
      bleImageStatus: point.ble_image_status || "",
      locationImageStatus: point.ble_location_image_status || "",
    };
  }

  function summarizeRoutePhotoStats(raw) {
    const stats = {
      urlCount: 0,
      markersWithPhotos: 0,
      markersNoPhoto: 0,
      noPhotoBle: [],
    };
    if (!Array.isArray(raw)) return stats;
    stats.urlCount = collectPhotoUrlsFromRaw(raw, { allowExpired: true }).length;
    for (const p of raw) {
      const tag = pickFirstUrl(p, ["ble_image_url", "bleImageUrl", "ble_image"]);
      const place = pickFirstUrl(p, ["location_image_url", "locationImageUrl", "location_image"]);
      const ble = String(p.ble_number ?? p.bleNumber ?? "");
      if (tag || place) {
        stats.markersWithPhotos++;
        continue;
      }
      const st = p.ble_image_status || p.ble_location_image_status || "";
      if (st === "no_photo" || !tag) {
        stats.markersNoPhoto++;
        if (ble) stats.noPhotoBle.push(ble);
      }
    }
    return stats;
  }

  function photoUnavailableHint(pt) {
    if (pt?.photoTag || pt?.photoPlace) return null;
    const tagSt = pt.bleImageStatus || "";
    const placeSt = pt.locationImageStatus || "";
    if (tagSt === "no_photo" || placeSt === "no_photo") {
      return "На сервере VSM нет фото этой метки (статус no_photo). Обход возможен по координатам; снимок нужно загрузить в VSM с объекта.";
    }
    if (tagSt === "stale_photo" || placeSt === "stale_photo") {
      return "Фото на сервере устарело. Нажмите «Обновить» (↺), затем «Скачать фото».";
    }
    if (navigator.onLine) {
      return "Нет ссылки на фото в API. «Обновить» (↺) → «Скачать фото» для маршрута.";
    }
    return `Фото не в ${fieldMemoryLabel()}. По Wi‑Fi/VPN: «Скачать фото» для выбранного маршрута.`;
  }

  function formatRouteSyncDoneMessage(route, slimRaw, raw, photosOk, photoUrls, photosFail) {
    const st = summarizeRoutePhotoStats(raw);
    let msg = `Готово к полю.\n\nМаршрут: ${route.routeTitle}\nМеток: ${slimRaw.length}\n`;
    msg += `Скачано файлов фото: ${photosOk} из ${photoUrls.length}\n`;
    msg += `Меток с фото на сервере: ${st.markersWithPhotos}`;
    if (st.markersNoPhoto) {
      msg += `\nБез фото на сервере: ${st.markersNoPhoto}`;
      if (st.noPhotoBle.length) msg += ` (№ ${st.noPhotoBle.join(", ")})`;
    }
    if (photosFail) msg += `\n\nНе скачалось: ${photosFail} (повторите синхронизацию).`;
    if (st.markersNoPhoto && !st.markersWithPhotos) {
      msg += "\n\nСинхронизация не добавит фото — их нет в VSM для этого маршрута.";
    } else if (st.markersNoPhoto) {
      msg += "\n\nУ части меток фото в VSM ещё нет — в поле будут только координаты.";
    }
    msg += "\n\nБез связи откройте карту — данные из памяти телефона.";
    msg += "\n\nДля файла в «Файлы» — кнопка «Сохранить файл» (не «Офлайн»).";
    return msg;
  }

  function readFieldPackReadyMarker() {
    try {
      const raw = localStorage.getItem(BLE_FIELD_READY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.routeId) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function setFieldPackReadyMarker(route, companyId) {
    if (!route?.routeId) return;
    try {
      localStorage.setItem(
        BLE_FIELD_READY_KEY,
        JSON.stringify({
          routeId: String(route.routeId),
          routeTitle: route.routeTitle || "",
          companyId: companyId ?? bleCompanyId ?? BLE_DEFAULT_COMPANY_ID,
          at: new Date().toISOString(),
        })
      );
    } catch {
      /* ignore */
    }
  }

  function clearFieldPackReadyMarker() {
    try {
      localStorage.removeItem(BLE_FIELD_READY_KEY);
    } catch {
      /* ignore */
    }
  }

  async function hasFieldPackInStorage() {
    const raw = await loadFieldPackMarkers();
    if (raw?.length) return true;
    const meta = await loadFieldPackMeta();
    return !!(meta?.markerCount || meta?.routeId);
  }

  function routeTitlePlain(routeId) {
    const route = bleRoutes.find((r) => String(r.id) === String(routeId));
    return route?.title || `Маршрут ${routeId}`;
  }

  function sanitizeRouteFileName(title) {
    return String(title || "маршрут")
      .replace(/\s+\d+\/\d+\s*$/, "")
      .replace(/[^\p{L}\p{N}\-_]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "маршрут";
  }

  function escSvgText(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function buildRouteSchematic(markers) {
    const pts = markers.filter((m) => m.lat && m.lng);
    if (!pts.length) return null;

    let north = Math.max(...pts.map((p) => p.lat));
    let south = Math.min(...pts.map((p) => p.lat));
    let east = Math.max(...pts.map((p) => p.lng));
    let west = Math.min(...pts.map((p) => p.lng));
    const dLat = Math.max(north - south, 0.0005);
    const dLng = Math.max(east - west, 0.0005);
    const pad = 0.14;
    north += dLat * pad;
    south -= dLat * pad;
    east += dLng * pad;
    west -= dLng * pad;

    const W = ROUTE_EXPORT_SVG_W;
    const H = ROUTE_EXPORT_SVG_H;
    const spanLat = north - south || 1;
    const spanLng = east - west || 1;
    const toX = (lng) => ((lng - west) / spanLng) * W;
    const toY = (lat) => ((north - lat) / spanLat) * H;

    const pins = pts.map((p, idx) => ({
      idx,
      ble: p.ble,
      x: toX(p.lng),
      y: toY(p.lat),
    }));

    const grid = [];
    for (let i = 1; i < 4; i++) {
      const gx = (W / 4) * i;
      const gy = (H / 4) * i;
      grid.push(`<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" stroke="#cfd8dc" stroke-width="1"/>`);
      grid.push(`<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="#cfd8dc" stroke-width="1"/>`);
    }

    const pinSvg = pins
      .map(
        (pin) =>
          `<g class="sch-pin" data-idx="${pin.idx}" role="button" tabindex="0" aria-label="Метка ${escSvgText(pin.ble)}">
            <circle cx="${pin.x.toFixed(1)}" cy="${pin.y.toFixed(1)}" r="34" class="sch-pin__halo"/>
            <circle cx="${pin.x.toFixed(1)}" cy="${pin.y.toFixed(1)}" r="28" class="sch-pin__bg"/>
            <text x="${pin.x.toFixed(1)}" y="${pin.y.toFixed(1)}" class="sch-pin__label">${escSvgText(String(pin.ble))}</text>
          </g>`
      )
      .join("");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="sch-map" role="img" aria-label="Схема расположения меток">
      <rect width="100%" height="100%" fill="#e8eef2"/>
      <g opacity="0.55">${grid.join("")}</g>
      ${pinSvg}
    </svg>`;

    return { svg, pins, W, H };
  }

  function buildRouteExportHtml(route, markers, schematic, exportedAt) {
    const title = routeTitlePlain(route.routeId);
    const markerRows = markers
      .map((m, idx) => {
        const type = m.bleType ? m.bleType.replace(/^\d+ - /, "") : "";
        const geo = `geo:${m.lat},${m.lng}?q=${encodeURIComponent(`#${m.ble} ${m.lat},${m.lng}`)}`;
        return `<article class="card" data-idx="${idx}">
          <div class="card__num">${idx + 1}</div>
          <div class="card__body">
            <h2 class="card__title">Метка #${esc(m.ble)}</h2>
            ${type ? `<p class="card__type">${esc(type)}</p>` : ""}
            ${m.locationDesc ? `<p class="card__place">${esc(m.locationDesc)}</p>` : ""}
            <p class="card__coords">${m.lat.toFixed(6)}, ${m.lng.toFixed(6)}</p>
            <a class="card__nav" href="${geo}">Навигация к метке</a>
          </div>
        </article>`;
      })
      .join("");

    const schematicBlock = schematic?.svg
      ? `<div class="sch-wrap">${schematic.svg}<p class="sch-hint">Схема расположения · север условно вверх · нажмите круг с номером</p></div>`
      : `<p class="sch-empty">Схема недоступна — используйте список и «Навигация».</p>`;

    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>${esc(title)} — обход</title>
<style>
:root{color-scheme:light;--ink:#263238;--muted:#546e7a;--line:#dce3e8;--accent:#00897b;--accent-dark:#00695c;--card:#fff;--bg:#eceff1}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
header{padding:14px 14px 10px;background:linear-gradient(160deg,#fff 0%,#e3f2fd 100%);border-bottom:1px solid var(--line)}
header h1{margin:0 0 6px;font-family:Oswald,Arial,sans-serif;font-size:1.25rem;font-weight:700;line-height:1.2}
header .meta{margin:0 0 10px;font-size:.82rem;color:var(--muted);line-height:1.4}
.howto{margin:0;padding:10px 12px;border-radius:10px;background:#fff8e1;border:1px solid #ffe082;font-size:.84rem;line-height:1.45}
.howto strong{display:block;margin-bottom:4px}
.tabs{display:flex;gap:8px;margin-top:12px}
.tab{flex:1;min-height:44px;border:1px solid var(--line);border-radius:999px;background:#fff;font-family:Oswald,Arial,sans-serif;font-size:.92rem;font-weight:600;letter-spacing:.03em;text-transform:uppercase;cursor:pointer}
.tab.is-on{background:var(--accent);border-color:var(--accent-dark);color:#fff}
.panel{display:none;padding:12px 12px calc(16px + env(safe-area-inset-bottom))}
.panel.is-on{display:block}
.card{display:flex;gap:12px;padding:14px 12px;margin-bottom:10px;background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 3px rgba(38,50,56,.06)}
.card.is-active{border-color:var(--accent);box-shadow:0 0 0 2px rgba(0,137,123,.25)}
.card__num{flex:0 0 36px;width:36px;height:36px;border-radius:50%;background:#37474f;color:#fff;font-family:Oswald,Arial,sans-serif;font-weight:700;font-size:1rem;line-height:36px;text-align:center}
.card__body{flex:1;min-width:0}
.card__title{margin:0 0 4px;font-family:Oswald,Arial,sans-serif;font-size:1.05rem}
.card__type,.card__place,.card__coords{margin:0 0 4px;font-size:.84rem;color:var(--muted);line-height:1.35}
.card__nav{display:flex;align-items:center;justify-content:center;margin-top:10px;min-height:48px;padding:0 16px;border-radius:999px;background:var(--accent);color:#fff!important;font-weight:700;font-size:.95rem;text-decoration:none;text-align:center}
.sch-wrap{background:#fff;border:1px solid var(--line);border-radius:14px;padding:8px;overflow:hidden}
.sch-map{display:block;width:100%;height:auto;touch-action:pan-x pan-y pinch-zoom}
.sch-pin{cursor:pointer}
.sch-pin__halo{fill:rgba(0,137,123,0);stroke:none}
.sch-pin__bg{fill:#fff;stroke:#37474f;stroke-width:3}
.sch-pin__label{fill:#263238;font-family:Oswald,Arial,sans-serif;font-size:22px;font-weight:700;text-anchor:middle;dominant-baseline:central;pointer-events:none}
.sch-pin.is-active .sch-pin__bg{fill:#00897b;stroke:#00695c}
.sch-pin.is-active .sch-pin__label{fill:#fff}
.sch-hint,.sch-empty{margin:8px 4px 0;font-size:.78rem;color:var(--muted);line-height:1.35;text-align:center}
</style>
</head>
<body>
<header>
<h1>${esc(title)}</h1>
<p class="meta">${markers.length} меток · ${esc(exportedAt.slice(0, 16).replace("T", " "))} · работает без интернета</p>
<p class="howto"><strong>Как пользоваться</strong>1) Вкладка «Список» или «Схема».<br>2) Выберите метку.<br>3) Нажмите «Навигация» — откроются карты телефона.</p>
<div class="tabs" role="tablist">
<button type="button" class="tab is-on" data-panel="list" role="tab" aria-selected="true">Список</button>
<button type="button" class="tab" data-panel="scheme" role="tab" aria-selected="false">Схема</button>
</div>
</header>
<section class="panel is-on" id="panel-list" role="tabpanel">${markerRows}</section>
<section class="panel" id="panel-scheme" role="tabpanel">${schematicBlock}</section>
<script>
(function(){
var cards=document.querySelectorAll(".card");
var pins=document.querySelectorAll(".sch-pin");
var tabs=document.querySelectorAll(".tab");
var panels={list:document.getElementById("panel-list"),scheme:document.getElementById("panel-scheme")};
function selectIdx(i){
cards.forEach(function(c,j){c.classList.toggle("is-active",j===i);if(j===i)c.scrollIntoView({behavior:"smooth",block:"nearest"});});
pins.forEach(function(p){p.classList.toggle("is-active",Number(p.dataset.idx)===i);});
}
cards.forEach(function(c){c.addEventListener("click",function(e){if(e.target.closest("a"))return;selectIdx(Number(c.dataset.idx));});});
pins.forEach(function(p){p.addEventListener("click",function(){selectIdx(Number(p.dataset.idx));});});
tabs.forEach(function(t){t.addEventListener("click",function(){
var id=t.dataset.panel;
tabs.forEach(function(x){var on=x===t;x.classList.toggle("is-on",on);x.setAttribute("aria-selected",on?"true":"false");});
Object.keys(panels).forEach(function(k){panels[k].classList.toggle("is-on",k===id);});
});});
if(cards.length)selectIdx(0);
})();
</script>
</body>
</html>`;
  }

  function setRouteExportStatus(text, kind = "") {
    const el = document.getElementById("mapRouteExportStatus");
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      el.className = "map-route-export-status";
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.className = `map-route-export-status${kind ? ` map-route-export-status--${kind}` : ""}`;
  }

  async function deliverRouteExportFile(filename, html, routeTitle) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const file = new File([blob], filename, { type: "text/html" });

    if (typeof navigator.canShare === "function") {
      try {
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: routeTitle,
            text: "Маршрут для обхода без интернета",
          });
          return "share";
        }
      } catch (e) {
        if (e?.name === "AbortError") return "cancel";
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.type = "text/html";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return "download";
  }

  let routeExportActive = false;

  async function collectRouteMarkersForExport(route) {
    const prevFilter = bleMapRouteFilter;
    bleMapRouteFilter = String(route.routeId);
    let pts = bleMapData.filter((pt) => pointPassesRouteFilter(pt) && pt.lat && pt.lng);
    bleMapRouteFilter = prevFilter;
    if (pts.length) return pts;

    const snap = bleListSnapshot?.raw;
    if (snap?.length) {
      const raw = filterRawByRoute(snap, route);
      if (raw.length) {
        return raw
          .map((p) => classifyBle(p))
          .filter((pt) => pt.lat && pt.lng);
      }
    }

    const fieldRaw = await loadFieldPackMarkers();
    if (fieldRaw?.length) {
      const meta = await loadFieldPackMeta();
      if (!meta?.routeId || String(meta.routeId) === String(route.routeId)) {
        return filterRawByRoute(fieldRaw, route)
          .map((p) => classifyBle(p))
          .filter((pt) => pt.lat && pt.lng);
      }
    }
    return [];
  }

  async function onRouteExportClick(e) {
    if (routeExportActive || fieldPackDownloadActive) return;
    e?.preventDefault?.();
    e?.stopPropagation?.();

    const route = getActiveRouteForFieldSync();
    if (!route) {
      alert("Выберите маршрут в списке «Маршрут» (не «Все маршруты»), затем «Сохранить файл».");
      return;
    }

    const est = estimateMarkersOnRoute(route.routeId);
    const title = routeTitlePlain(route.routeId);
    const mobile = isCoarseMobile();
    const intro =
      `Сохранить файл маршрута для обхода без интернета?\n\n«${title}» · ~${est || "?"} меток\n\n` +
      "Это НЕ кнопка «Офлайн» (кэш в браузере).\n" +
      "Будет один файл .html — список, схема и кнопки «Навигация».\n\n" +
      (mobile
        ? "На iPhone откроется «Поделиться» → сохраните в «Файлы»."
        : "Файл скачается в «Загрузки».");
    if (!confirm(intro)) return;

    routeExportActive = true;
    const btn = document.getElementById("mapRouteExportBtn");
    const packBtn = document.getElementById("mapFieldPackBtn");
    if (btn) btn.disabled = true;
    if (packBtn) packBtn.disabled = true;
    setRouteExportStatus("Сборка файла маршрута…", "busy");

    try {
      const markers = await collectRouteMarkersForExport(route);
      if (!markers.length) {
        alert("На этом маршруте нет меток с координатами. Нажмите «Обновить» по Wi‑Fi/VPN.");
        return;
      }
      markers.sort((a, b) => String(a.ble).localeCompare(String(b.ble), "ru", { numeric: true }));

      await yieldToMain();
      const schematic = buildRouteSchematic(markers);
      const exportedAt = new Date().toISOString();
      const html = buildRouteExportHtml(route, markers, schematic, exportedAt);
      const fname = `ble-${sanitizeRouteFileName(title)}-${exportedAt.slice(0, 10)}.html`;
      const kb = Math.max(1, Math.round(html.length / 1024));

      setRouteExportStatus("Сохранение файла…", "busy");
      const mode = await deliverRouteExportFile(fname, html, title);

      if (mode === "cancel") return;

      if (mode === "share") {
        alert(
          `Файл «${fname}» (~${kb} КБ) · ${markers.length} меток.\n\n` +
            "Сохраните через «Файлы» / «Сохранить в файлы».\n\n" +
            "В поле откройте файл из «Файлы» → у каждой метки кнопка «Навигация»."
        );
      } else {
        alert(
          `Файл «${fname}» (~${kb} КБ) · ${markers.length} меток.\n\n` +
            "Откройте из «Загрузки» или «Файлы» — интернет не нужен."
        );
      }
    } catch (err) {
      alert(`Не удалось сохранить файл: ${String(err?.message || err).slice(0, 180)}`);
    } finally {
      routeExportActive = false;
      if (btn) btn.disabled = false;
      if (packBtn) packBtn.disabled = false;
      setRouteExportStatus("");
    }
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
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    img.removeAttribute("src");
    void (async () => {
      const src = await resolvePhotoSrcForDisplay(url);
      if (img.isConnected) img.src = src;
    })();
  };

  function closePhotoViewer() {
    document.getElementById("photoViewerOverlay")?.classList.remove("open");
    document.body.style.overflow = "";
  }

  function needsPhotoRefresh(pt) {
    const urls = [pt.photoTag, pt.photoPlace].filter(Boolean);
    if (!urls.length) return true;
    if (isBleNativeApp()) {
      return urls.some((url) => isPhotoUrlExpired(url) && !fieldPhotoBlobUrls.has(url));
    }
    return urls.some(isPhotoUrlExpired);
  }

  async function needsPhotoRefreshAsync(pt) {
    const urls = [pt.photoTag, pt.photoPlace].filter(Boolean);
    if (!urls.length) return true;
    if (!isBleNativeApp()) return urls.some(isPhotoUrlExpired);
    for (const url of urls) {
      if (!isPhotoUrlExpired(url)) continue;
      if (fieldPhotoBlobUrls.has(url)) continue;
      const dbKey = await findFieldPhotoDbKey(url);
      if (!dbKey) return true;
    }
    return false;
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
    const proxy = new URL(BLE_SUPABASE_BASE);
    proxy.searchParams.set("path", "/ble-image");
    proxy.searchParams.set("url", url);
    proxy.searchParams.set("apikey", SUPABASE_PUBLISHABLE_KEY);
    return proxy.toString();
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
    return url;
  }

  async function resolvePhotoSrcForDisplay(url) {
    if (!url) return "";
    const cached = photoSrcForDisplay(url);
    if (fieldPhotoBlobUrls.has(url)) return cached;
    const img = document.createElement("img");
    if (await loadFieldPhotoIntoImg(img, url)) {
      return img.src || photoSrcForDisplay(url) || url;
    }
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

  async function fetchBleListLiveWithTimeout(companyId, timeoutMs) {
    const ms = timeoutMs || (isBleNativeApp() ? 40000 : BLE_LIST_FETCH_TIMEOUT_MS);
    let timer = null;
    try {
      return await Promise.race([
        fetchBleListLive(companyId),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("list_timeout")), ms);
        }),
      ]);
    } catch (e) {
      console.warn("[ble-map] live BLE list", e?.message || e);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function rawHasFreshPhotoUrls(raw, opts = {}) {
    if (isBleNativeApp() && mapDataHasPhotoUrls()) return true;
    return collectPhotoUrlsFromRaw(raw, { tagOnly: !!opts.tagOnly, allowExpired: false }).length > 0;
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
    clearFieldPackReadyMarker();
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

  function parseMapDataZones(mapData) {
    if (!mapData?.zones || !mapData?.points) return [];
    const pointsByZone = {};
    mapData.points.forEach((p) => {
      if (!pointsByZone[p.zoneId]) pointsByZone[p.zoneId] = [];
      pointsByZone[p.zoneId].push([p.latitude, p.longitude]);
    });
    return mapData.zones
      .map((z) => ({
        id: z.id,
        name: z.name || "",
        description: z.description || "",
        color: z.color || "#0088cc",
        pts: (pointsByZone[z.id] || []).map((p) => [...p]),
      }))
      .filter((z) => z.pts.length > 2);
  }

  function applyBleZoneDataFromParsed(zones) {
    bleZoneData = Array.isArray(zones) ? zones : [];
    if (bleMap) drawZones(bleMap);
    if (bleMapFS && isMapFullscreenOpen()) drawZones(bleMapFS);
  }

  async function loadFieldPackZones() {
    try {
      const db = await openFieldDb();
      const tx = db.transaction(BLE_FIELD_META_STORE, "readonly");
      const zones = await idbGet(tx.objectStore(BLE_FIELD_META_STORE), BLE_FIELD_ZONES_KEY);
      db.close();
      return Array.isArray(zones) && zones.length ? zones : null;
    } catch (e) {
      console.warn("[ble-map] field zones load", e?.message || e);
      return null;
    }
  }

  async function commitFieldPackZones(zones) {
    if (!Array.isArray(zones) || !zones.length) return;
    const db = await openFieldDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BLE_FIELD_META_STORE, "readwrite");
      tx.objectStore(BLE_FIELD_META_STORE).put(zones, BLE_FIELD_ZONES_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async function hydrateBleMapZones(companyId, opts = {}) {
    const cid = companyId ?? bleCompanyId;
    if (!cid) return false;
    const tryApi = opts.tryApi !== false && navigator.onLine;
    if (tryApi) {
      try {
        const mapData = await bleApiFetch(`/api/v1/map/${cid}/map_data`);
        const zones = parseMapDataZones(mapData);
        if (zones.length) {
          applyBleZoneDataFromParsed(zones);
          if (isBleNativeApp()) {
            try {
              await commitFieldPackZones(zones);
            } catch (e) {
              console.warn("[ble-map] field zones save", e?.message || e);
            }
          }
          return true;
        }
      } catch (e) {
        if (opts.strict) throw e;
        console.warn("[ble-map] map_data zones", e?.message || e);
      }
    }
    const cached = await loadFieldPackZones();
    if (cached?.length) {
      applyBleZoneDataFromParsed(cached);
      return true;
    }
    return false;
  }

  async function resolveRawForFieldPackDownload(cid, opts = {}) {
    await yieldToMain();
    const forceFresh = !!opts.forceFresh;
    const needsPhotos = !!opts.needsPhotos;
    const snap = bleListSnapshot;

    if (!forceFresh && snap?.raw?.length && Number(snap.companyId) === Number(cid)) {
      const liveRecent = snap.live && Date.now() - snap.at < 30 * 60 * 1000;
      const okForPhotos = !needsPhotos || rawHasFreshPhotoUrls(snap.raw);
      if (liveRecent && okForPhotos) {
        setFieldPackStatus(`Список меток (${snap.raw.length})…`, "busy");
        await yieldToMain();
        return snap.raw;
      }
      if (okForPhotos && rawHasFreshPhotoUrls(snap.raw)) {
        setFieldPackStatus(`Список меток из памяти (${snap.raw.length})…`, "busy");
        await yieldToMain();
        return snap.raw;
      }
    }

    setFieldPackStatus("Авторизация…", "busy");
    await yieldToMain();
    if (!(await ensureBleTokenForField())) return null;

    setFieldPackStatus("Загрузка списка API…", "busy");
    await yieldToMain();
    const live = await fetchBleListLiveWithTimeout(cid);
    if (live?.length) {
      if (!needsPhotos || rawHasFreshPhotoUrls(live)) {
        await yieldToMain();
        return live;
      }
    }

    if (needsPhotos) {
      setFieldPackStatus("Нужны свежие ссылки на фото…", "busy");
      return null;
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

  async function persistLiveMarkersAfterApiRefresh(rawBle, companyId) {
    if (!isBleNativeApp() || !Array.isArray(rawBle) || !rawBle.length) return;
    const slim = slimBleRawForFieldPack(rawBle);
    if (!slim.length) return;
    try {
      await commitFieldPackMarkersQueued(slim);
      const prev = await loadFieldPackMeta();
      await commitFieldPackMetaQueued({
        ...(prev || {}),
        version: BLE_FIELD_PACK_VERSION,
        companyId: companyId ?? prev?.companyId ?? bleCompanyId,
        savedAt: new Date().toISOString(),
        markerCount: slim.length,
        lastLiveRefreshAt: new Date().toISOString(),
        photoCount: prev?.photoCount ?? 0,
        photosOk: prev?.photosOk ?? 0,
        photosFail: prev?.photosFail ?? 0,
        bytesTotal: prev?.bytesTotal ?? 0,
        tagOnly: prev?.tagOnly ?? false,
        packSource: prev?.packSource ?? "liveRefresh",
        routeId: prev?.routeId ?? null,
        routeTitle: prev?.routeTitle ?? null,
      });
    } catch (e) {
      console.warn("[ble-map] persist live markers", e?.message || e);
    }
  }

  function mapDataHasPhotoUrls() {
    return bleMapData.some((p) => p.photoTag || p.photoPlace);
  }

  function collectPhotoUrlsForFieldSync(raw, route, opts = {}) {
    const tagOnly = !!opts.tagOnly;
    const urls = new Set();
    const prevFilter = bleMapRouteFilter;
    if (route?.routeId) bleMapRouteFilter = String(route.routeId);
    for (const pt of bleMapData) {
      if (!pointPassesRouteFilter(pt)) continue;
      if (pt.photoTag) urls.add(pt.photoTag);
      if (!tagOnly && pt.photoPlace) urls.add(pt.photoPlace);
    }
    bleMapRouteFilter = prevFilter;
    const allowExpired = isBleNativeApp() || !!opts.allowExpired;
    for (const u of collectPhotoUrlsFromRaw(raw, { tagOnly, allowExpired })) {
      urls.add(u);
    }
    return [...urls];
  }

  async function persistFieldPhotoBlob(url, blob) {
    if (!url || !blob?.size) return false;
    if (await findFieldPhotoDbKey(url)) return true;
    try {
      const key = fieldPhotoStorageKey(url);
      await appendFieldPackPhotosBatchQueued([[key, blob]]);
      rememberFieldPhotoBlobUrl(url, key, URL.createObjectURL(blob));
      return true;
    } catch (e) {
      console.warn("[ble-map] persist field photo", e?.message || e);
      return false;
    }
  }

  function scheduleFieldPhotoPersistFromNetwork(url) {
    if (!url) return;
    void (async () => {
      if (await findFieldPhotoDbKey(url)) return;
      try {
        const blob = await fetchPhotoBlobForField(url);
        if (blob?.size) await persistFieldPhotoBlob(url, blob);
      } catch {
        /* ignore */
      }
    })();
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
    if (isBleNativeApp()) return blob;
    if (!blob?.type?.startsWith("image/") || blob.size < 100 * 1024) return blob;
    const maxSide = isBleNativeApp() ? 1280 : isCoarseMobile() ? 960 : 1280;
    const compress = async () => {
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
    };
    try {
      return await withAsyncTimeout(compress(), isBleNativeApp() ? 12000 : 20000, "compress_timeout");
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
    const cached = fieldPhotoBlobUrls.get(url);
    if (cached) {
      img.src = cached;
      return true;
    }
    const dbKey = await findFieldPhotoDbKey(url);
    if (!dbKey) return false;
    const cachedByKey = fieldPhotoBlobUrls.get(dbKey);
    if (cachedByKey) {
      img.src = cachedByKey;
      rememberFieldPhotoBlobUrl(url, dbKey, cachedByKey);
      return true;
    }
    const blob = await readFieldPhotoBlobFromDb(dbKey);
    if (!blob) return false;
    const blobUrl = URL.createObjectURL(blob);
    rememberFieldPhotoBlobUrl(url, dbKey, blobUrl);
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

  async function fetchPhotoBlobOnce(url, useProxy) {
    const fetchUrl = useProxy && isYandexPhotoUrl(url) ? toBlePhotoProxyUrl(url) : url;
    const viaEdge = fetchUrl.includes("ble-map-proxy") || fetchUrl.includes("functions/v1");
    const headers = viaEdge ? mergeSupabaseHeaders({}, getBleToken()) : {};
    const ctrl = new AbortController();
    const native = isBleNativeApp();
    const timeoutMs = viaEdge
      ? native
        ? 15000
        : isCoarseMobile()
          ? 90000
          : 70000
      : native
        ? 10000
        : isCoarseMobile()
          ? 45000
          : 35000;
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    if (fieldPackAbort?.signal?.aborted) {
      ctrl.abort();
    } else if (fieldPackAbort?.signal) {
      fieldPackAbort.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }
    try {
      const res = await fetch(fetchUrl, {
        headers,
        signal: ctrl.signal,
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`photo_http_${res.status}`);
      return res.blob();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchPhotoBlobForField(url) {
    if (isBleNativeApp()) {
      try {
        return await fetchPhotoBlobNativeDirect(url);
      } catch (e1) {
        const msg = String(e1?.message || e1 || "");
        if (msg === "aborted") throw e1;
        if (isYandexPhotoUrl(url)) {
          try {
            return await fetchPhotoBlobOnce(url, true);
          } catch (e2) {
            if (String(e2?.message || e2 || "") === "aborted") throw e2;
          }
        }
        throw e1;
      }
    }
    if (!isYandexPhotoUrl(url)) return fetchPhotoBlobOnce(url, false);
    try {
      return await fetchPhotoBlobOnce(url, false);
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (msg === "aborted") throw e;
      return fetchPhotoBlobOnce(url, true);
    }
  }

  async function fetchPhotoBlobForFieldWithRetry(url) {
    const native = isBleNativeApp();
    const maxAttempts = native ? 1 : isCoarseMobile() ? 2 : 3;
    let lastErr = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (fieldPackAbort?.signal.aborted) throw new Error("aborted");
      if (!native && fieldSyncPhotosSinceAuth >= 12) {
        await ensureBleTokenForField();
        fieldSyncPhotosSinceAuth = 0;
      }
      try {
        const blob = await fetchPhotoBlobForField(url);
        if (!native) fieldSyncPhotosSinceAuth++;
        return blob;
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || e || "");
        if (msg === "aborted") throw e;
        if (!native && /photo_http_401|photo_http_403|auth/i.test(msg)) {
          await ensureBleTokenForField();
          fieldSyncPhotosSinceAuth = 0;
        }
        if (native && /photo_http_401|photo_http_403|auth|timeout|compress_timeout|photo_deadline/i.test(msg)) {
          await ensureBleTokenForField();
        }
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, native ? 350 : 700 * (attempt + 1)));
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
      syncMainMapMsgPosition();
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.className = `map-field-pack-status${kind ? ` map-field-pack-status--${kind}` : ""}`;
    syncMainMapMsgPosition();
  }

  async function refreshFieldPackChrome() {
    const meta = await loadFieldPackMeta();
    const btn = document.getElementById("mapFieldPackBtn");
    const syncHint = "Shift+клик — zip и принудительное обновление фото";
    if (!meta?.markerCount && !meta?.raw?.length) {
      const syncState = loadFieldSyncState();
      if (syncState?.photosOk) {
        setFieldPackStatus("Загрузка прервана — нажмите «Скачать фото»", "busy");
      } else {
        setFieldPackStatus("");
      }
      if (btn) {
        btn.title = `Скачать фото маршрута или всех маршрутов (Wi‑Fi/VPN). ${syncHint}`;
      }
      return;
    }
    const markerN = meta.markerCount || meta.raw?.length || 0;
    const photoTotal = meta.photoCount || 0;
    const inDb = await countFieldPhotosInDb();
    const photoOk = Math.max(meta.photosOk || 0, inDb);
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
    if (fieldPackDownloadActive || routeExportActive) return;
    const btn = document.getElementById("mapFieldPackBtn");
    const tagOnly = !!opts.tagOnly;
    const markersOnly = !!opts.markersOnly;
    const photosOnly = !!opts.photosOnly;
    const fullReset = !!opts.fullReset;
    const route =
      opts.routeId != null
        ? {
            routeId: String(opts.routeId),
            routeTitle: opts.routeTitle || (opts.routeId ? `Маршрут ${opts.routeId}` : "Все маршруты"),
          }
        : getFieldSyncRouteRef();
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
      const rawAll = await resolveRawForFieldPackDownload(cid, {
        forceFresh: false,
        needsPhotos: !markersOnly,
      });
      if (!rawAll?.length) {
        alert(
          isBleNativeApp() && !markersOnly
            ? "Не удалось получить свежий список меток с фото.\n\n1. Включите VPN\n2. Нажмите «Обновить» (↺) и дождитесь загрузки меток\n3. Повторите «Скачать фото»"
            : "Не удалось получить список меток. Откройте карту по Wi‑Fi/VPN, дождитесь загрузки меток и повторите."
        );
        return;
      }
      const raw = filterRawByRoute(rawAll, route);
      if (!raw.length) {
        alert(
          `В маршруте «${route.routeTitle}» не найдены метки в ответе API.\n\nНажмите «Обновить» в панели (VPN), выберите маршрут и повторите синхронизацию.`
        );
        return;
      }
      const slimRaw = slimBleRawForFieldPack(raw);
      const photoUrls = markersOnly
        ? []
        : collectPhotoUrlsForFieldSync(raw, route, { tagOnly });
      if (!markersOnly && !photoUrls.length) {
        alert(
          isBleNativeApp()
            ? "Не нашли ссылки на фото.\n\n1. VPN → «Обновить» (↺), дождитесь меток\n2. Откройте пару меток — фото должны открыться\n3. Повторите «Скачать фото»"
            : "На выбранном маршруте нет фото в ответе API."
        );
        return;
      }
      const allRoutesSync = isAllRoutesFieldSync(route);

      if (fullReset) {
        if (photosOnly && !allRoutesSync) {
          revokeFieldPhotoBlobUrls();
          await pruneFieldPhotosMatchingUrls(photoUrls);
          clearFieldSyncState();
        } else {
          revokeFieldPhotoBlobUrls();
          await resetFieldPackStorage();
          clearFieldSyncState();
        }
      }

      const prevMeta = await loadFieldPackMeta();
      const routeChanged =
        String(prevMeta?.routeId || "") !== String(route.routeId || "");
      if (routeChanged && !fullReset && !photosOnly) {
        await pruneFieldPhotosNotInUrls(photoUrls);
      }

      const existingKeys = opts.resume !== false ? await getFieldPhotoKeysSet() : new Set();
      const toFetch = photoUrls.filter((u) => !fieldPhotoIsStored(u, existingKeys));
      let photosOk = countStoredPhotosForUrls(photoUrls, existingKeys);
      let photosFail = 0;
      let bytesTotal = 0;

      const packedMarkers = photosOnly ? await loadFieldPackMarkers() : null;
      const markerCountForMeta = photosOnly
        ? packedMarkers?.length ||
          bleListSnapshot?.raw?.length ||
          (allRoutesSync ? slimRaw.length : slimRaw.length)
        : slimRaw.length;

      const partialMeta = {
        version: BLE_FIELD_PACK_VERSION,
        companyId: cid,
        savedAt: new Date().toISOString(),
        markerCount: markerCountForMeta,
        photoCount: photoUrls.length,
        photosOk,
        photosFail: 0,
        bytesTotal: 0,
        tagOnly,
        packSource: "sync",
        routeId: route.routeId || null,
        routeTitle: route.routeTitle,
      };
      setFieldPackStatus(
        photosOnly
          ? allRoutesSync
            ? "Фото всех маршрутов…"
            : `Фото маршрута «${route.routeTitle}»…`
          : `Метки: ${slimRaw.length} (${route.routeTitle})…`,
        "busy"
      );
      await yieldToMain();
      if (!photosOnly) {
        await commitFieldPackMarkersQueued(slimRaw);
      } else if (allRoutesSync && (!packedMarkers?.length || photosOnly)) {
        await commitFieldPackMarkersQueued(slimRaw);
      }
      await commitFieldPackMetaQueued(partialMeta);
      if (!photosOnly) {
        if (!bleMap) initBleMap([53.038, 39.011], 15);
        bleCompanyId = cid;
        await applyBleListToMap(slimRaw, "");
      } else {
        bleCompanyId = cid;
      }
      setFieldPackReadyMarker(route, cid);
      try {
        sessionStorage.setItem(BLE_OFFLINE_FIRST_KEY, "1");
      } catch {
        /* ignore */
      }

      if (!photoUrls.length && !markersOnly && !photosOnly) {
        setFieldPackReadyMarker(route, cid);
        await refreshFieldPackChrome();
        const st = summarizeRoutePhotoStats(raw);
        alert(
          `Маршрут «${route.routeTitle}»: ${slimRaw.length} меток сохранено.\n\nНа сервере нет фото (${st.markersNoPhoto} меток, статус no_photo).\n\n«Обновить» (↺) + «Скачать фото» — когда фото появятся в VSM.`
        );
        return;
      }

      if (photosOnly && !photoUrls.length) {
        setFieldPackReadyMarker(route, cid);
        await refreshFieldPackChrome();
        alert(`На маршруте «${route.routeTitle}» нет фото в ответе API.`);
        return;
      }

      if (markersOnly || (photosOnly && !toFetch.length) || (!photosOnly && !toFetch.length)) {
        partialMeta.photosOk = photosOnly
          ? Math.max(photosOk, await countFieldPhotosInDb())
          : photosOk;
        partialMeta.photosFail = photosFail;
        await commitFieldPackMetaQueued(partialMeta);
        if (!markersOnly) {
          await commitFieldPhotoRevisions(buildPhotoRevisionsFromRaw(rawAll));
        }
        setFieldPackReadyMarker(route, cid);
        clearFieldSyncState();
        await refreshFieldPackChrome();
        const donePhotos = partialMeta.photosOk;
        alert(
          markersOnly
            ? `Координаты сохранены: ${slimRaw.length} меток.\nМаршрут: ${route.routeTitle}\n\nФото не скачивались.`
            : photosOnly
              ? allRoutesSync
                ? `Фото всех маршрутов уже в памяти (${donePhotos}).\n\nПринудительное обновление: Shift+клик → пункт 3.`
                : `Фото «${route.routeTitle}» уже в памяти (${photosOk} из ${photoUrls.length}, всего ${donePhotos}).\n\nПринудительное обновление: Shift+клик → пункт 3.`
              : photosOk > 0 && !toFetch.length
                ? `Маршрут «${route.routeTitle}» готов.\n\n${photosOk} фото уже в ${fieldMemoryLabel()} — повторно не скачивались.\n\nПринудительное обновление: Shift+клик → пункт 3.`
                : formatRouteSyncDoneMessage(route, slimRaw, raw, photosOk, photoUrls.length, photosFail)
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
      let lastStatusAt = 0;

      setFieldPackStatus(
        `Фото: 0 / ${total} (всего ${photosOk}/${photoUrls.length}) · 0 МБ`,
        "busy"
      );
      await yieldToMain();

      const queue = [...toFetch];
      const updateSyncProgress = async (force) => {
        const now = Date.now();
        const interval = photosOnly ? 0 : isBleNativeApp() ? 0 : 500;
        if (!force && interval && now - lastStatusAt < interval && done < total) return;
        lastStatusAt = now;
        setFieldPackStatus(
          `Фото: ${done} / ${total} (всего ${photosOk}/${photoUrls.length}) · ${formatFieldPackMb(bytesTotal)}`,
          "busy"
        );
        partialMeta.photosOk = photosOk;
        partialMeta.photosFail = photosFail;
        partialMeta.bytesTotal = bytesTotal;
        try {
          if (photosOnly || force || done === total || done % 5 === 0) {
            await commitFieldPackMetaQueued(partialMeta);
          }
        } catch (e) {
          console.warn("[ble-map] field sync meta", e?.message || e);
        }
        if (!isBleNativeApp()) await yieldToMain();
      };

      const runPhotoWorker = async () => {
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
              if (!photosOnly) blob = await compressPhotoBlobForField(blob);
              await appendFieldPackPhotosBatchQueued([[fieldPhotoStorageKey(url), blob]]);
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
          await updateSyncProgress(true);
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
        partialMeta.photosOk = photosOnly
          ? Math.max(photosOk, await countFieldPhotosInDb())
          : photosOk;
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
          `Загрузка остановлена.\n\nМаршрут: ${route.routeTitle}\nФото: ${photosOk} из ${photoUrls.length}\n\nНажмите «Скачать фото» — докачаются недостающие.`
        );
        await refreshFieldPackChrome();
        return;
      }

      const meta = {
        version: BLE_FIELD_PACK_VERSION,
        companyId: cid,
        savedAt: new Date().toISOString(),
        markerCount: markerCountForMeta,
        photoCount: photoUrls.length,
        photosOk: photosOnly ? Math.max(photosOk, await countFieldPhotosInDb()) : photosOk,
        photosFail,
        bytesTotal,
        tagOnly,
        packSource: "sync",
        routeId: route.routeId || null,
        routeTitle: route.routeTitle,
      };
      await commitFieldPackMetaQueued(meta);
      if (!markersOnly) {
        await commitFieldPhotoRevisions(buildPhotoRevisionsFromRaw(rawAll));
      }
      setFieldPackReadyMarker(route, cid);
      clearFieldSyncState();
      if (!photosOnly) {
        setBleMapData(mergeBleMapDataFromRaw(raw));
        updateMapStats();
        renderBleMarkers();
      } else if (photosOnly) {
        await ensureBleMapDataForRoutes();
        updateMapStats();
        renderBleMarkers();
        await hydrateBleMapZones(cid, { tryApi: navigator.onLine });
      }
      await refreshFieldPackChrome();

      if (photosOk < 1 && !markersOnly) {
        if (photosOnly) {
          alert(
            `Фото не скачались: ${photosFail} ошибок из ${photoUrls.length}.\n\n` +
              "1. VPN → «Обновить» (↺) — свежие ссылки на фото\n" +
              "2. Повторите «Скачать фото»\n\n" +
              "Сначала пробуем Yandex напрямую, при ошибке — через Supabase."
          );
        } else {
          alert(
            `Координаты сохранены (${slimRaw.length} меток), но фото не скачались (${photosFail} ошибок). Проверьте VPN и повторите синхронизацию.`
          );
        }
        return;
      }

      alert(formatRouteSyncDoneMessage(route, slimRaw, raw, photosOk, photoUrls.length, photosFail));
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
    const packedMarkers = await loadFieldPackMarkers();
    if (!packedMarkers?.length && !meta?.markerCount && !meta?.raw?.length) return false;
    if (companyId && meta.companyId && Number(meta.companyId) !== Number(companyId)) {
      return false;
    }
    setFieldPackStatus("Загрузка данных для поля…", "busy");
    await yieldToMain();
    const cid = meta.companyId || companyId;
    if (!bleMap) initBleMap([59.6603, 28.3967], 16);
    bleCompanyId = cid;

    const cached = await fetchBleListOffline(cid);
    if (packedMarkers?.length) {
      await applyBleListToMap(packedMarkers, "", { skipZones: true });
    } else if (cached?.data?.length) {
      await applyBleListToMap(cached.data, "", { skipZones: true });
    } else {
      return false;
    }

    await hydrateBleMapZones(cid, { tryApi: navigator.onLine });
    if (!bleZoneData.length && navigator.onLine) {
      await hydrateBleMapZones(cid, { tryApi: true });
    }
    if (bleMap && bleZoneData.length) drawZones(bleMap);

    if (meta.routeId) {
      const rid = String(meta.routeId);
      bleMapRouteFilter = rid;
      bleRouteFilterApplying = true;
      document.querySelectorAll("select[data-ble-route-select]").forEach((sel) => {
        if ([...sel.options].some((o) => o.value === rid)) sel.value = rid;
      });
      bleRouteFilterApplying = false;
      lastRenderKey = "";
      lastRenderKeyFS = "";
      renderBleMarkers();
      if (isMapFullscreenOpen()) renderFsMarkers();
    }
    try {
      sessionStorage.setItem(BLE_OFFLINE_FIRST_KEY, "1");
    } catch {
      /* ignore */
    }
    setRetryVisible(true);
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
      const hint = photoUnavailableHint(pt) || "Фото недоступно.";
      container.innerHTML = `<p class="ble-popup-loading">${esc(hint)}</p>`;
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "ble-popup-photos";
    urls.forEach((url, idx) => {
      const a = document.createElement("a");
      a.className = "ble-popup-photo-link";
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.dataset.blePhoto = url;
      const img = document.createElement("img");
      img.className = "ble-popup-photo";
      img.alt = "";
      // первое фото — высокий приоритет и eager-загрузка, второе — обычное
      img.loading = idx === 0 ? "eager" : "lazy";
      img.decoding = "async";
      try { img.fetchPriority = idx === 0 ? "high" : "auto"; } catch { /* ignore */ }
      img.referrerPolicy = "no-referrer";
      const direct = url;
      const proxied = toBlePhotoProxyUrl(url);
      const cached = fieldPhotoBlobUrls.get(url);
      if (cached) {
        img.src = cached;
      } else if (isBleNativeApp()) {
        void (async () => {
          const fromPack = await loadFieldPhotoIntoImg(img, url);
          if (!fromPack && img.isConnected) {
            img.addEventListener(
              "load",
              () => scheduleFieldPhotoPersistFromNetwork(url),
              { once: true }
            );
            img.src = direct;
            img.addEventListener(
              "error",
              function onNativePopupImgErr() {
                if (this.dataset.blePhotoTried === "proxy") {
                  this.removeAttribute("src");
                  this.classList.add("ble-popup-photo--missing");
                  this.alt = "Нет в памяти";
                  return;
                }
                if (proxied) {
                  this.dataset.blePhotoTried = "proxy";
                  this.addEventListener(
                    "load",
                    () => scheduleFieldPhotoPersistFromNetwork(url),
                    { once: true }
                  );
                  this.src = proxied;
                }
              },
              { once: false }
            );
          }
        })();
      } else {
        void (async () => {
          const fromPack = await loadFieldPhotoIntoImg(img, url);
          if (!fromPack && img.isConnected) {
            img.addEventListener(
              "load",
              () => scheduleFieldPhotoPersistFromNetwork(url),
              { once: true }
            );
            img.src = direct;
          }
        })();
      }
      if (!isBleNativeApp()) img.addEventListener("error", function onImgErr() {
        if (this.dataset.blePhotoTried === "both") return;
        if (this.dataset.blePhotoTried === "direct") {
          if (proxied && this.src !== proxied) {
            this.dataset.blePhotoTried = "proxy";
            this.src = proxied;
            return;
          }
          this.dataset.blePhotoTried = "both";
          return;
        }
        if (direct && this.src !== direct) {
          this.dataset.blePhotoTried = "direct";
          this.src = direct;
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
      if (!slot) return;
      let rendered = false;
      const hasPhotos = !!(current.photoTag || current.photoPlace);
      try {
        const mustRefresh = hasPhotos ? await needsPhotoRefreshAsync(current) : true;
        if (hasPhotos && !mustRefresh) {
          renderPhotosInto(slot, current);
          rendered = true;
          return;
        }
        if (hasPhotos) {
          renderPhotosInto(slot, current);
          rendered = true;
        } else {
          slot.innerHTML = '<p class="ble-popup-loading">Загрузка фото…</p>';
        }
        current = await enrichPointPhotos(current, { forceFresh: navigator.onLine });
      } catch (e) {
        console.warn("[ble-map] popup photos", e?.message || e);
        current = getPointForPopup(pt);
      } finally {
        if (!rendered) renderPhotosInto(slot, getPointForPopup(pt));
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

  function getBleMarkerSpillLayer(map, fs = false) {
    if (!map) return null;
    if (fs) {
      if (!bleMarkerSpillLayerFS) {
        bleMarkerSpillLayerFS = L.layerGroup();
        map.addLayer(bleMarkerSpillLayerFS);
      }
      return bleMarkerSpillLayerFS;
    }
    if (!bleMarkerSpillLayer) {
      bleMarkerSpillLayer = L.layerGroup();
      map.addLayer(bleMarkerSpillLayer);
    }
    return bleMarkerSpillLayer;
  }

  function clearBleMarkerSpillLayer(map, fs = false) {
    const spill = fs ? bleMarkerSpillLayerFS : bleMarkerSpillLayer;
    if (!spill) return;
    spill.clearLayers();
    if (map) map.removeLayer(spill);
    if (fs) bleMarkerSpillLayerFS = null;
    else bleMarkerSpillLayer = null;
  }

  function collectSmallVisibleClusters(group) {
    const tiny = [];
    const fg = group?._featureGroup;
    if (!fg?.eachLayer) return tiny;
    fg.eachLayer((layer) => {
      if (typeof layer?.getChildCount !== "function") return;
      const count = layer.getChildCount();
      if (count >= 2 && count < BLE_CLUSTER_MIN_COUNT) tiny.push(layer);
    });
    return tiny;
  }

  function explodeSmallCluster(group, cluster, spillLayer) {
    if (!group || !cluster || !spillLayer) return;
    const children = cluster.getAllChildMarkers?.() || [];
    if (!children.length) return;
    try {
      group.removeLayer(cluster);
    } catch {
      /* ignore */
    }
    children.forEach((m) => {
      if (!spillLayer.hasLayer(m)) spillLayer.addLayer(m);
    });
  }

  function mergeSpillIntoClusterGroup(group, spill) {
    if (!group || !spill) return;
    const fromSpill = [];
    spill.eachLayer((m) => fromSpill.push(m));
    if (!fromSpill.length) return;
    spill.clearLayers();
    group.addLayers(fromSpill);
    if (typeof group.refreshClusters === "function") group.refreshClusters();
  }

  function enforceClusterMinSize(group, spill, map, fs = false) {
    if (!group || !map || !bleClusterEnabled) return;
    const spillLayer = spill || getBleMarkerSpillLayer(map, fs);
    if (!spillLayer) return;

    const tiny = collectSmallVisibleClusters(group);
    if (!tiny.length) return;

    tiny.forEach((cluster) => explodeSmallCluster(group, cluster, spillLayer));
  }

  function enforceClusterMinSizeDeep(group, spill, map, fs = false) {
    if (!group || !map || !bleClusterEnabled) return;
    let guard = 0;
    const tick = () => {
      enforceClusterMinSize(group, spill, map, fs);
      guard += 1;
      if (guard < 6 && collectSmallVisibleClusters(group).length) {
        requestAnimationFrame(tick);
      }
    };
    tick();
  }

  function scheduleEnforceClusterMinSize(group, spill, map, fs = false) {
    if (!group || !map) return;
    const timer = fs ? bleClusterEnforceTimerFS : bleClusterEnforceTimer;
    if (timer) clearTimeout(timer);
    const delays = [0, 100, 280, 600];
    let step = 0;
    const run = () => {
      enforceClusterMinSizeDeep(group, spill, map, fs);
      step += 1;
      if (step < delays.length) {
        const wait = delays[step] - delays[step - 1];
        const id = setTimeout(run, wait);
        if (fs) bleClusterEnforceTimerFS = id;
        else bleClusterEnforceTimer = id;
      } else if (fs) bleClusterEnforceTimerFS = null;
      else bleClusterEnforceTimer = null;
    };
    run();
  }

  function onClusterMapViewChange(map, fs = false) {
    if (!bleClusterEnabled) return;
    const group = fs ? bleClusterGroupFS : bleClusterGroup;
    if (!group) return;
    const spill = getBleMarkerSpillLayer(map, fs);
    mergeSpillIntoClusterGroup(group, spill);
    scheduleEnforceClusterMinSize(group, spill, map, fs);
  }

  function makeClusterGroup(map, fs = false) {
    const group = L.markerClusterGroup({
      maxClusterRadius(zoom) {
        if (zoom < 17) return 120;
        if (zoom < 19) return 40;
        return 1;
      },
      disableClusteringAtZoom: 20,
      spiderfyOnMaxZoom: false,
      showCoverageOnHover: false,
      animate: true,
      animateAddingMarkers: true,
      chunkedLoading: true,
      chunkInterval: 80,
      chunkDelay: 16,
      removeOutsideVisibleBounds: true,
      chunkProgress(processed, total) {
        if (processed >= total && bleClusterEnabled) {
          scheduleEnforceClusterMinSize(
            group,
            fs ? bleMarkerSpillLayerFS : bleMarkerSpillLayer,
            map,
            fs
          );
        }
      },
      iconCreateFunction(cluster) {
        const count = cluster.getChildCount();
        if (count >= 2 && count < BLE_CLUSTER_MIN_COUNT) {
          queueMicrotask(() => {
            const spillLayer = fs ? bleMarkerSpillLayerFS : bleMarkerSpillLayer;
            if (!spillLayer) getBleMarkerSpillLayer(map, fs);
            explodeSmallCluster(
              group,
              cluster,
              spillLayer || getBleMarkerSpillLayer(map, fs)
            );
          });
          return L.divIcon({
            html: "",
            className: "marker-cluster marker-cluster--rejected",
            iconSize: L.point(1, 1),
          });
        }
        const size = count < 10 ? "small" : count < 50 ? "medium" : "large";
        return L.divIcon({
          html: `<div><span>${count}</span></div>`,
          className: `marker-cluster marker-cluster-${size}`,
          iconSize: L.point(40, 40),
        });
      },
    });
    group.on("animationend", () => {
      if (!bleClusterEnabled) return;
      scheduleEnforceClusterMinSize(
        group,
        fs ? bleMarkerSpillLayerFS : bleMarkerSpillLayer,
        map,
        fs
      );
    });
    return group;
  }

  function bindClusterNormalization(map, fs = false) {
    if (!map) return;
    if (fs ? bleClusterNormalizeBoundFS : bleClusterNormalizeBound) return;
    map.on("zoomend", () => onClusterMapViewChange(map, fs));
    map.on("moveend", () => {
      if (!bleClusterEnabled) return;
      const group = fs ? bleClusterGroupFS : bleClusterGroup;
      if (!group) return;
      scheduleEnforceClusterMinSize(
        group,
        fs ? bleMarkerSpillLayerFS : bleMarkerSpillLayer,
        map,
        fs
      );
    });
    if (fs) bleClusterNormalizeBoundFS = true;
    else bleClusterNormalizeBound = true;
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
    if (!isBleNativeApp()) upsertOfflineMarkerEdit(rec);
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
    clearBleMarkerSpillLayer(bleMapFS, true);
    if (bleMarkerLayerFS) {
      bleMarkerLayerFS.clearLayers();
      bleMapFS.removeLayer(bleMarkerLayerFS);
      bleMarkerLayerFS = null;
    }
  }

  async function ensureBleMapDataForRoutes() {
    const cid = bleCompanyId || (await resolveCompanyId());
    if (bleListSnapshot?.raw?.length && Number(bleListSnapshot.companyId) === Number(cid)) {
      setBleMapData(mergeBleMapDataFromRaw(bleListSnapshot.raw));
      applyOfflineMarkerQueueToMapData();
      return true;
    }
    const cached = await fetchBleListOffline(cid);
    if (cached?.data?.length) {
      setBleMapData(mergeBleMapDataFromRaw(cached.data));
      applyOfflineMarkerQueueToMapData();
      bleListSnapshot = {
        at: Date.now(),
        raw: cached.data,
        companyId: cid,
        live: false,
      };
      return true;
    }
    if (navigator.onLine && cid) {
      return (await refreshBleMapFromApi(cid)) !== false;
    }
    return false;
  }

  function routeFilterNeedsFullData(nextRouteId) {
    if (!bleMapData.length) return true;
    if (nextRouteId) {
      return !bleMapData.some(
        (pt) => pt.routeId != null && String(pt.routeId) === String(nextRouteId)
      );
    }
    const snapLen = bleListSnapshot?.raw?.length || 0;
    return snapLen > bleMapData.length + 5;
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

    if (routeFilterNeedsFullData(next)) {
      void (async () => {
        const ok = await ensureBleMapDataForRoutes();
        updateMapStats();
        redrawMapLayers({ zones: false });
        if (bleMap && bleZoneData.length) drawZones(bleMap);
        if (
          !ok &&
          next &&
          !bleMapData.some(
            (pt) => pt.routeId != null && String(pt.routeId) === String(next)
          )
        ) {
          showMapMsg(
            isBleNativeApp()
              ? "Нет меток этого маршрута в памяти. Нажмите «Обновить» (↺) при наличии сети."
              : "Нет меток этого маршрута. Обновите карту по Wi‑Fi/VPN.",
            "error"
          );
        }
      })();
      return;
    }
    redrawMapLayers({ zones: false });
    if (bleMap && bleZoneData.length) drawZones(bleMap);
    if (bleMapFS && isMapFullscreenOpen() && bleZoneData.length) drawZones(bleMapFS);
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

    const key = `view:${bleMapFilter}:${bleMapRouteFilter}:${q}:${bleMapData.length}:${bleClusterEnabled ? "cluster" : "plain"}`;
    if (key === lastRenderKey && (bleClusterEnabled ? !!bleClusterGroup : !!bleMarkerLayer)) return;
    lastRenderKey = key;

    const visible = collectVisibleMarkers(bleMapFilter, q);

    if (!bleClusterEnabled) {
      if (bleClusterGroup) {
        bleClusterGroup.clearLayers();
        bleMap.removeLayer(bleClusterGroup);
        bleClusterGroup = null;
      }
      clearBleMarkerSpillLayer(bleMap, false);
      if (!bleMarkerLayer) {
        bleMarkerLayer = L.layerGroup();
        bleMap.addLayer(bleMarkerLayer);
      } else {
        bleMarkerLayer.clearLayers();
      }
      visible.forEach((m) => bleMarkerLayer.addLayer(m));
      return;
    }

    if (bleMarkerLayer) {
      bleMap.removeLayer(bleMarkerLayer);
      bleMarkerLayer = null;
    }

    if (!bleClusterGroup) {
      bleClusterGroup = makeClusterGroup(bleMap, false);
      bleMap.addLayer(bleClusterGroup);
      bindClusterNormalization(bleMap, false);
    } else {
      bleClusterGroup.clearLayers();
      if (bleMarkerSpillLayer) bleMarkerSpillLayer.clearLayers();
    }
    bleClusterGroup.addLayers(visible);
    scheduleEnforceClusterMinSize(bleClusterGroup, bleMarkerSpillLayer, bleMap, false);
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

    const key = `view:${bleMapFSFilter}:${bleMapRouteFilter}:${q}:${bleMapData.length}:${bleClusterEnabled ? "cluster" : "plain"}`;
    if (key === lastRenderKeyFS && (bleClusterEnabled ? !!bleClusterGroupFS : !!bleMarkerLayerFS)) return;
    lastRenderKeyFS = key;

    const visible = collectVisibleMarkers(bleMapFSFilter, q);

    if (!bleClusterEnabled) {
      if (bleClusterGroupFS) {
        bleClusterGroupFS.clearLayers();
        bleMapFS.removeLayer(bleClusterGroupFS);
        bleClusterGroupFS = null;
      }
      clearBleMarkerSpillLayer(bleMapFS, true);
      if (!bleMarkerLayerFS) {
        bleMarkerLayerFS = L.layerGroup();
        bleMapFS.addLayer(bleMarkerLayerFS);
      } else {
        bleMarkerLayerFS.clearLayers();
      }
      visible.forEach((m) => bleMarkerLayerFS.addLayer(m));
      return;
    }

    if (bleMarkerLayerFS) {
      bleMapFS.removeLayer(bleMarkerLayerFS);
      bleMarkerLayerFS = null;
    }

    if (!bleClusterGroupFS) {
      bleClusterGroupFS = makeClusterGroup(bleMapFS, true);
      bleMapFS.addLayer(bleClusterGroupFS);
      bindClusterNormalization(bleMapFS, true);
    } else {
      bleClusterGroupFS.clearLayers();
      if (bleMarkerSpillLayerFS) bleMarkerSpillLayerFS.clearLayers();
    }
    bleClusterGroupFS.addLayers(visible);
    scheduleEnforceClusterMinSize(bleClusterGroupFS, bleMarkerSpillLayerFS, bleMapFS, true);
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
    if (bleMap && bleZoneData.length) drawZones(bleMap);
    if (bleMapFS && isMapFullscreenOpen() && bleZoneData.length) drawZones(bleMapFS);
  }

  window.setBleMapFilter = setBleMapFilter;

  function isBleNativeApp() {
    try {
      if (window.Capacitor?.isNativePlatform?.()) return true;
      if (document.documentElement?.dataset?.wwNative === "1") return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  function initWebFieldSyncChrome() {
    if (isBleNativeApp()) return;
    document.getElementById("mapRouteExportBtn")?.setAttribute("hidden", "");
    document.getElementById("mapFieldPackBtn")?.setAttribute("hidden", "");
    const retryBtn = document.getElementById("mapRetryBtn");
    if (retryBtn) {
      retryBtn.title = "Обновить координаты меток и полигоны с сервера (Wi‑Fi/VPN)";
      retryBtn.setAttribute("aria-label", "Обновить координаты и зоны");
    }
  }

  function initNativeAppChrome() {
    if (!isBleNativeApp()) return;
    document.documentElement.classList.add("ble-map-native");
    document.body.classList.add("ble-map-native");
    document.getElementById("bleMapPageHeader")?.classList.add("is-native");
    const back = document.getElementById("bleMapBackLink");
    if (back) back.hidden = true;
    document.getElementById("mapRouteExportBtn")?.setAttribute("hidden", "");
    document
      .querySelectorAll(
        '#mapBaseLayerSelect option[value="street"], #mapBaseLayerSelect option[value="hybrid"], #mapBaseLayerSelectActions option[value="street"], #mapBaseLayerSelectActions option[value="hybrid"], #mapFsBaseLayerSelect option[value="street"], #mapFsBaseLayerSelect option[value="hybrid"]'
      )
      .forEach((opt) => {
        opt.hidden = true;
        opt.disabled = true;
      });
    const packBtn = document.getElementById("mapFieldPackBtn");
    if (packBtn) {
      packBtn.title = "Скачать фото выбранного маршрута или всех маршрутов в память телефона (Wi‑Fi/VPN)";
      packBtn.querySelector(".map-toolbar-text--long") &&
        (packBtn.querySelector(".map-toolbar-text--long").textContent = "Скачать фото");
      packBtn.querySelector(".map-toolbar-text--short") &&
        (packBtn.querySelector(".map-toolbar-text--short").textContent = "Фото");
    }
    const retryBtn = document.getElementById("mapRetryBtn");
    if (retryBtn) {
      retryBtn.title = "Обновить координаты меток и полигоны с сервера (Wi‑Fi/VPN)";
      retryBtn.setAttribute("aria-label", "Обновить координаты и зоны");
    }
    const clusterBtn = document.getElementById("mapClusterToggleBtn");
    if (clusterBtn) clusterBtn.hidden = false;
    const logo = document.getElementById("bleMapBackLogo");
    if (logo) {
      logo.disabled = true;
      logo.style.pointerEvents = "none";
      logo.style.opacity = "0.85";
    }
  }

  function loadClusterTogglePref() {
    try {
      const raw = localStorage.getItem(BLE_CLUSTER_TOGGLE_KEY);
      bleClusterEnabled = raw == null ? true : raw !== "0";
    } catch {
      bleClusterEnabled = true;
    }
  }

  function updateClusterToggleUi() {
    const btn = document.getElementById("mapClusterToggleBtn");
    if (!btn) return;
    btn.hidden = false;
    btn.dataset.state = bleClusterEnabled ? "on" : "off";
    btn.textContent = bleClusterEnabled ? "Кластеры: вкл" : "Кластеры: выкл";
    btn.setAttribute("aria-pressed", bleClusterEnabled ? "true" : "false");
    btn.title = bleClusterEnabled ? "Отключить кластеры меток" : "Включить кластеры меток";
  }

  function setClusterEnabled(next, opts = {}) {
    const on = !!next;
    if (on === bleClusterEnabled && !opts.force) {
      updateClusterToggleUi();
      return;
    }
    bleClusterEnabled = on;
    if (opts.persist !== false) {
      try {
        localStorage.setItem(BLE_CLUSTER_TOGGLE_KEY, bleClusterEnabled ? "1" : "0");
      } catch {
        /* ignore */
      }
    }
    updateClusterToggleUi();
    lastRenderKey = "";
    lastRenderKeyFS = "";
    redrawMapLayers({ zones: false });
  }

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

  function updateMapFloatDockTopInset() {
    const root = document.documentElement;
    const native = isBleNativeApp();
    const mobile = isCoarseMobile() || window.innerWidth <= 768 || native;
    const embedded = window.self !== window.top;
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    root.classList.toggle("ble-map-ios", isIOS);

    /* Читаем env(safe-area-inset-top) через CSS-переменную --safe-area-top:
       это единственный надёжный способ получить значение env() в JS. */
    const safeTop = parseFloat(
      getComputedStyle(root).getPropertyValue("--safe-area-top") || "0"
    );

    if (mobile) {
      if (native) {
        const topPx = Math.max(8, safeTop + 4);
        root.style.setProperty("--map-float-dock-top", `${topPx}px`);
      } else if (embedded && isIOS) {
        /* iPhone Safari в iframe: viewport-fit=cover → iframe начинается под Dynamic Island.
           env(safe-area-inset-top) ≈ 59px + адресная строка ≈ 44px + gap = ~111px.
           CSS env() может не работать внутри iframe → переопределяем через JS. */
        const topPx = Math.max(100, safeTop + 52);
        root.style.setProperty("--map-float-dock-top", `${topPx}px`);
      } else if (embedded && !isIOS) {
        /* Android / десктоп в iframe: контент уже ниже хрома — минимальный отступ. */
        const topPx = Math.max(12, safeTop + 6);
        root.style.setProperty("--map-float-dock-top", `${topPx}px`);
      } else {
        /* Standalone (прямой URL): CSS сам считает env(safe-area-inset-top) корректно.
           НЕ переопределяем через JS, чтобы не затереть env() нулём. */
        root.style.removeProperty("--map-float-dock-top");
      }
    } else {
      root.style.removeProperty("--map-float-dock-top");
    }

    /* scrollMargin = dock top + dock height + gap.
       Читаем актуальное значение переменной (JS-переопределение или CSS env()). */
    const actualTopPx = parseFloat(
      getComputedStyle(root).getPropertyValue("--map-float-dock-top") || "24"
    ) || 24;
    const dock = document.getElementById("mapFloatDock");
    let dockH = mobile ? 52 : 44;
    if (dock && !dock.hidden) {
      const measured = dock.offsetHeight;
      if (measured > 0) dockH = Math.min(measured, mobile && document.body.classList.contains("ble-map--edit") ? 64 : 140);
    }
    const scrollMargin = actualTopPx + dockH + 8;
    root.style.setProperty("--map-float-dock-scroll-margin", `${scrollMargin}px`);
    root.style.setProperty("--map-leaflet-top-margin", `${scrollMargin}px`);
  }

  function applyMapLayoutClasses() {
    const embedded = window.self !== window.top;
    const native = isBleNativeApp();
    document.documentElement.classList.toggle("ble-map-embedded", embedded && !native);
    document.body.classList.toggle("ble-map-embedded", embedded && !native);
    document.body.classList.toggle("ble-map-mobile", isCoarseMobile() || native);
    updateMapFloatDockTopInset();
  }

  function bindMapResizeHandlers() {
    const onLayoutChange = () => {
      scheduleMapResize();
      updateMapFloatDockTopInset();
    };
    window.addEventListener("resize", onLayoutChange, { passive: true });
    window.addEventListener("orientationchange", onLayoutChange, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onLayoutChange, { passive: true });
      window.visualViewport.addEventListener("scroll", onLayoutChange, { passive: true });
    }
  }

  function setRetryVisible(show) {
    const retry = document.getElementById("mapRetryBtn");
    if (!retry) return;
    retry.hidden = !show;
    retry.disabled = !!retry.dataset.busy;
  }

  function revealMapControls() {
    const dock = document.getElementById("mapFloatDock");
    if (dock) dock.hidden = false;
    setRetryVisible(true);
    requestAnimationFrame(updateMapFloatDockTopInset);
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

  async function refreshBleMapFromApi(companyId, opts = {}) {
    if (!companyId || bleEditMode) return false;
    try {
      const rawBle = await bleApiFetch(`/api/v1/map/ble/${companyId}`);
      if (!Array.isArray(rawBle) || !rawBle.length) {
        if (opts.strict) throw new Error("Пустой ответ API (метки)");
        return false;
      }
      bleListSnapshot = { at: Date.now(), raw: rawBle, companyId, live: true };
      setBleMapData(mergeBleMapDataFromRaw(rawBle));
      applyOfflineMarkerQueueToMapData();
      updateMapStats();
      renderBleMarkers();
      if (isMapFullscreenOpen()) renderFsMarkers();
      void persistLiveMarkersAfterApiRefresh(rawBle, companyId);
      let zonesOk = false;
      try {
        zonesOk = await hydrateBleMapZones(companyId, { strict: opts.strict, tryApi: true });
      } catch (e) {
        if (opts.strict) throw new Error("Не удалось загрузить зоны: " + (e?.message || e));
      }
      try {
        sessionStorage.removeItem(BLE_OFFLINE_FIRST_KEY);
      } catch {
        /* ignore */
      }
      setRetryVisible(true);
      hideMapMsg();
      scheduleDefaultMapCenter({ force: true, fromLive: true });
      return zonesOk || true;
    } catch (e) {
      console.warn("[ble-map] API refresh failed", e?.message || e);
      if (opts.strict) throw e;
      return false;
    }
  }

  async function retryBleMapRefresh() {
    const btn = document.getElementById("mapRetryBtn");
    if (btn) {
      btn.disabled = true;
      btn.dataset.busy = "1";
    }
    hideMapMsg();
    try {
      if (!navigator.onLine) {
        alert("Нужен интернет (Wi‑Fi/VPN) для обновления координат и зон.");
        return;
      }
      if (!(await ensureBleTokenForField())) {
        alert("Нет доступа к API. Проверьте VPN и повторите.");
        return;
      }
      showMapMsg("Обновление координат и зон…", "");
      let cid = bleCompanyId || (await resolveCompanyId());
      const apiCid = await resolveCompanyIdFromApi();
      if (apiCid) cid = apiCid;
      bleCompanyId = cid;
      const ok = await refreshBleMapFromApi(cid, { strict: true });
      if (!ok) throw new Error("Не удалось обновить данные");
      if (!bleZoneData.length) {
        await hydrateBleMapZones(cid, { tryApi: true });
      }
      if (bleMap && bleZoneData.length) drawZones(bleMap);
      if (bleMapFS && isMapFullscreenOpen() && bleZoneData.length) drawZones(bleMapFS);
      if (!bleZoneData.length) {
        showMapMsg(
          "Метки обновлены, но полигоны не загрузились. Проверьте VPN и нажмите ↺ ещё раз.",
          "error"
        );
        void syncChangedFieldPhotosAfterRefresh(cid);
        return;
      }
      showMapMsg(`Координаты меток и ${bleZoneData.length} полигонов обновлены.`, "");
      setTimeout(hideMapMsg, 3500);
      void syncChangedFieldPhotosAfterRefresh(cid);
    } catch (e) {
      showMapMsg("Ошибка обновления: " + formatBleError(e), "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        delete btn.dataset.busy;
      }
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
    if (bleCompanyId && !opts.skipZones) {
      try {
        await hydrateBleMapZones(bleCompanyId, { tryApi: navigator.onLine });
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
        const fieldReady = await hasFieldPackInStorage();
        if (!fieldReady) {
          try {
            sessionStorage.removeItem(BLE_OFFLINE_FIRST_KEY);
          } catch {
            /* ignore */
          }
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

      if (isBleNativeApp() && (await hasFieldPackInStorage())) {
        const fromField = await tryLoadFieldPack(companyId);
        if (fromField) {
          if (navigator.onLine) {
            try {
              if (await ensureBleTokenForField()) {
                await refreshBleMapFromApi(companyId);
              }
            } catch {
              await hydrateBleMapZones(companyId, { tryApi: true });
            }
          }
          if (bleMap && bleZoneData.length) drawZones(bleMap);
          if (bleMapFS && isMapFullscreenOpen() && bleZoneData.length) drawZones(bleMapFS);
          return;
        }
      }

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
      if (await tryLoadFieldPack(companyId)) {
        return;
      }
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
        "Ошибка загрузки карты: " + formatBleError(e, tried) + " Нажмите «Обновить» в панели.",
        "error"
      );
    }
  }

  async function retryBleMap() {
    await retryBleMapRefresh();
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
    wireZonePanel();
    wireZoneAlignPanel();
    wireMapMsgDismiss();
    loadClusterTogglePref();
    updateClusterToggleUi();
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
          } else if (target) {
            target.openPopup();
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
    document.getElementById("mapSaveBtn")?.addEventListener("click", () => {
      void onSaveEditClick();
    });
    document.getElementById("mapSendPendingBtn")?.addEventListener("click", () => {
      void sendPendingMarkerEdits();
    });
    document.getElementById("mapCancelEditBtn")?.addEventListener("click", () => setEditMode(false));
    document.getElementById("mapFullscreenClose")?.addEventListener("click", closeFullscreenMap);
    document.getElementById("mapRetryBtn")?.addEventListener("click", retryBleMap);
    document.getElementById("mapClusterToggleBtn")?.addEventListener("click", () => {
      setClusterEnabled(!bleClusterEnabled);
    });
    document.getElementById("mapFieldPackBtn")?.addEventListener("click", (e) => {
      if (e.shiftKey) {
        void onFieldPackAdvancedMenu();
        return;
      }
      void onFieldPackPrimaryClick();
    });
    document.getElementById("mapRouteExportBtn")?.addEventListener("click", (e) => {
      void onRouteExportClick(e);
    });
    document.getElementById("mapPolygonExportBtn")?.addEventListener("click", (e) => {
      void onPolygonMarkersExportClick(e);
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
    initNativeAppChrome();
    initWebFieldSyncChrome();
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
      setRetryVisible(true);
      updateOfflineEditChrome();
      if (isBleNativeApp()) return;
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
    if (isBleNativeApp()) startBleMapApp();
    else bindBleMapAccessGate(() => startBleMapApp());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootBleMapPage);
  } else {
    bootBleMapPage();
  }
})();
