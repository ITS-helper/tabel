/**
 * Расстановка по зонам (из workarounds): drag-and-drop, утро/вечер, синхронизация через app.js.
 */
(function () {
  "use strict";

  const ZONE_KEYS = ["pool", "spg1", "spg2", "spg3", "spg4", "dayoff"];
  const AVATAR_COLORS = [
    "#1565C0", "#00897B", "#E53935", "#5E35B1", "#0277BD",
    "#00695C", "#BF360C", "#6A1B9A", "#01579B", "#004D40",
    "#B71C1C", "#4527A0", "#006064", "#E65100", "#1B5E20",
    "#37474F", "#795548",
  ];

  const SHEET_ZONES = [
    { key: "spg1", label: "СПГ 1", dot: "zsb-dot-spg1", abbr: "СПГ1" },
    { key: "spg2", label: "СПГ 2", dot: "zsb-dot-spg2", abbr: "СПГ2" },
    { key: "spg3", label: "СПГ 3", dot: "zsb-dot-spg3", abbr: "СПГ3" },
    { key: "spg4", label: "Усиление утро", dot: "zsb-dot-spg4", abbr: "УС" },
    { key: "dayoff", label: "Выходной", dot: "zsb-dot-dayoff", abbr: "ВЫХ" },
    { key: "pool", label: "Нераспределённые", dot: "zsb-dot-pool", abbr: "—" },
  ];

  let api = null;
  let currentShift = "morning";
  let rosterCount = 0;
  let dragPerson = null;
  let dragSourceZone = null;
  let dragGhost = null;
  let touchOffsetX = 0;
  let touchOffsetY = 0;
  let sheetOverlay = null;
  let sheetPerson = null;
  let sheetSourceZone = null;
  let bound = false;

  function emptyPlacement() {
    return { pool: [], spg1: [], spg2: [], spg3: [], spg4: [], dayoff: [] };
  }

  function getInitials(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }

  function getAvatarColor(name) {
    let hash = 0;
    for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  function zoneContainerId(zone) {
    return zone === "pool" ? "zpPool" : "zp-zone-" + zone;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function canEdit() {
    return api && typeof api.canEdit === "function" && api.canEdit();
  }

  function mergePlacementWithRoster(saved, roster) {
    const rosterSet = new Set(roster);
    const seen = new Set();
    const out = emptyPlacement();
    for (const z of ZONE_KEYS) {
      for (const n of saved[z] || []) {
        if (!rosterSet.has(n) || seen.has(n)) continue;
        seen.add(n);
        out[z].push(n);
      }
    }
    for (const n of roster) {
      if (!seen.has(n)) {
        out.pool.push(n);
        seen.add(n);
      }
    }
    return out;
  }

  function getMonthBucket() {
    const mk = api.getMonthKey();
    if (!api.state.zonePlacementByMonth[mk]) {
      api.state.zonePlacementByMonth[mk] = { shift: "morning", morning: emptyPlacement(), evening: emptyPlacement() };
    }
    return api.state.zonePlacementByMonth[mk];
  }

  function getCurrentPlacement() {
    const bucket = getMonthBucket();
    currentShift = bucket.shift === "evening" ? "evening" : "morning";
    return bucket[currentShift] || emptyPlacement();
  }

  function setCurrentPlacement(placement) {
    const bucket = getMonthBucket();
    bucket.shift = currentShift;
    bucket[currentShift] = placement;
    api.persistLocal();
    api.scheduleRemotePersist();
  }

  function createChip(name, zone) {
    const chip = document.createElement("div");
    chip.className = "person-chip";
    chip.dataset.person = name;
    chip.dataset.zone = zone;
    const avatar = document.createElement("div");
    avatar.className = "person-avatar";
    avatar.style.background = getAvatarColor(name);
    avatar.textContent = getInitials(name);
    chip.appendChild(avatar);
    chip.appendChild(document.createTextNode(name));
    if (canEdit()) {
      chip.addEventListener("mousedown", onMouseDown);
      chip.addEventListener("touchstart", onTouchStart, { passive: false });
    } else {
      chip.classList.add("person-chip--readonly");
    }
    addTapToChip(chip);
    return chip;
  }

  function onMouseDown(e) {
    if (!canEdit() || e.button !== 0) return;
    e.preventDefault();
    startDrag(e.currentTarget, e.clientX, e.clientY);
  }

  function onTouchStart(e) {
    if (!canEdit() || e.touches.length !== 1) return;
    if (window.innerWidth <= 768) return;
    e.preventDefault();
    startDrag(e.currentTarget, e.touches[0].clientX, e.touches[0].clientY);
  }

  function startDrag(chip, clientX, clientY) {
    dragPerson = chip.dataset.person;
    dragSourceZone = chip.dataset.zone;
    chip.classList.add("dragging");
    const rect = chip.getBoundingClientRect();
    touchOffsetX = clientX - rect.left;
    touchOffsetY = clientY - rect.top;
    dragGhost = chip.cloneNode(true);
    dragGhost.style.cssText =
      "position:fixed;z-index:9999;pointer-events:none;opacity:0.85;transform:rotate(2deg) scale(1.06);transition:none;box-shadow:0 8px 28px rgba(0,0,0,0.2);left:" +
      (clientX - touchOffsetX) +
      "px;top:" +
      (clientY - touchOffsetY) +
      "px;width:" +
      rect.width +
      "px;";
    document.body.appendChild(dragGhost);
  }

  function onDocMouseMove(e) {
    if (!dragGhost) return;
    dragGhost.style.left = e.clientX - touchOffsetX + "px";
    dragGhost.style.top = e.clientY - touchOffsetY + "px";
    highlightDropZone(e.clientX, e.clientY);
  }

  function onDocMouseUp(e) {
    if (!dragGhost) return;
    finishDrag(getDropZoneAt(e.clientX, e.clientY));
  }

  function onDocTouchMove(e) {
    if (!dragGhost) return;
    e.preventDefault();
    const t = e.touches[0];
    dragGhost.style.left = t.clientX - touchOffsetX + "px";
    dragGhost.style.top = t.clientY - touchOffsetY + "px";
    highlightDropZone(t.clientX, t.clientY);
  }

  function onDocTouchEnd(e) {
    if (!dragGhost) return;
    const t = e.changedTouches[0];
    finishDrag(getDropZoneAt(t.clientX, t.clientY));
  }

  function highlightDropZone(cx, cy) {
    document.querySelectorAll(".zp-pool-zone, .zp-zone-card, .zp-zone-drop").forEach((el) => el.classList.remove("drag-over"));
    const el = document.elementFromPoint(cx, cy);
    if (!el) return;
    const zone = el.closest("[data-zone]");
    if (zone) zone.classList.add("drag-over");
  }

  function getDropZoneAt(cx, cy) {
    const el = document.elementFromPoint(cx, cy);
    if (!el) return null;
    return el.closest("[data-zone]");
  }

  function finishDrag(dropZoneEl) {
    if (dragGhost) {
      dragGhost.remove();
      dragGhost = null;
    }
    document.querySelectorAll(".person-chip.dragging").forEach((c) => c.classList.remove("dragging"));
    document.querySelectorAll(".zp-pool-zone, .zp-zone-card, .zp-zone-drop").forEach((el) => el.classList.remove("drag-over"));
    if (!dragPerson) return;
    let targetZone = null;
    if (dropZoneEl) {
      targetZone = dropZoneEl.dataset.zone;
      if (!targetZone) {
        const zoneCard = dropZoneEl.closest(".zp-zone-card");
        if (zoneCard) targetZone = zoneCard.dataset.zone;
      }
    }
    if (targetZone && targetZone !== dragSourceZone) movePerson(dragPerson, dragSourceZone, targetZone);
    dragPerson = null;
    dragSourceZone = null;
  }

  function movePerson(name, fromZone, toZone) {
    if (!canEdit() || !ZONE_KEYS.includes(toZone)) return;
    const fromContainer = $(zoneContainerId(fromZone));
    const existing = fromContainer ? fromContainer.querySelector('[data-person="' + CSS.escape(name) + '"]') : null;
    if (existing) existing.remove();
    const toContainer = $(zoneContainerId(toZone));
    if (!toContainer) return;
    const chip = createChip(name, toZone);
    const placeholder = toContainer.querySelector(".zone-empty");
    if (placeholder) placeholder.remove();
    toContainer.appendChild(chip);
    persistFromDom();
    updateDeploymentUI();
  }

  function readPlacementFromDom() {
    const state = emptyPlacement();
    for (const z of ZONE_KEYS) {
      const container = $(zoneContainerId(z));
      if (!container) continue;
      container.querySelectorAll(".person-chip").forEach((chip) => {
        if (chip.dataset.person) state[z].push(chip.dataset.person);
      });
    }
    return state;
  }

  function persistFromDom() {
    setCurrentPlacement(readPlacementFromDom());
  }

  function updateDeploymentUI() {
    let totalPlaced = 0;
    for (const z of ZONE_KEYS) {
      const container = $(zoneContainerId(z));
      if (!container) continue;
      const chips = container.querySelectorAll(".person-chip");
      if (z !== "pool") {
        const badge = $("zpBadge-" + z);
        if (badge) badge.textContent = String(chips.length);
        totalPlaced += chips.length;
        const empty = container.querySelector(".zone-empty");
        if (chips.length === 0 && !empty) {
          const ph = document.createElement("span");
          ph.className = "zone-empty";
          ph.textContent = "Перетащите сюда";
          container.appendChild(ph);
        } else if (chips.length > 0 && empty) {
          empty.remove();
        }
      }
    }
    const poolEl = $("zpPool");
    const poolCount = poolEl ? poolEl.querySelectorAll(".person-chip").length : 0;
    const poolCountEl = $("zpPoolCount");
    if (poolCountEl) poolCountEl.textContent = String(poolCount);
    const pct = rosterCount > 0 ? Math.round((totalPlaced / rosterCount) * 100) : 0;
    const prog = $("zpDeploymentProgress");
    if (prog) prog.style.width = pct + "%";
    const section = $("zonePlacementSection");
    if (section) section.classList.toggle("zone-placement--readonly", !canEdit());
  }

  function applyPlacementState(placement) {
    for (const z of ZONE_KEYS) {
      const container = $(zoneContainerId(z));
      if (container) container.innerHTML = "";
    }
    for (const z of ZONE_KEYS) {
      const names = placement[z] || [];
      const container = $(zoneContainerId(z));
      if (!container) continue;
      names.forEach((name) => container.appendChild(createChip(name, z)));
      if (z !== "pool" && names.length === 0) {
        const ph = document.createElement("span");
        ph.className = "zone-empty";
        ph.textContent = "Перетащите сюда";
        container.appendChild(ph);
      }
    }
    updateDeploymentUI();
  }

  function setShift(shift) {
    if (shift !== "morning" && shift !== "evening") return;
    const bucket = getMonthBucket();
    bucket[currentShift] = readPlacementFromDom();
    currentShift = shift;
    bucket.shift = shift;
    const next = bucket[shift] || emptyPlacement();
    const roster = api.getRosterNames();
    applyPlacementState(mergePlacementWithRoster(next, roster));
    setCurrentPlacement(readPlacementFromDom());
    $("zpBtnMorning")?.classList.toggle("active", shift === "morning");
    $("zpBtnEvening")?.classList.toggle("active", shift === "evening");
    api.persistLocal();
  }

  function resetDeployment() {
    if (!canEdit()) return;
    const roster = api.getRosterNames();
    applyPlacementState({ pool: [...roster], spg1: [], spg2: [], spg3: [], spg4: [], dayoff: [] });
    setCurrentPlacement(readPlacementFromDom());
  }

  function formatTodayRu() {
    const t = new Date();
    const d = String(t.getDate()).padStart(2, "0");
    const m = String(t.getMonth() + 1).padStart(2, "0");
    return d + "." + m + "." + t.getFullYear();
  }

  async function copyDeployment() {
    const deploy = readPlacementFromDom();
    const shiftLabel = currentShift === "morning" ? "Утро" : "Вечер";
    const shiftEmoji = currentShift === "morning" ? "🌅" : "🌙";
    let text = "📅 " + formatTodayRu() + " | " + shiftEmoji + " Расстановка " + shiftLabel + ":\n";
    const zones = [
      { key: "spg1", label: "СПГ 1" },
      { key: "spg2", label: "СПГ 2" },
      { key: "spg3", label: "СПГ 3" },
      { key: "spg4", label: "Усиление утро" },
      { key: "dayoff", label: "Выходной" },
    ];
    let hasAny = false;
    for (const { key, label } of zones) {
      const names = deploy[key] || [];
      if (names.length) {
        text += "\n" + label + ":\n";
        for (const n of names) text += "  • " + n + "\n";
        hasAny = true;
      }
    }
    if (!hasAny) text += "\n(Инженеры не распределены)";
    try {
      await navigator.clipboard.writeText(text);
      const btn = $("zpBtnCopyDeploy");
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = "✅ Скопировано";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = prev;
          btn.classList.remove("copied");
        }, 2500);
      }
    } catch (_) {
      window.prompt("Скопируйте расстановку:", text);
    }
  }

  function isMobile() {
    return window.innerWidth <= 768;
  }

  function createSheet() {
    if (sheetOverlay) return;
    sheetOverlay = document.createElement("div");
    sheetOverlay.className = "zone-sheet-overlay";
    sheetOverlay.id = "zoneSheetOverlay";
    sheetOverlay.innerHTML =
      '<div class="zone-sheet" id="zoneSheet">' +
      '<div class="zone-sheet-handle"></div>' +
      '<div class="zone-sheet-title">Переместить <span class="zone-sheet-person" id="zoneSheetPerson"></span></div>' +
      '<div class="zone-sheet-options" id="zoneSheetOptions"></div>' +
      '<button type="button" class="zone-sheet-cancel" id="zoneSheetCancel">Отмена</button>' +
      "</div>";
    document.body.appendChild(sheetOverlay);
    sheetOverlay.addEventListener("click", (e) => {
      if (e.target === sheetOverlay) closeSheet();
    });
    $("zoneSheetCancel")?.addEventListener("click", closeSheet);
    const sheet = $("zoneSheet");
    if (sheet) {
      let touchStartY = 0;
      sheet.addEventListener(
        "touchstart",
        (e) => {
          touchStartY = e.touches[0].clientY;
        },
        { passive: true }
      );
      sheet.addEventListener(
        "touchmove",
        (e) => {
          if (e.touches[0].clientY - touchStartY > 60) closeSheet();
        },
        { passive: true }
      );
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSheet();
    });
  }

  function openSheet(personName, fromZone) {
    if (!canEdit()) return;
    createSheet();
    sheetPerson = personName;
    sheetSourceZone = fromZone;
    const personEl = $("zoneSheetPerson");
    if (personEl) personEl.textContent = personName;
    const optionsEl = $("zoneSheetOptions");
    if (!optionsEl) return;
    optionsEl.innerHTML = "";
    for (const zone of SHEET_ZONES) {
      const container = $(zoneContainerId(zone.key));
      const count = container ? container.querySelectorAll(".person-chip").length : 0;
      const isCurrent = zone.key === fromZone;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "zone-sheet-btn" + (isCurrent ? " current" : "");
      btn.innerHTML =
        '<div class="zsb-dot ' +
        zone.dot +
        '">' +
        zone.abbr +
        '</div><div class="zsb-info"><span class="zsb-label">' +
        zone.label +
        (isCurrent ? " ← сейчас" : "") +
        '</span><span class="zsb-count">' +
        count +
        " чел.</span></div>";
      btn.addEventListener("click", () => {
        if (!isCurrent) movePerson(sheetPerson, sheetSourceZone, zone.key);
        closeSheet();
      });
      optionsEl.appendChild(btn);
    }
    sheetOverlay.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeSheet() {
    if (!sheetOverlay) return;
    sheetOverlay.classList.remove("open");
    document.body.style.overflow = "";
    sheetPerson = null;
    sheetSourceZone = null;
  }

  function addTapToChip(chip) {
    if (chip._zpTapPatched) return;
    chip._zpTapPatched = true;
    let tapStartTime = 0;
    let tapStartX = 0;
    let tapStartY = 0;
    let wasDragged = false;

    chip.addEventListener(
      "touchstart",
      (e) => {
        if (!isMobile() || !canEdit()) return;
        tapStartTime = Date.now();
        tapStartX = e.touches[0].clientX;
        tapStartY = e.touches[0].clientY;
        wasDragged = false;
        e.stopPropagation();
      },
      { capture: true }
    );
    chip.addEventListener(
      "touchmove",
      (e) => {
        if (!isMobile()) return;
        const dx = Math.abs(e.touches[0].clientX - tapStartX);
        const dy = Math.abs(e.touches[0].clientY - tapStartY);
        if (dx > 10 || dy > 10) wasDragged = true;
      },
      { passive: true }
    );
    chip.addEventListener(
      "touchend",
      (e) => {
        if (!isMobile() || !canEdit()) return;
        e.stopPropagation();
        if (wasDragged) return;
        if (Date.now() - tapStartTime < 400) {
          e.preventDefault();
          const name = chip.dataset.person;
          const zone = chip.dataset.zone;
          if (name) openSheet(name, zone);
        }
      },
      { capture: true }
    );

    chip.addEventListener("dblclick", (e) => {
      if (isMobile() || !canEdit()) return;
      e.preventDefault();
      e.stopPropagation();
      const name = chip.dataset.person;
      const zone = chip.dataset.zone;
      if (name) openSheet(name, zone);
    });
  }

  function bindControlsOnce() {
    if (bound) return;
    bound = true;
    document.addEventListener("mousemove", onDocMouseMove);
    document.addEventListener("mouseup", onDocMouseUp);
    document.addEventListener("touchmove", onDocTouchMove, { passive: false });
    document.addEventListener("touchend", onDocTouchEnd);
    $("zpBtnMorning")?.addEventListener("click", () => setShift("morning"));
    $("zpBtnEvening")?.addEventListener("click", () => setShift("evening"));
    $("zpBtnCopyDeploy")?.addEventListener("click", () => void copyDeployment());
    $("zpBtnResetDeploy")?.addEventListener("click", resetDeployment);
    createSheet();
  }

  function refresh() {
    if (!api || !$("zonePlacementSection")) return;
    bindControlsOnce();
    const roster = api.getRosterNames();
    rosterCount = roster.length;
    const bucket = getMonthBucket();
    currentShift = bucket.shift === "evening" ? "evening" : "morning";
    $("zpBtnMorning")?.classList.toggle("active", currentShift === "morning");
    $("zpBtnEvening")?.classList.toggle("active", currentShift === "evening");
    const placement = mergePlacementWithRoster(bucket[currentShift] || emptyPlacement(), roster);
    bucket[currentShift] = placement;
    applyPlacementState(placement);
    const empty = roster.length === 0;
    $("zonePlacementSection")?.classList.toggle("zone-placement--empty", empty);
  }

  function init(workWatchApi) {
    api = workWatchApi;
    refresh();
  }

  window.WorkWatchZonePlacement = { init, refresh };
})();
