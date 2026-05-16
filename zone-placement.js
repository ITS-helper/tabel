/**
 * Расстановка по зонам: pointer-drag (как workarounds), клик «сотрудник → зона», синхронизация через app.js.
 */
(function () {
  "use strict";

  const ZONE_KEYS = ["pool", "spg1", "spg2", "spg21", "spg3", "spg31", "spg4", "dayoff"];
  const DRAG_THRESHOLD_PX = 6;
  const AVATAR_COLORS = [
    "#1565C0", "#00897B", "#E53935", "#5E35B1", "#0277BD",
    "#00695C", "#BF360C", "#6A1B9A", "#01579B", "#004D40",
    "#B71C1C", "#4527A0", "#006064", "#E65100", "#1B5E20",
    "#37474F", "#795548",
  ];

  const SHEET_ZONES = [
    { key: "spg1", label: "СПГ 1", dot: "zsb-dot-spg1", abbr: "СПГ1" },
    { key: "spg2", label: "СПГ 2", dot: "zsb-dot-spg2", abbr: "СПГ2" },
    { key: "spg21", label: "СПГ 2.1", dot: "zsb-dot-spg21", abbr: "2.1" },
    { key: "spg3", label: "СПГ 3", dot: "zsb-dot-spg3", abbr: "СПГ3" },
    { key: "spg31", label: "СПГ 3.1", dot: "zsb-dot-spg31", abbr: "3.1" },
    { key: "spg4", label: "Усиление", dot: "zsb-dot-spg4", abbr: "УС" },
    { key: "dayoff", label: "Выходной", dot: "zsb-dot-dayoff", abbr: "ВЫХ" },
    { key: "pool", label: "Нераспределённые", dot: "zsb-dot-pool", abbr: "—" },
  ];

  const DROP_HIGHLIGHT_SEL =
    ".zp-pool-zone, .zp-zone-card, .zp-zone-drop";

  let api = null;
  let currentShift = "morning";
  let selectedPerson = null;
  let dragSession = false;
  /** @type {{ chip: HTMLElement, name: string, from: string, startX: number, startY: number, dragging: boolean, ghost: HTMLElement|null, offsetX: number, offsetY: number, pointerId: number } | null} */
  let pointerState = null;
  let sheetOverlay = null;
  let sheetPerson = null;
  let sheetSourceZone = null;
  let bound = false;

  function emptyPlacement() {
    return { pool: [], spg1: [], spg2: [], spg21: [], spg3: [], spg31: [], spg4: [], dayoff: [] };
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

  function getTodayDayOffSet() {
    if (typeof api.getTodayDayOffNames === "function") {
      return new Set(api.getTodayDayOffNames());
    }
    return new Set();
  }

  function mergePlacementWithRoster(saved, roster, todayDayOffSet) {
    const rosterSet = new Set(roster);
    const autoDayOff = todayDayOffSet || new Set();
    const seen = new Set();
    const out = emptyPlacement();

    const assign = (name, preferredZone) => {
      if (!rosterSet.has(name)) return;
      const zone = autoDayOff.has(name) ? "dayoff" : preferredZone;
      for (const z of ZONE_KEYS) {
        const idx = out[z].indexOf(name);
        if (idx >= 0) out[z].splice(idx, 1);
      }
      out[zone].push(name);
      seen.add(name);
    };

    for (const z of ZONE_KEYS) {
      for (const n of saved[z] || []) {
        assign(n, z);
      }
    }
    for (const n of roster) {
      if (!seen.has(n)) assign(n, autoDayOff.has(n) ? "dayoff" : "pool");
    }
    return out;
  }

  function getSectionKey() {
    const sid = api.getSectionId();
    return sid === "pilot" || sid === "ust" ? sid : null;
  }

  function normalizeMonthEntry(month) {
    if (!month || typeof month !== "object") return;
    const hasLegacy =
      month.morning != null ||
      month.evening != null ||
      Array.isArray(month.pool) ||
      Array.isArray(month.spg1);
    if (!hasLegacy || month.ust != null || month.pilot != null) return;
    month.ust = {
      shift: month.shift === "evening" ? "evening" : "morning",
      morning:
        month.morning && typeof month.morning === "object"
          ? month.morning
          : emptyPlacement(),
      evening:
        month.evening && typeof month.evening === "object"
          ? month.evening
          : emptyPlacement(),
    };
    delete month.shift;
    delete month.morning;
    delete month.evening;
    delete month.pool;
    delete month.spg1;
    delete month.spg2;
    delete month.spg21;
    delete month.spg3;
    delete month.spg31;
    delete month.spg4;
    delete month.dayoff;
  }

  function getMonthBucket(createIfMissing) {
    const mk = api.getMonthKey();
    if (!api.state.zonePlacementByMonth[mk]) {
      if (createIfMissing === false) return null;
      api.state.zonePlacementByMonth[mk] = {};
    }
    const month = api.state.zonePlacementByMonth[mk];
    normalizeMonthEntry(month);
    const sid = getSectionKey();
    if (!sid) return null;
    if (!month[sid]) {
      if (createIfMissing === false) return null;
      month[sid] = { shift: "morning", morning: emptyPlacement(), evening: emptyPlacement() };
    }
    return month[sid];
  }

  function getCurrentPlacement() {
    const bucket = getMonthBucket(true);
    if (!bucket) return emptyPlacement();
    currentShift = bucket.shift === "evening" ? "evening" : "morning";
    return bucket[currentShift] || emptyPlacement();
  }

  function setCurrentPlacement(placement) {
    const bucket = getMonthBucket(true);
    if (!bucket) return;
    bucket.shift = currentShift;
    bucket[currentShift] = placement;
    api.persistLocal();
    api.scheduleRemotePersist();
  }

  function findChipByName(container, name) {
    if (!container) return null;
    const chips = container.querySelectorAll(".person-chip");
    for (let i = 0; i < chips.length; i++) {
      if (chips[i].dataset.person === name) return chips[i];
    }
    return null;
  }

  function clearDragOverHighlights() {
    document.querySelectorAll(DROP_HIGHLIGHT_SEL + ".drag-over").forEach((el) => {
      el.classList.remove("drag-over");
    });
  }

  function getDropZoneKeyAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const zoneEl = el.closest("[data-zone]");
    if (!zoneEl) return null;
    const key = zoneEl.dataset.zone;
    return ZONE_KEYS.includes(key) ? key : null;
  }

  function highlightDropZone(clientX, clientY) {
    clearDragOverHighlights();
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return;
    const zoneEl = el.closest("[data-zone]");
    if (zoneEl) zoneEl.classList.add("drag-over");
  }

  function clearSelection() {
    selectedPerson = null;
    document.querySelectorAll(".person-chip--selected").forEach((c) => {
      c.classList.remove("person-chip--selected");
    });
    $("zonePlacementSection")?.classList.remove("zone-placement--pick-mode");
  }

  function selectPerson(name, from, chipEl) {
    clearSelection();
    selectedPerson = { name: name, from: from };
    chipEl.classList.add("person-chip--selected");
    $("zonePlacementSection")?.classList.add("zone-placement--pick-mode");
  }

  function useTapAssign() {
    return window.matchMedia("(max-width: 768px) and (pointer: coarse)").matches;
  }

  function beginPointerDrag(st, clientX, clientY) {
    st.dragging = true;
    dragSession = true;
    document.body.classList.add("zp-drag-active");
    st.chip.classList.add("dragging");
    clearSelection();
    const rect = st.chip.getBoundingClientRect();
    st.offsetX = clientX - rect.left;
    st.offsetY = clientY - rect.top;
    st.ghost = st.chip.cloneNode(true);
    st.ghost.classList.add("zp-drag-ghost");
    st.ghost.style.cssText =
      "position:fixed;z-index:10000;pointer-events:none;opacity:0.92;" +
      "transform:rotate(2deg) scale(1.04);box-shadow:0 8px 28px rgba(0,0,0,0.22);" +
      "left:" +
      (clientX - st.offsetX) +
      "px;top:" +
      (clientY - st.offsetY) +
      "px;width:" +
      rect.width +
      "px;";
    document.body.appendChild(st.ghost);
  }

  function cleanupPointerDrag() {
    if (pointerState?.ghost) {
      pointerState.ghost.remove();
    }
    if (pointerState?.chip) {
      pointerState.chip.classList.remove("dragging");
    }
    document.body.classList.remove("zp-drag-active");
    clearDragOverHighlights();
    pointerState = null;
    dragSession = false;
  }

  function onChipPointerDown(e) {
    if (!canEdit()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pointerState) return;

    const chip = e.currentTarget;
    pointerState = {
      chip: chip,
      name: chip.dataset.person,
      from: chip.dataset.zone,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      ghost: null,
      offsetX: 0,
      offsetY: 0,
      pointerId: e.pointerId,
    };

    try {
      chip.setPointerCapture(e.pointerId);
    } catch (_) {}

    e.preventDefault();
  }

  function onChipPointerMove(e) {
    if (!pointerState || e.pointerId !== pointerState.pointerId) return;
    const st = pointerState;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;

    if (!st.dragging) {
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      beginPointerDrag(st, e.clientX, e.clientY);
    }

    if (st.ghost) {
      st.ghost.style.left = e.clientX - st.offsetX + "px";
      st.ghost.style.top = e.clientY - st.offsetY + "px";
    }
    highlightDropZone(e.clientX, e.clientY);
    e.preventDefault();
  }

  function onChipPointerUp(e) {
    if (!pointerState || e.pointerId !== pointerState.pointerId) return;
    const st = pointerState;

    try {
      st.chip.releasePointerCapture(e.pointerId);
    } catch (_) {}

    if (st.dragging) {
      const toZone = getDropZoneKeyAt(e.clientX, e.clientY);
      if (toZone && toZone !== st.from) {
        movePerson(st.name, st.from, toZone);
      }
      cleanupPointerDrag();
      return;
    }

    cleanupPointerDrag();

    if (useTapAssign()) {
      openSheet(st.name, st.from);
    } else {
      selectPerson(st.name, st.from, st.chip);
    }
  }

  function bindZoneClickTargetsOnce() {
    if (bindZoneClickTargetsOnce.done) return;
    bindZoneClickTargetsOnce.done = true;
    const section = $("zonePlacementSection");
    if (!section) return;
    section.addEventListener("click", (e) => {
      if (!canEdit() || !selectedPerson) return;
      if (e.target.closest(".person-chip")) return;
      const zoneEl = e.target.closest("[data-zone]");
      if (!zoneEl || !section.contains(zoneEl)) return;
      const toZone = zoneEl.dataset.zone;
      if (!toZone || !ZONE_KEYS.includes(toZone) || toZone === selectedPerson.from) return;
      movePerson(selectedPerson.name, selectedPerson.from, toZone);
      clearSelection();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        clearSelection();
        closeSheet();
      }
    });
  }

  function attachChipInteractions(chip) {
    if (!canEdit()) return;
    chip.addEventListener("pointerdown", onChipPointerDown);
    chip.addEventListener("pointermove", onChipPointerMove);
    chip.addEventListener("pointerup", onChipPointerUp);
    chip.addEventListener("pointercancel", onChipPointerUp);
    chip.addEventListener("dblclick", (e) => {
      if (useTapAssign() || !canEdit()) return;
      e.preventDefault();
      e.stopPropagation();
      const name = chip.dataset.person;
      const zone = chip.dataset.zone;
      if (name) openSheet(name, zone);
    });
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
      attachChipInteractions(chip);
    } else {
      chip.classList.add("person-chip--readonly");
    }
    return chip;
  }

  function movePerson(name, fromZone, toZone) {
    if (!canEdit() || !ZONE_KEYS.includes(toZone)) return;
    const fromContainer = $(zoneContainerId(fromZone));
    const existing = findChipByName(fromContainer, name);
    if (existing) existing.remove();
    const toContainer = $(zoneContainerId(toZone));
    if (!toContainer) return;
    const chip = createChip(name, toZone);
    const placeholder = toContainer.querySelector(".zone-empty");
    if (placeholder) placeholder.remove();
    toContainer.appendChild(chip);
    persistFromDom();
    clearSelection();
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
    for (const z of ZONE_KEYS) {
      const container = $(zoneContainerId(z));
      if (!container) continue;
      const chips = container.querySelectorAll(".person-chip");
      if (z !== "pool") {
        const badge = $("zpBadge-" + z);
        if (badge) badge.textContent = String(chips.length);
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
    const section = $("zonePlacementSection");
    if (section) section.classList.toggle("zone-placement--readonly", !canEdit());
    const lockHint = $("zonePlacementLockHint");
    if (lockHint) {
      const msg = api.getLockHint ? api.getLockHint() : "";
      if (canEdit()) {
        lockHint.hidden = true;
        lockHint.textContent = "";
      } else {
        lockHint.hidden = false;
        lockHint.textContent =
          msg ||
          "Чтобы менять расстановку: режим «Редактирование» и вход в систему. Или двойной клик по фамилии.";
      }
    }
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
    const bucket = getMonthBucket(true);
    if (!bucket) return;
    bucket[currentShift] = readPlacementFromDom();
    currentShift = shift;
    bucket.shift = shift;
    const next = bucket[shift] || emptyPlacement();
    const roster = api.getRosterNames();
    applyPlacementState(mergePlacementWithRoster(next, roster, getTodayDayOffSet()));
    setCurrentPlacement(readPlacementFromDom());
    $("zpBtnMorning")?.classList.toggle("active", shift === "morning");
    $("zpBtnEvening")?.classList.toggle("active", shift === "evening");
    api.persistLocal();
  }

  function resetDeployment() {
    if (!canEdit()) return;
    const roster = api.getRosterNames();
    const dayOff = getTodayDayOffSet();
    const reset = emptyPlacement();
    for (const n of roster) {
      if (dayOff.has(n)) reset.dayoff.push(n);
      else reset.pool.push(n);
    }
    applyPlacementState(reset);
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
    const objTitle = api.getSectionTitle ? api.getSectionTitle() : "";
    let text = "📅 " + formatTodayRu() + " | " + shiftEmoji + " Расстановка " + shiftLabel;
    if (objTitle) text += " («" + objTitle + "»)";
    text += ":\n";
    const zones = [
      { key: "spg1", label: "СПГ 1" },
      { key: "spg2", label: "СПГ 2" },
      { key: "spg21", label: "СПГ 2.1" },
      { key: "spg3", label: "СПГ 3" },
      { key: "spg31", label: "СПГ 3.1" },
      { key: "spg4", label: "Усиление" },
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

  function bindControlsOnce() {
    if (bound) return;
    bound = true;
    bindZoneClickTargetsOnce();
    $("zpBtnMorning")?.addEventListener("click", () => setShift("morning"));
    $("zpBtnEvening")?.addEventListener("click", () => setShift("evening"));
    $("zpBtnCopyDeploy")?.addEventListener("click", () => void copyDeployment());
    $("zpBtnResetDeploy")?.addEventListener("click", resetDeployment);
    createSheet();
  }

  function refresh() {
    if (!api || !$("zonePlacementSection")) return;
    if (dragSession) return;
    bindControlsOnce();
    const sectionEl = $("zonePlacementSection");
    const hint = $("zonePlacementHint");
    const sid = getSectionKey();
    if (!sid) {
      sectionEl.classList.add("zone-placement--inactive");
      sectionEl.classList.remove("zone-placement--empty");
      if (hint) {
        hint.textContent =
          "Расстановка на вкладках «Усть-Луга» и «Пилотные проекты». На сводной вкладке блок недоступен.";
      }
      return;
    }
    sectionEl.classList.remove("zone-placement--inactive");
    if (hint) {
      const title = api.getSectionTitle ? api.getSectionTitle() : sid;
      hint.textContent = canEdit()
        ? "Состав: «" +
          title +
          "» (есть смены в месяце). Сегодня ВХ → «Выходной». Перетащите или клик: сотрудник → зона."
        : "Состав: «" + title + "» — только с сменами в месяце. Сегодня ВХ в «Выходной».";
    }
    const roster = api.getRosterNames();
    const dayOff = getTodayDayOffSet();
    const bucket = getMonthBucket(true);
    if (!bucket) return;
    currentShift = bucket.shift === "evening" ? "evening" : "morning";
    $("zpBtnMorning")?.classList.toggle("active", currentShift === "morning");
    $("zpBtnEvening")?.classList.toggle("active", currentShift === "evening");
    const placement = mergePlacementWithRoster(bucket[currentShift] || emptyPlacement(), roster, dayOff);
    bucket[currentShift] = placement;
    applyPlacementState(placement);
    const empty = roster.length === 0;
    sectionEl.classList.toggle("zone-placement--empty", empty);
  }

  function init(workWatchApi) {
    api = workWatchApi;
    refresh();
  }

  window.WorkWatchZonePlacement = { init, refresh };
})();
