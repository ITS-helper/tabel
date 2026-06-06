/* Поиск BLE-меток и часов — native APK */
(() => {
  "use strict";

  const FOUND_SOUND_URL = "assets/sounds/technologia-found.mp3";
  const SCAN_MODE_LOW_LATENCY = 2;
  const FOUND_COOLDOWN_MS = 10000;

  let deps = null;
  let panelOpen = false;
  let finderMode = "tag";
  let scanActive = false;
  let scanListener = null;
  /** @type {Map<string, { key: string, label: string, status: string, rssi: number|null, lastSeen: number, deviceName: string }>} */
  let targets = new Map();
  let foundAudio = null;
  let audioReady = false;
  const lastSoundAt = new Map();

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

  function normalizeBle(num) {
    return String(num ?? "")
      .replace(/\D/g, "")
      .replace(/^0+/, "");
  }

  function normalizeMac(mac) {
    if (!mac) return "";
    return String(mac).replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  }

  function normalizeWatchToken(raw) {
    return String(raw ?? "").trim().toLowerCase();
  }

  function dataViewToNumbers(dv) {
    if (!dv) return [];
    if (Array.isArray(dv)) return dv.map((n) => n & 0xff);
    if (typeof dv === "object" && dv.buffer) {
      const view = dv instanceof DataView ? dv : new DataView(dv.buffer);
      const out = [];
      for (let i = 0; i < view.byteLength; i++) out.push(view.getUint8(i));
      return out;
    }
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

  function tagMacKeys(tag) {
    const keys = [];
    const mac = normalizeMac(tag?.mac);
    const chip = normalizeMac(tag?.chipUuid);
    if (mac) keys.push(mac);
    if (chip && chip !== mac) keys.push(chip);
    return keys;
  }

  function hapticTap(ms = 24) {
    try {
      window.Capacitor?.Plugins?.Haptics?.impact?.({ style: "Medium" });
    } catch {
      if (navigator.vibrate) navigator.vibrate(ms);
    }
  }

  function setStatus(text, kind = "") {
    const el = $("bleFinderStatus");
    if (!el) return;
    el.textContent = text || "";
    el.className = "ble-finder-status" + (kind ? ` ble-finder-status--${kind}` : "");
  }

  function parseTargetLines() {
    const raw = $("bleFinderTargets")?.value || "";
    const lines = raw
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (finderMode === "tag") {
      return lines.map((line) => {
        const key = normalizeBle(line);
        return key ? { key, label: `#${key}` } : null;
      }).filter(Boolean);
    }
    return lines.map((line) => {
      const key = normalizeWatchToken(line);
      return key ? { key, label: line } : null;
    }).filter(Boolean);
  }

  function syncTargetsFromInput() {
    const parsed = parseTargetLines();
    const prev = new Map(targets);
    targets = new Map();
    for (const item of parsed) {
      const old = prev.get(item.key);
      targets.set(item.key, {
        key: item.key,
        label: item.label,
        status: old?.status === "found" ? "found" : "pending",
        rssi: old?.rssi ?? null,
        lastSeen: old?.lastSeen ?? 0,
        deviceName: old?.deviceName || "",
      });
    }
    renderList();
    updateScanButton();
  }

  function renderList() {
    const list = $("bleFinderList");
    if (!list) return;
    if (!targets.size) {
      list.innerHTML =
        '<li class="ble-finder-item"><span class="ble-finder-item__meta">Введите номера и нажмите «Сканировать»</span></li>';
      return;
    }
    const rows = [...targets.values()].sort((a, b) => {
      const rank = (s) => (s === "found" ? 0 : s === "near" ? 1 : 2);
      return rank(a.status) - rank(b.status) || String(a.label).localeCompare(String(b.label));
    });
    list.innerHTML = rows
      .map((row) => {
        const cls =
          row.status === "found"
            ? "ble-finder-item--found"
            : row.status === "near"
              ? "ble-finder-item--near"
              : "";
        const badge =
          row.status === "found"
            ? "Найдено"
            : row.status === "near"
              ? "Рядом"
              : scanActive
                ? "Ищем…"
                : "Ожидание";
        const meta =
          row.rssi != null
            ? `${row.deviceName ? `${esc(row.deviceName)} · ` : ""}RSSI ${row.rssi} dBm`
            : row.deviceName
              ? esc(row.deviceName)
              : scanActive
                ? "Сканирование…"
                : "—";
        return `<li class="ble-finder-item ${cls}" data-key="${esc(row.key)}">
          <div class="ble-finder-item__main">
            <span class="ble-finder-item__label">${esc(row.label)}</span>
            <span class="ble-finder-item__meta">${meta}</span>
          </div>
          <span class="ble-finder-item__badge">${badge}</span>
        </li>`;
      })
      .join("");
  }

  function updateScanButton() {
    const btn = $("bleFinderScanBtn");
    if (!btn) return;
    if (scanActive) {
      btn.textContent = "Стоп";
      btn.dataset.state = "stop";
    } else {
      btn.textContent = "Сканировать";
      btn.dataset.state = "scan";
    }
  }

  function updateSummary() {
    if (!scanActive) return;
    const total = targets.size;
    const found = [...targets.values()].filter((t) => t.status === "found").length;
    const near = [...targets.values()].filter((t) => t.status === "near").length;
    if (!total) {
      setStatus("Добавьте номера для поиска", "error");
      return;
    }
    if (found >= total) {
      setStatus(`Все найдены: ${found} из ${total}`, "ok");
      return;
    }
    const parts = [`Найдено ${found} из ${total}`];
    if (near) parts.push(`рядом ${near}`);
    setStatus(`${parts.join(" · ")} — идите по маршруту`, "busy");
  }

  function ensureAudio() {
    if (foundAudio) return foundAudio;
    foundAudio = new Audio(FOUND_SOUND_URL);
    foundAudio.preload = "auto";
    return foundAudio;
  }

  async function primeAudio() {
    const audio = ensureAudio();
    if (audioReady) return;
    try {
      audio.volume = 1;
      audio.muted = true;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      audioReady = true;
    } catch {
      audioReady = true;
    }
  }

  function playFoundSound(key) {
    const now = Date.now();
    const last = lastSoundAt.get(key) || 0;
    if (now - last < FOUND_COOLDOWN_MS) return;
    lastSoundAt.set(key, now);
    hapticTap(36);
    const audio = ensureAudio();
    audio.muted = false;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  function markTargetFound(key, rssi, deviceName) {
    const row = targets.get(key);
    if (!row || row.status === "found") return;
    row.status = "found";
    row.rssi = rssi ?? row.rssi;
    row.lastSeen = Date.now();
    if (deviceName) row.deviceName = deviceName;
    playFoundSound(key);
    renderList();
    updateSummary();
  }

  function matchTagTarget(result, key) {
    const ble = bleFromManufacturerData(result) || bleFromDeviceName(result?.device?.name || result?.localName);
    if (ble && ble === key) return true;
    const mac = normalizeMac(result?.device?.deviceId);
    if (mac) {
      const tag = deps?.findTag?.(key);
      if (tag && tagMacKeys(tag).includes(mac)) return true;
    }
    if (isWwAdvertisement(result) && ble === key) return true;
    return false;
  }

  function matchWatchTarget(result, key) {
    const name = String(result?.device?.name || result?.localName || "").toLowerCase();
    const id = String(result?.device?.deviceId || "").toLowerCase();
    const idCompact = id.replace(/[^a-f0-9]/g, "");
    const keyCompact = key.replace(/[^a-f0-9]/g, "");
    if (name && name.includes(key)) return true;
    if (keyCompact.length >= 4 && idCompact.includes(keyCompact)) return true;
    if (id.includes(key)) return true;
    return false;
  }

  function acceptFinderScan(result) {
    if (finderMode === "watch") return true;
    if (isWwAdvertisement(result)) return true;
    const ble = bleFromManufacturerData(result) || bleFromDeviceName(result?.device?.name || result?.localName);
    if (ble && targets.has(ble)) return true;
    const mac = normalizeMac(result?.device?.deviceId);
    if (mac) {
      for (const key of targets.keys()) {
        const tag = deps?.findTag?.(key);
        if (tag && tagMacKeys(tag).includes(mac)) return true;
      }
    }
    return false;
  }

  function handleScanResult(result) {
    if (!scanActive || !targets.size) return;
    const rssi = result?.rssi ?? null;
    const deviceName = result?.device?.name || result?.localName || "";
    for (const key of targets.keys()) {
      const matched =
        finderMode === "tag" ? matchTagTarget(result, key) : matchWatchTarget(result, key);
      if (!matched) continue;
      const row = targets.get(key);
      if (!row) continue;
      row.rssi = rssi ?? row.rssi;
      row.lastSeen = Date.now();
      if (deviceName) row.deviceName = deviceName;
      if (row.status !== "found") {
        markTargetFound(key, rssi, deviceName);
      }
    }
  }

  async function ensureBleReady() {
    const p = plugin();
    if (!p) throw new Error("BluetoothLe недоступен. Пересоберите APK.");
    await p.initialize({ androidNeverForLocation: true });
    const enabled = await p.isEnabled();
    if (!enabled?.value) {
      await p.requestEnable();
    }
  }

  async function suspendOtherScans() {
    await window.WwBleField?.suspendScan?.();
  }

  async function stopScan() {
    const p = plugin();
    if (scanListener?.remove) {
      try {
        await scanListener.remove();
      } catch {
        /* ignore */
      }
    }
    scanListener = null;
    if (scanActive && p) {
      try {
        await p.stopLEScan();
      } catch {
        /* ignore */
      }
    }
    scanActive = false;
    updateScanButton();
    renderList();
  }

  async function startScan() {
    if (scanActive) {
      await stopScan();
      setStatus("Сканирование остановлено", "info");
      return;
    }
    syncTargetsFromInput();
    if (!targets.size) {
      setStatus(
        finderMode === "tag"
          ? "Введите номера меток — по одному в строке"
          : "Введите имя или MAC часов — по одному в строке",
        "error"
      );
      $("bleFinderTargets")?.focus();
      return;
    }
    await ensureBleReady();
    await primeAudio();
    await suspendOtherScans();
    await stopScan();

    const p = plugin();
    scanListener = await p.addListener("onScanResult", (result) => {
      if (!result?.device?.deviceId) return;
      if (!acceptFinderScan(result)) return;
      handleScanResult(result);
    });
    await p.requestLEScan({
      allowDuplicates: true,
      scanMode: SCAN_MODE_LOW_LATENCY,
    });
    scanActive = true;
    updateScanButton();
    setStatus(
      finderMode === "tag"
        ? `Ищем ${targets.size} меток… поднесите телефон ближе`
        : `Ищем ${targets.size} устройств…`,
      "busy"
    );
    renderList();
  }

  function resetFound() {
    for (const row of targets.values()) {
      row.status = "pending";
      row.rssi = null;
      row.lastSeen = 0;
      row.deviceName = "";
    }
    lastSoundAt.clear();
    renderList();
    if (scanActive) updateSummary();
    else setStatus("Список сброшен — можно сканировать снова", "info");
  }

  function setMode(mode) {
    finderMode = mode === "watch" ? "watch" : "tag";
    document.querySelectorAll(".ble-finder-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === finderMode);
    });
    const area = $("bleFinderTargets");
    if (area) {
      area.placeholder =
        finderMode === "tag"
          ? "Номера меток — по одному в строке\n12345\n67890"
          : "Часы: имя или MAC — по одному в строке\nGalaxy Watch\nAA:BB:CC:DD:EE:FF";
    }
    syncTargetsFromInput();
    if (!scanActive) {
      setStatus(
        finderMode === "tag"
          ? "Режим меток: ищем WW-маяки по номеру"
          : "Режим часов: ищем по имени или MAC в эфире",
        "info"
      );
    }
  }

  function openPanel() {
    void window.WwBleField?.close?.();
    const panel = $("bleFinderPanel");
    if (!panel) return;
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    document.body.classList.add("ble-finder-open");
    panelOpen = true;
    setMode(finderMode);
    renderList();
    $("bleFinderTargets")?.focus();
  }

  async function closePanel() {
    await stopScan();
    const panel = $("bleFinderPanel");
    if (panel) {
      panel.hidden = true;
      panel.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("ble-finder-open");
    panelOpen = false;
  }

  function bindUi() {
    $("bleFinderCloseBtn")?.addEventListener("click", () => {
      void closePanel();
    });
    $("bleFinderScanBtn")?.addEventListener("click", () => {
      void startScan().catch((e) => setStatus(String(e?.message || e), "error"));
    });
    $("bleFinderResetBtn")?.addEventListener("click", () => {
      resetFound();
    });
    $("mapBleFinderBtn")?.addEventListener("click", () => {
      openPanel();
    });
    document.querySelectorAll(".ble-finder-tab").forEach((btn) => {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    });
    $("bleFinderTargets")?.addEventListener("input", () => {
      if (!scanActive) syncTargetsFromInput();
    });
  }

  function init(api) {
    deps = api || null;
    if (!api?.isNative?.()) return false;
    bindUi();
    const btn = $("mapBleFinderBtn");
    if (btn) {
      btn.hidden = false;
      btn.title = "Поиск меток и часов по Bluetooth";
    }
    return true;
  }

  window.WwBleFinder = {
    init,
    open: openPanel,
    close: closePanel,
    isOpen: () => panelOpen,
  };
})();
