/**
 * Кураторы и обучаемые (младшие инженеры): drag / tap, синхронизация через app.js.
 */
(function () {
  "use strict";

  const DRAG_THRESHOLD_PX = 6;
  const AVATAR_COLORS = [
    "#1565C0", "#00897B", "#E53935", "#5E35B1", "#0277BD",
    "#00695C", "#BF360C", "#6A1B9A", "#01579B", "#004D40",
    "#B71C1C", "#4527A0", "#006064", "#E65100", "#1B5E20",
    "#37474F", "#795548",
  ];

  const DROP_HIGHLIGHT_SEL =
    ".cp-pool-zone, .cp-curator-new, .cp-zone-drop, .cp-curator-card";

  let api = null;
  /** @type {{ curators: { name: string, trainees: string[] }[] }} */
  let layout = { curators: [] };
  let selectedPerson = null;
  let dragSession = false;
  /** @type {{ chip: HTMLElement, name: string, from: string, startX: number, startY: number, dragging: boolean, ghost: HTMLElement|null, offsetX: number, offsetY: number, pointerId: number } | null} */
  let pointerState = null;
  let bound = false;

  function $(id) {
    return document.getElementById(id);
  }

  function canEdit() {
    return api && typeof api.canEdit === "function" && api.canEdit();
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

  function getSectionKey() {
    const sid = api.getSectionId();
    return sid === "pilot" || sid === "ust" ? sid : null;
  }

  function emptyBucket() {
    return { curators: [] };
  }

  function getMonthBucket(createIfMissing) {
    const mk = api.getMonthKey();
    if (!api.state.curatorPairingByMonth[mk]) {
      if (createIfMissing === false) return null;
      api.state.curatorPairingByMonth[mk] = {};
    }
    const month = api.state.curatorPairingByMonth[mk];
    const sid = getSectionKey();
    if (!sid) return null;
    if (!month[sid]) {
      if (createIfMissing === false) return null;
      month[sid] = emptyBucket();
    }
    return month[sid];
  }

  function mergeWithRoster(saved, roster) {
    const rosterSet = new Set(roster);
    const curators = [];
    const used = new Set();

    for (const c of saved?.curators || []) {
      const name = c?.name;
      if (!name || !rosterSet.has(name)) continue;
      const trainees = (c.trainees || []).filter((t) => rosterSet.has(t) && t !== name && !used.has(t));
      trainees.forEach((t) => used.add(t));
      used.add(name);
      curators.push({ name, trainees });
    }

    const pool = roster.filter((n) => !used.has(n));
    return { curators, pool };
  }

  function persistBucket() {
    const bucket = getMonthBucket(true);
    if (!bucket) return;
    bucket.curators = layout.curators.map((c) => ({
      name: c.name,
      trainees: [...c.trainees],
    }));
    api.persistLocal();
    api.scheduleRemotePersist();
  }

  function removePersonFromLayout(name) {
    layout.curators.forEach((c) => {
      if (c.name === name) return;
      c.trainees = c.trainees.filter((t) => t !== name);
    });
    layout.curators = layout.curators.filter((c) => c.name !== name);
  }

  function promoteToCurator(name) {
    removePersonFromLayout(name);
    layout.curators.push({ name, trainees: [] });
  }

  function addTrainee(curatorIndex, name) {
    removePersonFromLayout(name);
    const c = layout.curators[curatorIndex];
    if (!c || c.name === name) return;
    if (!c.trainees.includes(name)) c.trainees.push(name);
  }

  function movePerson(name, fromZone, toZone) {
    if (!canEdit() || !name || fromZone === toZone) return;

    if (toZone === "pool") {
      removePersonFromLayout(name);
      persistBucket();
      renderLayout();
      clearSelection();
      return;
    }

    if (toZone === "curator-new") {
      promoteToCurator(name);
      persistBucket();
      renderLayout();
      clearSelection();
      return;
    }

    const m = /^curator-(\d+)$/.exec(toZone);
    if (m) {
      addTrainee(Number(m[1]), name);
      persistBucket();
      renderLayout();
      clearSelection();
    }
  }

  function clearDragOverHighlights() {
    document.querySelectorAll(DROP_HIGHLIGHT_SEL + ".drag-over").forEach((el) => {
      el.classList.remove("drag-over");
    });
  }

  function parseDropZone(el) {
    if (!el) return null;
    const zoneEl = el.closest("[data-zone]");
    if (!zoneEl) return null;
    const key = zoneEl.dataset.zone;
    if (!key) return null;
    if (key === "pool" || key === "curator-new") return key;
    if (/^curator-\d+$/.test(key)) return key;
    return null;
  }

  function getDropZoneKeyAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return parseDropZone(el);
  }

  function highlightDropZone(clientX, clientY) {
    clearDragOverHighlights();
    const el = document.elementFromPoint(clientX, clientY);
    const zoneEl = el?.closest("[data-zone]");
    if (zoneEl) zoneEl.classList.add("drag-over");
  }

  function clearSelection() {
    selectedPerson = null;
    document.querySelectorAll("#curatorPairingSection .person-chip--selected").forEach((c) => {
      c.classList.remove("person-chip--selected");
    });
    $("curatorPairingSection")?.classList.remove("curator-pairing--pick-mode");
  }

  function selectPerson(name, from, chipEl) {
    clearSelection();
    selectedPerson = { name, from };
    chipEl.classList.add("person-chip--selected");
    $("curatorPairingSection")?.classList.add("curator-pairing--pick-mode");
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
    if (pointerState?.ghost) pointerState.ghost.remove();
    if (pointerState?.chip) pointerState.chip.classList.remove("dragging");
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
    if (chip.dataset.role === "curator") return;
    pointerState = {
      chip,
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
      if (toZone && toZone !== st.from) movePerson(st.name, st.from, toZone);
      cleanupPointerDrag();
      return;
    }
    cleanupPointerDrag();
    openAssignSheet(st.name, st.from);
  }

  function createChip(name, zone, role) {
    const chip = document.createElement("div");
    chip.className = "person-chip" + (role === "curator" ? " person-chip--curator" : "");
    chip.dataset.person = name;
    chip.dataset.zone = zone;
    if (role) chip.dataset.role = role;
    const avatar = document.createElement("div");
    avatar.className = "person-avatar";
    avatar.style.background = getAvatarColor(name);
    avatar.textContent = getInitials(name);
    chip.appendChild(avatar);
    chip.appendChild(document.createTextNode(name));
    if (canEdit() && role !== "curator") {
      chip.addEventListener("pointerdown", onChipPointerDown);
      chip.addEventListener("pointermove", onChipPointerMove);
      chip.addEventListener("pointerup", onChipPointerUp);
      chip.addEventListener("pointercancel", onChipPointerUp);
    } else {
      chip.classList.add("person-chip--readonly");
    }
    return chip;
  }

  function getCuratorZoneLabel(toZone) {
    if (toZone === "pool") return "Нераспределённые";
    if (toZone === "curator-new") return "Назначить куратором";
    const m = /^curator-(\d+)$/.exec(toZone);
    if (m) {
      const c = layout.curators[Number(m[1])];
      return c ? "К " + c.name : "Куратор";
    }
    return toZone;
  }

  function getCandidatesForZone(toZone) {
    const roster = api.getRosterNames();
    const merged = mergeWithRoster({ curators: layout.curators }, roster);
    if (toZone === "pool") {
      const list = [];
      merged.curators.forEach((c, i) => {
        list.push({ name: c.name, from: "curator-" + i, sub: "Куратор" });
        c.trainees.forEach((t) => {
          list.push({ name: t, from: "curator-" + i, sub: "Обучаемый" });
        });
      });
      return list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    }
    return merged.pool.map((name) => ({ name, from: "pool", sub: "нераспределён" }));
  }

  function bindZoneClickTargetsOnce() {
    if (bindZoneClickTargetsOnce.done) return;
    bindZoneClickTargetsOnce.done = true;
    const section = $("curatorPairingSection");
    if (!section) return;
    section.addEventListener("click", (e) => {
      if (!canEdit()) return;
      if (e.target.closest(".person-chip")) return;
      if (e.target.closest(".cp-remove-curator")) return;
      const zoneEl = e.target.closest("[data-zone]");
      if (!zoneEl || !section.contains(zoneEl)) return;
      const toZone = zoneEl.dataset.zone;
      if (!toZone) return;
      if (toZone.startsWith("curator-header")) return;
      if (selectedPerson) {
        if (toZone === selectedPerson.from) return;
        movePerson(selectedPerson.name, selectedPerson.from, toZone);
        return;
      }
      if (toZone === "pool" || toZone === "curator-new" || /^curator-\d+$/.test(toZone)) {
        openPersonPicker(toZone);
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAssignSheet();
    });
  }

  function renderCuratorCards() {
    const grid = $("cpCuratorsGrid");
    if (!grid) return;
    grid.innerHTML = "";
    layout.curators.forEach((c, i) => {
      const card = document.createElement("div");
      card.className = "cp-curator-card curator-card";
      card.innerHTML =
        '<div class="zone-header">' +
        '<span class="zone-title">Куратор</span>' +
        '<span class="curator-name" title="' +
        c.name.replace(/"/g, "&quot;") +
        '">' +
        c.name +
        "</span>" +
        '<span class="zone-badge" id="cpBadge-' +
        i +
        '">' +
        c.trainees.length +
        "</span>" +
        (canEdit()
          ? '<button type="button" class="cp-remove-curator" data-index="' +
            i +
            '" aria-label="Снять куратора">×</button>'
          : "") +
        "</div>" +
        '<div class="cp-zone-drop" id="cp-zone-' +
        i +
        '" data-zone="curator-' +
        i +
        '"></div>";
      grid.appendChild(card);
      const drop = $("cp-zone-" + i);
      if (!drop) return;
      if (c.trainees.length === 0) {
        const ph = document.createElement("span");
        ph.className = "zone-empty";
        ph.textContent = "Младшие инженеры";
        drop.appendChild(ph);
      } else {
        c.trainees.forEach((name) => {
          drop.appendChild(createChip(name, "curator-" + i, "trainee"));
        });
      }
      card.querySelector(".cp-remove-curator")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!canEdit()) return;
        const idx = Number(ev.currentTarget.dataset.index);
        const cur = layout.curators[idx];
        if (!cur) return;
        layout.curators.splice(idx, 1);
        persistBucket();
        renderLayout();
      });
    });
  }

  function renderPool(pool) {
    const poolEl = $("cpPool");
    if (!poolEl) return;
    poolEl.innerHTML = "";
    pool.forEach((name) => poolEl.appendChild(createChip(name, "pool", "pool")));
    const countEl = $("cpPoolCount");
    if (countEl) countEl.textContent = String(pool.length);
  }

  function renderLayout() {
    const roster = api.getRosterNames();
    const merged = mergeWithRoster({ curators: layout.curators }, roster);
    layout.curators = merged.curators;
    renderPool(merged.pool);
    renderCuratorCards();
    updateChrome();
  }

  function updateChrome() {
    const section = $("curatorPairingSection");
    if (section) section.classList.toggle("curator-pairing--readonly", !canEdit());
    const lockHint = $("curatorPairingLockHint");
    if (lockHint) {
      const msg = api.getLockHint ? api.getLockHint() : "";
      if (canEdit()) {
        lockHint.hidden = true;
        lockHint.textContent = "";
      } else {
        lockHint.hidden = false;
        lockHint.textContent =
          msg || "Чтобы менять пары куратор — обучаемый: войдите в систему.";
      }
    }
    const newZone = $("cpCuratorNew");
    if (newZone) newZone.hidden = !canEdit();
  }

  function resetPairing() {
    if (!canEdit()) return;
    layout = { curators: [] };
    persistBucket();
    renderLayout();
  }

  function formatTodayRu() {
    const t = new Date();
    const d = String(t.getDate()).padStart(2, "0");
    const m = String(t.getMonth() + 1).padStart(2, "0");
    return d + "." + m + "." + t.getFullYear();
  }

  async function copyPairing() {
    const roster = api.getRosterNames();
    const merged = mergeWithRoster({ curators: layout.curators }, roster);
    const objTitle = api.getSectionTitle ? api.getSectionTitle() : "";
    let text = "📅 " + formatTodayRu() + " | 👥 Кураторы и обучаемые";
    if (objTitle) text += " («" + objTitle + "»)";
    text += ":\n";
    let hasCurators = false;
    for (const c of merged.curators) {
      hasCurators = true;
      text += "\nКуратор " + c.name + ":\n";
      if (c.trainees.length) {
        for (const t of c.trainees) text += "  • " + t + "\n";
      } else {
        text += "  (нет обучаемых)\n";
      }
    }
    if (merged.pool.length) {
      text += "\nНераспределённые:\n";
      for (const n of merged.pool) text += "  • " + n + "\n";
    }
    if (!hasCurators && !merged.pool.length) {
      text += "\n(Нет сотрудников в составе)";
    } else if (!hasCurators) {
      text += "\n(Кураторы не назначены)";
    }
    try {
      await navigator.clipboard.writeText(text);
      const btn = $("cpBtnCopy");
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
      window.prompt("Скопируйте текст:", text);
    }
  }

  let sheetOverlay = null;

  function closeAssignSheet() {
    if (!sheetOverlay) return;
    sheetOverlay.classList.remove("open");
    document.body.style.overflow = "";
  }

  function createSheet() {
    if (sheetOverlay) return;
    sheetOverlay = document.createElement("div");
    sheetOverlay.className = "zone-sheet-overlay";
    sheetOverlay.id = "curatorSheetOverlay";
    sheetOverlay.innerHTML =
      '<div class="zone-sheet" id="curatorSheet">' +
      '<div class="zone-sheet-handle"></div>' +
      '<div class="zone-sheet-title" id="curatorSheetTitle">Назначить <span class="zone-sheet-person" id="curatorSheetPerson"></span></div>' +
      '<div class="zone-sheet-options" id="curatorSheetOptions"></div>' +
      '<button type="button" class="zone-sheet-cancel" id="curatorSheetCancel">Отмена</button>' +
      "</div>";
    document.body.appendChild(sheetOverlay);
    sheetOverlay.addEventListener("click", (e) => {
      if (e.target === sheetOverlay) closeAssignSheet();
    });
    $("curatorSheetCancel")?.addEventListener("click", closeAssignSheet);
  }

  function openPersonPicker(toZone) {
    if (!canEdit()) return;
    createSheet();
    const titleEl = $("curatorSheetTitle");
    if (titleEl) {
      titleEl.innerHTML =
        'Выберите сотрудника — <span class="zone-sheet-person">' +
        getCuratorZoneLabel(toZone).replace(/</g, "&lt;") +
        "</span>";
    }
    const optionsEl = $("curatorSheetOptions");
    if (!optionsEl) return;
    optionsEl.innerHTML = "";
    const candidates = getCandidatesForZone(toZone);
    if (!candidates.length) {
      const empty = document.createElement("p");
      empty.className = "zone-sheet-empty";
      empty.textContent =
        toZone === "pool" ? "Все в нераспределённых" : "Нет сотрудников для назначения";
      optionsEl.appendChild(empty);
    } else {
      for (const c of candidates) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "zone-sheet-person-btn";
        const avatar = document.createElement("div");
        avatar.className = "person-avatar";
        avatar.style.background = getAvatarColor(c.name);
        avatar.textContent = getInitials(c.name);
        const info = document.createElement("div");
        info.className = "zsb-info";
        const label = document.createElement("span");
        label.className = "zsb-label";
        label.textContent = c.name;
        info.appendChild(label);
        if (c.sub) {
          const sub = document.createElement("span");
          sub.className = "zsb-count";
          sub.textContent = c.sub;
          info.appendChild(sub);
        }
        btn.appendChild(avatar);
        btn.appendChild(info);
        btn.addEventListener("click", () => {
          movePerson(c.name, c.from, toZone);
          closeAssignSheet();
        });
        optionsEl.appendChild(btn);
      }
    }
    sheetOverlay.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function openAssignSheet(personName, fromZone) {
    if (!canEdit()) return;
    createSheet();
    const titleEl = $("curatorSheetTitle");
    if (titleEl) {
      titleEl.innerHTML =
        'Назначить <span class="zone-sheet-person" id="curatorSheetPerson"></span>';
    }
    $("curatorSheetPerson").textContent = personName;
    const optionsEl = $("curatorSheetOptions");
    if (!optionsEl) return;
    optionsEl.innerHTML = "";

    const addBtn = (label, sub, zoneKey, dotClass) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "zone-sheet-btn" + (zoneKey === fromZone ? " current" : "");
      btn.innerHTML =
        '<div class="zsb-dot ' +
        dotClass +
        '">+</div><div class="zsb-info"><span class="zsb-label">' +
        label +
        (zoneKey === fromZone ? " ← сейчас" : "") +
        '</span><span class="zsb-count">' +
        sub +
        "</span></div>";
      btn.addEventListener("click", () => {
        if (zoneKey !== fromZone) movePerson(personName, fromZone, zoneKey);
        closeAssignSheet();
      });
      optionsEl.appendChild(btn);
    };

    addBtn("Назначить куратором", "новая карточка", "curator-new", "zsb-dot-curator");
    addBtn("Нераспределённые", "общий пул", "pool", "zsb-dot-pool");
    layout.curators.forEach((c, i) => {
      const zone = "curator-" + i;
      addBtn("К " + c.name, c.trainees.length + " чел.", zone, "zsb-dot-trainee");
    });

    sheetOverlay.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function bindControlsOnce() {
    if (bound) return;
    bound = true;
    bindZoneClickTargetsOnce();
    $("cpBtnCopy")?.addEventListener("click", () => void copyPairing());
    $("cpBtnReset")?.addEventListener("click", resetPairing);
    createSheet();
  }

  function refresh() {
    if (!api || !$("curatorPairingSection")) return;
    if (dragSession) return;
    bindControlsOnce();
    const sectionEl = $("curatorPairingSection");
    const hint = $("curatorPairingHint");
    const sid = getSectionKey();
    if (!sid) {
      sectionEl.classList.add("curator-pairing--inactive");
      sectionEl.classList.remove("curator-pairing--empty");
      if (hint) {
        hint.textContent =
          "На вкладках «Усть-Луга» и «Пилотные проекты». На сводной вкладке блок недоступен.";
      }
      return;
    }
    sectionEl.classList.remove("curator-pairing--inactive");
    if (hint) {
      const title = api.getSectionTitle ? api.getSectionTitle() : sid;
      hint.textContent = canEdit()
        ? "Состав: «" +
          title +
          "». Перетащите или кликните по зоне — список сотрудников; клик по фамилии — выбор зоны."
        : "Состав: «" + title + "» — только просмотр.";
    }
    const bucket = getMonthBucket(true);
    if (!bucket) return;
    layout = {
      curators: (bucket.curators || []).map((c) => ({
        name: c.name,
        trainees: [...(c.trainees || [])],
      })),
    };
    const roster = api.getRosterNames();
    const merged = mergeWithRoster({ curators: layout.curators }, roster);
    layout.curators = merged.curators;
    bucket.curators = merged.curators.map((c) => ({
      name: c.name,
      trainees: [...c.trainees],
    }));
    renderLayout();
    const empty = roster.length === 0;
    sectionEl.classList.toggle("curator-pairing--empty", empty);
  }

  function init(workWatchApi) {
    api = workWatchApi;
    refresh();
  }

  window.WorkWatchCuratorPairing = { init, refresh };
})();
