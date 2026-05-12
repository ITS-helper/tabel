/**
 * WORK WATCH — прототип графика (автономный, без сборки)
 */

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

/**
 * Легенда — как в Google Таблице «График работы на объектах».
 * Колонка «СПГ» / «СПГ.» — табель объекта Усть-Луга (не путать с ИНК и др.).
 */
const LEGEND = [
  { code: "ОТ", label: "Отпуск", bg: "#e9d5ff", fg: "#6b21a8" },
  { code: "ВХ", label: "Выходной", bg: "#fecaca", fg: "#991b1b" },
  { code: "Б", label: "Больничный", bg: "#fed7aa", fg: "#9a3412" },
  { code: "БЛ", label: "Больничный лист", bg: "#ddd6fe", fg: "#5b21b6" },
  { code: "ВП", label: "В пути", bg: "#fce7f3", fg: "#9d174d" },
  { code: "-", label: "Отсутствует", bg: "#e2e8f0", fg: "#64748b" },
  { code: "О", label: "Офис (МСК)", bg: "#dbeafe", fg: "#1e40af" },
  { code: "УР", label: "Удалённая работа", bg: "#bfdbfe", fg: "#1e3a8a" },
  { code: "СПГ", label: "ВСМ (Усть-Луга) СПГ", bg: "#7dd3fc", fg: "#0c4a6e" },
  { code: "СПГ.", label: "ВСМ (Усть-Луга) СПГ Ночь", bg: "#0284c7", fg: "#f0f9ff" },
  { code: "М", label: "Магнит", bg: "#fb923c", fg: "#7c2d12" },
  { code: "АПК", label: "Продовольственная программа (РМ АГРО)", bg: "#cffafe", fg: "#155e75" },
  { code: "ГАЛС", label: 'ООО "Галс-Девелопмент"', bg: "#f9a8d4", fg: "#831843" },
  { code: "ЗЛ", label: 'ТК "ЗЕЛЕНАЯ ЛИНИЯ"', bg: "#bbf7d0", fg: "#166534" },
  { code: "ИНК", label: "Иркутская нефтяная компания", bg: "#a5b4fc", fg: "#312e81" },
];

const CODE_ORDER = LEGEND.map((l) => l.code);

/** Учитываются в строке «Всего на смене» (объекты / выезд, без отпуска и офиса) */
const ON_SHIFT_CODES = new Set([
  "СПГ",
  "СПГ.",
  "ИНК",
  "УР",
  "ГАЛС",
  "М",
  "АПК",
  "ЗЛ",
]);

/** Визуальная пустая ячейка (нет отметки в табеле; в «на смене» не входит) */
const EMPTY_MARK = "\u2014";

const SECTIONS = [
  { id: "ust", title: "Усть-Луга" },
  { id: "pilot", title: "Пилотные проекты" },
  { id: "summary", title: "Сводная" },
];

/** По умолчанию эти ФИО отнесены к пилотным проектам (переопределяется в «Объекты и состав») */
const DEFAULT_PILOT_NAMES = new Set([
  "Подгорбунских Иван Леонидович",
  "Погорелец Мария Анатольевна",
  "Трефилов Алексей Павлович",
  "Штепа Илья Вадимович",
]);

const STORAGE_SECTION_ASSIGN = "ww-section-overrides";
const STORAGE_SECTION_TITLES = "ww-section-titles";

function loadSectionAssignOverrides() {
  try {
    const r = localStorage.getItem(STORAGE_SECTION_ASSIGN);
    if (!r) return {};
    const o = JSON.parse(r);
    const out = {};
    for (const k of Object.keys(o)) {
      if (o[k] === "pilot" || o[k] === "ust") out[k] = o[k];
    }
    return out;
  } catch (_) {
    return {};
  }
}

function loadSectionTitleOverrides() {
  try {
    const r = localStorage.getItem(STORAGE_SECTION_TITLES);
    if (!r) return {};
    const o = JSON.parse(r);
    const out = {};
    if (typeof o.ust === "string") out.ust = o.ust;
    if (typeof o.pilot === "string") out.pilot = o.pilot;
    return out;
  } catch (_) {
    return {};
  }
}

function defaultSectionForName(name) {
  return DEFAULT_PILOT_NAMES.has(name) ? "pilot" : "ust";
}

/** Должности по таблицам заказчика */
const POSITION_BY_NAME = {
  "Бурангулов Руслан Азаматович": "Руководитель проекта",
  "Беккер Александр Анатольевич": "Инженер по внедрению",
  "Гаджиев Ильгар Бахтиярович": "Старший инженер по внедрению",
  "Зацепин Никита Валериевич": "Старший инженер по внедрению",
  "Магомедов Султан Абдурахманович": "Младший инженер по внедрению",
  "Аюшеев Дандар Дамбаевич": "Младший инженер по внедрению",
  "Смирнов Павел Александрович": "Младший инженер по внедрению",
  "Окунев Александр Игоревич": "Младший инженер по внедрению",
  "Устян Авенир Григорьевич": "Младший инженер по внедрению",
  "Вишневский Сергей Арсенович": "Младший инженер по внедрению",
  "Газизуллин Рустам Дамирович": "Младший инженер по внедрению",
  "Савчук Руслан Ростиславович": "Младший инженер по внедрению",
  "Жарков Александр Владиславович": "Младший инженер по внедрению",
  "Зуев Леонид Олегович": "Младший инженер по внедрению",
  "Шуйский Иван Андреевич": "Инженер по внедрению",
  "Бондарь Роман Альбертович": "Младший инженер по внедрению",
  "Кумейко Николай Александрович": "Инженер по внедрению",
  "Доркин Филипп Александрович": "Младший инженер по внедрению",
  "Мищенко Егор Александрович": "Руководитель проектов",
  "Бердников Александр Львович": "Старший инженер по внедрению",
  "Сергеев Тимофей Ильич": "Координатор внедрения",
  "Трубаев Никита Васильевич": "Инженер по внедрению",
  "Одиноков Александр Евгеньевич": "Инженер по внедрению",
  "Насыров Максим Тимурович": "Старший инженер по внедрению",
  "Подгорбунских Иван Леонидович": "Руководитель проекта",
  "Погорелец Мария Анатольевна":
    "Координатор проектов по повышению производительности труда",
  "Трефилов Алексей Павлович": "Младший инженер по внедрению",
  "Штепа Илья Вадимович": "Младший инженер по внедрению",
};

const UST_NAME_ORDER = [
  "Бурангулов Руслан Азаматович",
  "Беккер Александр Анатольевич",
  "Гаджиев Ильгар Бахтиярович",
  "Зацепин Никита Валериевич",
  "Магомедов Султан Абдурахманович",
  "Аюшеев Дандар Дамбаевич",
  "Смирнов Павел Александрович",
  "Окунев Александр Игоревич",
  "Устян Авенир Григорьевич",
  "Вишневский Сергей Арсенович",
  "Газизуллин Рустам Дамирович",
  "Савчук Руслан Ростиславович",
  "Жарков Александр Владиславович",
  "Зуев Леонид Олегович",
  "Шуйский Иван Андреевич",
  "Бондарь Роман Альбертович",
  "Кумейко Николай Александрович",
  "Доркин Филипп Александрович",
  "Мищенко Егор Александрович",
  "Бердников Александр Львович",
  "Сергеев Тимофей Ильич",
  "Трубаев Никита Васильевич",
  "Одиноков Александр Евгеньевич",
  "Насыров Максим Тимурович",
  "Ивахненко Сергей Игоревич",
  "Червяков Сергей Андреевич",
  "Тучин Сергей Геннадьевич",
];

const PILOT_NAME_ORDER = [
  "Подгорбунских Иван Леонидович",
  "Погорелец Мария Анатольевна",
  "Трефилов Алексей Павлович",
  "Штепа Илья Вадимович",
];

function sectionIdForEmployee(name) {
  const o = state.sectionAssignOverrides[name];
  if (o === "pilot" || o === "ust") return o;
  return defaultSectionForName(name);
}

function persistSectionAssignOverrides() {
  try {
    localStorage.setItem(STORAGE_SECTION_ASSIGN, JSON.stringify(state.sectionAssignOverrides));
  } catch (_) {}
}

function persistSectionTitleOverrides() {
  try {
    localStorage.setItem(STORAGE_SECTION_TITLES, JSON.stringify(state.sectionTitleOverrides));
  } catch (_) {}
}

/** Отображаемое название вкладки объекта (с учётом переименования в браузере) */
function sectionTabTitle(id) {
  const sec = SECTIONS.find((s) => s.id === id);
  const def = sec ? sec.title : id;
  if (id !== "ust" && id !== "pilot") return def;
  const o = state.sectionTitleOverrides[id];
  if (o != null && String(o).trim() !== "") return String(o).trim();
  return def;
}

function setEmployeeSection(name, sectionId) {
  if (sectionId !== "pilot" && sectionId !== "ust") return;
  if (defaultSectionForName(name) === sectionId) delete state.sectionAssignOverrides[name];
  else state.sectionAssignOverrides[name] = sectionId;
  persistSectionAssignOverrides();
  render();
}

function resetSectionAssignOverrides() {
  state.sectionAssignOverrides = {};
  persistSectionAssignOverrides();
  render();
}

function resetSectionTitleOverrides() {
  state.sectionTitleOverrides = {};
  persistSectionTitleOverrides();
  fillTeamDialogTitleInputs();
  buildSectionNav();
  syncCurrentSectionTitle();
  refreshTeamAssignSelectLabels();
}

function syncCurrentSectionTitle() {
  const cur = SECTIONS.find((s) => s.id === state.sectionId);
  const te = document.getElementById("currentSectionTitle");
  if (cur && te) te.textContent = sectionTabTitle(state.sectionId);
}

function refreshTeamAssignSelectLabels() {
  const tbody = document.getElementById("teamAssignBody");
  if (!tbody) return;
  tbody.querySelectorAll("select.team-dialog__select").forEach((sel) => {
    sel.querySelectorAll("option").forEach((opt) => {
      opt.textContent = sectionTabTitle(opt.value);
    });
  });
}

function fillTeamDialogTitleInputs() {
  const ustEl = document.getElementById("titleUstInput");
  const pilEl = document.getElementById("titlePilotInput");
  if (!ustEl || !pilEl) return;
  ustEl.value = sectionTabTitle("ust");
  pilEl.value = sectionTabTitle("pilot");
}

function applyTitleInput(kind, rawValue) {
  const v = String(rawValue).trim();
  const defRow = SECTIONS.find((s) => s.id === kind);
  const defTitle = defRow ? defRow.title : "";
  if (!v || v === defTitle) delete state.sectionTitleOverrides[kind];
  else state.sectionTitleOverrides[kind] = v;
  persistSectionTitleOverrides();
  const inputEl = document.getElementById(kind === "ust" ? "titleUstInput" : "titlePilotInput");
  if (inputEl && (!v || v === defTitle)) inputEl.value = sectionTabTitle(kind);
  refreshTeamAssignSelectLabels();
  buildSectionNav();
  syncCurrentSectionTitle();
}

function populateTeamAssignTable() {
  const data = getDataset();
  const tbody = document.getElementById("teamAssignBody");
  if (!data || !tbody) return;
  tbody.innerHTML = "";
  const sorted = [...data.employees].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  sorted.forEach((emp) => {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = emp.name;
    const tdSel = document.createElement("td");
    const sel = document.createElement("select");
    sel.className = "select team-dialog__select";
    ["ust", "pilot"].forEach((sid) => {
      const opt = document.createElement("option");
      opt.value = sid;
      opt.textContent = sectionTabTitle(sid);
      if (sid === sectionIdForEmployee(emp.name)) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => setEmployeeSection(emp.name, sel.value));
    tdSel.appendChild(sel);
    tr.appendChild(tdName);
    tr.appendChild(tdSel);
    tbody.appendChild(tr);
  });
}

function openTeamDialog() {
  const data = getDataset();
  if (!data || !data.employees.length) {
    alert("Нет списка сотрудников для выбранного месяца.");
    return;
  }
  fillTeamDialogTitleInputs();
  populateTeamAssignTable();
  const dlg = document.getElementById("teamDialog");
  if (dlg) dlg.showModal();
}

function bindTeamDialog() {
  const dlg = document.getElementById("teamDialog");
  const btn = document.getElementById("teamDialogBtn");
  const done = document.getElementById("teamDialogDone");
  const dismiss = document.getElementById("teamDialogDismiss");
  const resetAssign = document.getElementById("teamAssignReset");
  const resetTitles = document.getElementById("teamTitlesReset");
  const ustIn = document.getElementById("titleUstInput");
  const pilIn = document.getElementById("titlePilotInput");

  if (btn) btn.addEventListener("click", () => openTeamDialog());
  if (done)
    done.addEventListener("click", () => {
      if (dlg) dlg.close();
    });
  if (dismiss)
    dismiss.addEventListener("click", () => {
      if (dlg) dlg.close();
    });
  if (resetAssign)
    resetAssign.addEventListener("click", () => {
      if (!confirm("Сбросить состав команд к значениям по умолчанию?")) return;
      resetSectionAssignOverrides();
      populateTeamAssignTable();
    });
  if (resetTitles)
    resetTitles.addEventListener("click", () => {
      if (confirm("Сбросить названия вкладок к умолчанию?")) resetSectionTitleOverrides();
    });
  if (ustIn)
    ustIn.addEventListener("input", () => {
      applyTitleInput("ust", ustIn.value);
    });
  if (pilIn)
    pilIn.addEventListener("input", () => {
      applyTitleInput("pilot", pilIn.value);
    });
}

function sortEmployeesForSection(rows, sectionId) {
  const order = sectionId === "pilot" ? PILOT_NAME_ORDER : UST_NAME_ORDER;
  const idx = new Map(order.map((n, i) => [n, i]));
  return [...rows].sort((a, b) => {
    const ia = idx.has(a.name) ? idx.get(a.name) : 10000;
    const ib = idx.has(b.name) ? idx.get(b.name) : 10000;
    if (ia !== ib) return ia - ib;
    return a.name.localeCompare(b.name, "ru");
  });
}

/** Сотрудники вкладки: Усть-Луга / пилоты / сводная (оба списка подряд) */
function employeesForSection(employees, sectionId) {
  if (sectionId === "summary") {
    const ust = employees.filter((e) => sectionIdForEmployee(e.name) === "ust");
    const pilot = employees.filter((e) => sectionIdForEmployee(e.name) === "pilot");
    return [
      ...sortEmployeesForSection(ust, "ust"),
      ...sortEmployeesForSection(pilot, "pilot"),
    ];
  }
  return sortEmployeesForSection(
    employees.filter((e) => sectionIdForEmployee(e.name) === sectionId),
    sectionId
  );
}

/**
 * Демо-данные по месяцам: ключ "YYYY-M"
 * schedule: день месяца → код из легенды или "" (пусто)
 */
const DATABASE = {
  "2026-5": {
    vacationsOut: [],
    vacationsIn: [],
    /** Данные из выгрузки Google Таблицы (scripts/parsed-employees-may.js) */
    employees: typeof PARSED_EMPLOYEES_MAY !== "undefined" ? PARSED_EMPLOYEES_MAY : [],
  },
  "2026-6": {
    vacationsOut: [{ name: "Петров Д.О.", daysLeft: 8, start: "18.06.2026", duration: 10 }],
    vacationsIn: [{ name: "Соколов А.В.", daysLeft: 4, date: "14.06.2026" }],
    employees: [],
  },
};

function pad(n) {
  return String(n).padStart(2, "0");
}

function weekdayShortRu(year, monthIndex, day) {
  const d = new Date(year, monthIndex, day).getDay();
  const names = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  return names[d];
}

/** Ширины закреплённых колонок (px) — должны совпадать с --sched-w-* в styles.css */
const STICKY_WIDTH_PX = {
  tn: 68,
  name: 232,
  pos: 148,
  days: 88,
};

const STICKY_ORDER = ["tn", "name", "pos", "days"];

const STICKY_LABEL = {
  tn: "ТН",
  name: "ФИО",
  pos: "Должность",
  days: "Дн. вахты",
};

const STICKY_CELL_CLASS = {
  tn: "schedule__tn",
  name: "schedule__name",
  pos: "schedule__pos",
  days: "schedule__days-h",
};

const STICKY_Z_BASE = { thead: 25, body: 12, foot: 16 };

function loadStickyVisibility() {
  const def = { tn: true, name: true, pos: true, days: true };
  let v = { ...def };
  try {
    const raw = localStorage.getItem("ww-sticky-cols");
    if (raw) v = { ...def, ...JSON.parse(raw) };
  } catch (_) {}
  if (!v.tn && !v.name) v.name = true;
  if (!localStorage.getItem("ww-sticky-cols") && localStorage.getItem("ww-col-position") === "0") {
    v.pos = false;
  }
  return v;
}

/** Левые координаты закрепления и порядок видимых столбцов */
function computeStickyLayout(vis) {
  let x = 0;
  const left = {};
  const visibleKeys = [];
  STICKY_ORDER.forEach((key) => {
    if (!vis[key]) return;
    left[key] = x;
    visibleKeys.push(key);
    x += STICKY_WIDTH_PX[key];
  });
  return { left, visibleKeys, totalWidth: x };
}

function applyStickyGeometry(el, slot, section, leftPx) {
  el.style.left = `${leftPx}px`;
  el.style.zIndex = String(STICKY_Z_BASE[section] + slot);
}

function hideStickyCol(key) {
  const v = { ...state.stickyVisibility };
  if (!v[key]) return;
  v[key] = false;
  if (!v.tn && !v.name) return;
  state.stickyVisibility = v;
  persistStickyVisibility();
  render();
}

function showStickyCol(key) {
  state.stickyVisibility[key] = true;
  persistStickyVisibility();
  render();
}

function injectScheduleColgroup(table, dayCount, vis) {
  table.querySelectorAll("colgroup").forEach((el) => el.remove());
  const cg = document.createElement("colgroup");
  const addCol = (cls) => {
    const col = document.createElement("col");
    col.className = cls;
    cg.appendChild(col);
  };
  if (vis.tn) addCol("col-tn");
  if (vis.name) addCol("col-name");
  if (vis.pos) addCol("col-pos");
  if (vis.days) addCol("col-days");
  for (let i = 0; i < dayCount; i++) addCol("schedule-col-day");
  table.insertBefore(cg, table.firstChild);
}

function renderHiddenColumnsBar() {
  const bar = document.getElementById("hiddenColumnsBar");
  if (!bar) return;
  const hidden = STICKY_ORDER.filter((k) => !state.stickyVisibility[k]);
  if (hidden.length === 0) {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }
  bar.hidden = false;
  bar.innerHTML = "";
  const title = document.createElement("span");
  title.className = "hidden-cols__title";
  title.textContent = "Скрытые столбцы:";
  bar.appendChild(title);
  hidden.forEach((key) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hidden-cols__btn";
    btn.textContent = `${STICKY_LABEL[key]} +`;
    btn.title = `Показать столбец «${STICKY_LABEL[key]}»`;
    btn.addEventListener("click", () => showStickyCol(key));
    bar.appendChild(btn);
  });
}

function monthKey(year, monthIndex) {
  return `${year}-${monthIndex + 1}`;
}

function parseMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return { year: y, monthIndex: m - 1 };
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getLegendStyle(code) {
  const item = LEGEND.find((l) => l.code === code);
  if (!item) return { bg: "#e5e7eb", fg: "#6b7280" };
  return { bg: item.bg, fg: item.fg };
}

function isWeekend(year, monthIndex, day) {
  const dow = new Date(year, monthIndex, day).getDay();
  return dow === 0 || dow === 6;
}

function cycleCode(current) {
  if (!current) return CODE_ORDER[0];
  const idx = CODE_ORDER.indexOf(current);
  if (idx === -1) return CODE_ORDER[0];
  if (idx === CODE_ORDER.length - 1) return "";
  return CODE_ORDER[idx + 1];
}

const STORAGE_UI_BLOCKS = "ww-ui-blocks";

function loadUiBlocks() {
  try {
    const r = localStorage.getItem(STORAGE_UI_BLOCKS);
    if (!r) return { legend: true, vacations: true };
    const o = JSON.parse(r);
    return {
      legend: o.legend !== false,
      vacations: o.vacations !== false,
    };
  } catch (_) {
    return { legend: true, vacations: true };
  }
}

let state = {
  monthKey: "2026-5",
  sectionId: "ust",
  mode: "view",
  theme: localStorage.getItem("ww-theme") || "light",
  /** Видимость закреплённых столбцов (дни месяца не относятся сюда) */
  stickyVisibility: loadStickyVisibility(),
  /** Фильтр табеля по коду легенды (null — все сотрудники) */
  legendFilterCode: null,
  /** копия расписаний для редактирования */
  scheduleOverrides: null,
  /** Переназначение объекта (ФИО → ust | pilot), только отличия от DEFAULT_PILOT_NAMES */
  sectionAssignOverrides: loadSectionAssignOverrides(),
  /** Переименование вкладок ust / pilot */
  sectionTitleOverrides: loadSectionTitleOverrides(),
  /** Легенда / отпуска: true = панель развёрнута (localStorage ww-ui-blocks) */
  uiBlocks: loadUiBlocks(),
};

function persistStickyVisibility() {
  localStorage.setItem("ww-sticky-cols", JSON.stringify(state.stickyVisibility));
}

function persistUiBlocks() {
  try {
    localStorage.setItem(STORAGE_UI_BLOCKS, JSON.stringify(state.uiBlocks));
  } catch (_) {}
}

/** Состояние панелей: true = развёрнуто (как чекбоксы «показать» раньше) */
function syncCollapsiblePanels() {
  const legSec = document.getElementById("legendSection");
  const vacSec = document.getElementById("vacationCardsSection");
  const legBtn = document.getElementById("legendPanelToggle");
  const vacBtn = document.getElementById("vacationPanelToggle");
  if (legSec) legSec.classList.toggle("open", state.uiBlocks.legend);
  if (vacSec) vacSec.classList.toggle("open", state.uiBlocks.vacations);
  if (legBtn) legBtn.setAttribute("aria-expanded", state.uiBlocks.legend ? "true" : "false");
  if (vacBtn) vacBtn.setAttribute("aria-expanded", state.uiBlocks.vacations ? "true" : "false");
}

function bindCollapsiblePanels() {
  const legBtn = document.getElementById("legendPanelToggle");
  const vacBtn = document.getElementById("vacationPanelToggle");
  if (legBtn) {
    legBtn.addEventListener("click", () => {
      state.uiBlocks.legend = !state.uiBlocks.legend;
      persistUiBlocks();
      syncCollapsiblePanels();
    });
  }
  if (vacBtn) {
    vacBtn.addEventListener("click", () => {
      state.uiBlocks.vacations = !state.uiBlocks.vacations;
      persistUiBlocks();
      syncCollapsiblePanels();
    });
  }
}

function getDataset() {
  const base = DATABASE[state.monthKey];
  if (!base) return null;
  const overrides = state.scheduleOverrides;
  const employees = base.employees.map((emp, i) => {
    let e = emp;
    if (overrides && overrides[i]) {
      e = { ...emp, schedule: { ...emp.schedule, ...overrides[i] } };
    }
    const pos = POSITION_BY_NAME[e.name];
    if (pos != null && String(pos).trim() !== "") {
      e = { ...e, position: pos };
    }
    return e;
  });
  return { ...base, employees };
}

function init() {
  applyTheme(state.theme);
  buildMonthSelect();
  buildSectionNav();
  bindControls();
  bindStickyTableClick();
  bindTeamDialog();
  bindCollapsiblePanels();
  syncCollapsiblePanels();
  render();
}

/** Клик по заголовку закреплённого столбца — скрыть (−) */
function bindStickyTableClick() {
  const table = document.getElementById("scheduleTable");
  if (!table || table.dataset.stickyBound) return;
  table.dataset.stickyBound = "1";
  table.addEventListener("click", (e) => {
    const th = e.target.closest("thead [data-sticky-key]");
    if (!th) return;
    e.preventDefault();
    hideStickyCol(th.dataset.stickyKey);
  });
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
  localStorage.setItem("ww-theme", theme);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
}

function buildMonthSelect() {
  const sel = document.getElementById("monthSelect");
  sel.innerHTML = "";
  for (let m = 0; m < 12; m++) {
    const key = monthKey(2026, m);
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${MONTH_NAMES[m]} 2026`;
    if (key === state.monthKey) opt.selected = true;
    sel.appendChild(opt);
  }
}

function buildSectionNav() {
  const ul = document.getElementById("sectionNav");
  ul.innerHTML = "";
  SECTIONS.forEach((sec) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = sectionTabTitle(sec.id);
    btn.dataset.section = sec.id;
    if (sec.id === state.sectionId) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      state.sectionId = sec.id;
      state.scheduleOverrides = null;
      state.legendFilterCode = null;
      ul.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b.dataset.section === sec.id));
      document.getElementById("currentSectionTitle").textContent = sectionTabTitle(sec.id);
      render();
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
  const cur = SECTIONS.find((s) => s.id === state.sectionId);
  const titleEl = document.getElementById("currentSectionTitle");
  if (cur && titleEl) titleEl.textContent = sectionTabTitle(state.sectionId);
}

function employeeHasLegendCodeInMonth(emp, code, dim) {
  for (let d = 1; d <= dim; d++) {
    if ((emp.schedule[d] ?? "") === code) return true;
  }
  return false;
}

/** Сотрудники вкладки с учётом фильтра легенды */
function getFilteredEmployeesForView(data) {
  const { year, monthIndex } = parseMonthKey(state.monthKey);
  const dim = daysInMonth(year, monthIndex);
  const baseRows = employeesForSection(data.employees, state.sectionId);
  const total = baseRows.length;
  const code = state.legendFilterCode;
  const rows = code
    ? baseRows.filter((emp) => employeeHasLegendCodeInMonth(emp, code, dim))
    : baseRows;
  return { rows, total, dim };
}

function syncLegendChrome() {
  const clearBtn = document.getElementById("legendClearBtn");
  if (clearBtn) clearBtn.hidden = !state.legendFilterCode;
}

function buildLegend() {
  const list = document.getElementById("legendList");
  if (!list) return;
  list.innerHTML = "";
  list.setAttribute("role", "list");
  LEGEND.forEach((item) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "legend-chip";
    if (state.legendFilterCode === item.code) chip.classList.add("legend-chip--active");
    chip.setAttribute("role", "listitem");
    chip.dataset.legendCode = item.code;
    chip.title = `${item.label}. Нажмите, чтобы отфильтровать табель; ещё раз — снять фильтр.`;
    chip.setAttribute("aria-pressed", state.legendFilterCode === item.code ? "true" : "false");
    chip.innerHTML = `
      <span class="legend-chip__dot" style="background:${item.bg};border:1px solid ${item.fg}40" aria-hidden="true"></span>
      <span class="legend-chip__code">${item.code}</span>
      <span class="legend-chip__name">${item.label}</span>`;
    chip.addEventListener("click", () => {
      state.legendFilterCode =
        state.legendFilterCode === item.code ? null : item.code;
      render();
    });
    list.appendChild(chip);
  });
  syncLegendChrome();
}

function bindControls() {
  document.getElementById("monthSelect").addEventListener("change", (e) => {
    state.monthKey = e.target.value;
    state.scheduleOverrides = null;
    state.legendFilterCode = null;
    render();
  });

  document.getElementById("themeToggle").addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });

  document.querySelectorAll(".segmented__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      document.querySelectorAll(".segmented__btn").forEach((b) => b.classList.toggle("is-active", b.dataset.mode === state.mode));
      document.body.dataset.mode = state.mode;
      render();
    });
  });
  document.body.dataset.mode = state.mode;

  document.getElementById("exportBtn").addEventListener("click", exportFor1C);

  document.getElementById("archiveBtn").addEventListener("click", () => {
    alert("Демо: раздел «Архив» можно подключить к API или статическим архивным наборам.");
  });

  const legendClear = document.getElementById("legendClearBtn");
  if (legendClear) {
    legendClear.addEventListener("click", () => {
      state.legendFilterCode = null;
      render();
    });
  }

}

function renderVacationCards(data) {
  const outEl = document.getElementById("vacationOut");
  const inEl = document.getElementById("vacationIn");
  outEl.innerHTML = "";
  inEl.innerHTML = "";

  if (!data.vacationsOut?.length) {
    outEl.innerHTML = '<li class="card__empty">Нет записей на выбранный месяц</li>';
  } else {
    data.vacationsOut.forEach((v) => {
      const li = document.createElement("li");
      li.className = "card__item";
      li.innerHTML = `
        <strong>${v.name}</strong>
        <span>${v.daysLeft} дн.</span>
        <span class="card__meta">Старт ${v.start}, ${v.duration} календ. дн.</span>
      `;
      outEl.appendChild(li);
    });
  }

  if (!data.vacationsIn?.length) {
    inEl.innerHTML = '<li class="card__empty">Нет записей на выбранный месяц</li>';
  } else {
    data.vacationsIn.forEach((v) => {
      const li = document.createElement("li");
      li.className = "card__item";
      li.innerHTML = `
        <strong>${v.name}</strong>
        <span>${v.daysLeft} дн.</span>
        <span class="card__meta">Возврат ${v.date}</span>
      `;
      inEl.appendChild(li);
    });
  }
}

function stickyCellValue(emp, key) {
  if (key === "tn") return emp.tn;
  if (key === "name") return emp.name;
  if (key === "pos") {
    const p = emp.position;
    return p != null && String(p).trim() !== "" ? String(p).trim() : EMPTY_MARK;
  }
  return String(emp.daysOnShift);
}

function renderSchedule(data) {
  const { year, monthIndex } = parseMonthKey(state.monthKey);
  const dim = daysInMonth(year, monthIndex);
  const table = document.getElementById("scheduleTable");
  const head = document.getElementById("scheduleHead");
  const body = document.getElementById("scheduleBody");
  const foot = document.getElementById("scheduleFoot");
  const vis = state.stickyVisibility;
  const layout = computeStickyLayout(vis);
  if (layout.visibleKeys.length === 0) {
    state.stickyVisibility = { tn: true, name: true, pos: true, days: true };
    persistStickyVisibility();
    render();
    return;
  }

  head.innerHTML = "";
  body.innerHTML = "";
  foot.innerHTML = "";
  injectScheduleColgroup(table, dim, vis);

  const fullEmployees = data.employees;
  const { rows: employees, total: totalEmployees } = getFilteredEmployeesForView(data);
  const badge = document.getElementById("employeeCount");
  if (state.legendFilterCode) {
    badge.textContent = `${employees.length} из ${totalEmployees} сотр.`;
    badge.title = `Фильтр по отметке «${state.legendFilterCode}»`;
  } else {
    badge.textContent = `${employees.length} сотр.`;
    badge.removeAttribute("title");
  }

  const headerRow = document.createElement("tr");
  const keys = layout.visibleKeys;
  const lastKey = keys[keys.length - 1];

  keys.forEach((key, slot) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.dataset.stickyKey = key;
    th.className = `sticky-col sticky-${key} ${STICKY_CELL_CLASS[key]} sticky-th-toggle`;
    if (slot === 0) th.classList.add("schedule__corner");
    th.innerHTML = `
      <span class="sticky-th__main">${STICKY_LABEL[key]}</span><span class="sticky-th__hint" aria-hidden="true">\u2212</span>`;
    th.title = `Скрыть столбец «${STICKY_LABEL[key]}»`;
    applyStickyGeometry(th, slot, "thead", layout.left[key]);
    if (key === lastKey) th.classList.add("sticky-col--edge");
    headerRow.appendChild(th);
  });

  for (let day = 1; day <= dim; day++) {
    const w = isWeekend(year, monthIndex, day);
    const th = document.createElement("th");
    th.scope = "col";
    th.className = `${w ? "weekend " : ""}schedule-day-th`.trim();
    const wd = weekdayShortRu(year, monthIndex, day);
    th.innerHTML = `
      <span class="schedule-day-head">
        <span class="schedule-day-head__d">${pad(day)}.${pad(monthIndex + 1)}</span>
        <span class="schedule-day-head__w">${wd}</span>
      </span>`;
    th.setAttribute(
      "aria-label",
      `${day} ${MONTH_NAMES[monthIndex]} ${year}, ${wd}`
    );
    headerRow.appendChild(th);
  }
  head.appendChild(headerRow);

  const onShiftCount = {};
  for (let day = 1; day <= dim; day++) onShiftCount[day] = 0;

  employees.forEach((emp) => {
    const rowIndex = fullEmployees.indexOf(emp);
    const tr = document.createElement("tr");
    keys.forEach((key, slot) => {
      const cell = slot === 0 ? document.createElement("th") : document.createElement("td");
      if (slot === 0) cell.scope = "row";
      cell.className = `sticky-col sticky-${key} ${STICKY_CELL_CLASS[key]}`;
      cell.textContent = stickyCellValue(emp, key);
      applyStickyGeometry(cell, slot, "body", layout.left[key]);
      if (key === lastKey) cell.classList.add("sticky-col--edge");
      tr.appendChild(cell);
    });

    for (let day = 1; day <= dim; day++) {
      const w = isWeekend(year, monthIndex, day);
      const code = emp.schedule[day] ?? "";
      const td = document.createElement("td");
      td.className = w ? "weekend" : "";
      const pill = document.createElement("span");
      pill.className = "pill" + (code ? "" : " pill--empty");
      if (code) {
        pill.textContent = code;
        const st = getLegendStyle(code);
        pill.style.background = st.bg;
        pill.style.color = st.fg;
        pill.setAttribute("aria-label", `Отметка ${code}`);
      } else {
        pill.textContent = EMPTY_MARK;
        pill.setAttribute("aria-label", "Нет отметки");
      }
      if (ON_SHIFT_CODES.has(code)) onShiftCount[day] += 1;

      pill.dataset.row = String(rowIndex); /* индекс в полном списке — для правок и overrides */
      pill.dataset.day = String(day);
      pill.title = code ? `Код: ${code}` : "Нет отметки — клик в режиме редактирования";
      pill.addEventListener("click", () => onPillClick(rowIndex, day, pill));

      td.appendChild(pill);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  });

  const footRow = document.createElement("tr");
  const fk = keys[0];
  const thFoot = document.createElement("th");
  thFoot.scope = "row";
  thFoot.className = `sticky-col sticky-${fk} footer-label ${STICKY_CELL_CLASS[fk]}`;
  thFoot.textContent = "Всего на смене";
  applyStickyGeometry(thFoot, 0, "foot", layout.left[fk]);
  if (fk === lastKey) thFoot.classList.add("sticky-col--edge");
  footRow.appendChild(thFoot);

  for (let i = 1; i < keys.length; i++) {
    const key = keys[i];
    const padCell = document.createElement("td");
    padCell.className = `sticky-col sticky-${key} schedule__meta-empty`;
    padCell.setAttribute("aria-hidden", "true");
    padCell.innerHTML = "&nbsp;";
    applyStickyGeometry(padCell, i, "foot", layout.left[key]);
    if (key === lastKey) padCell.classList.add("sticky-col--edge");
    footRow.appendChild(padCell);
  }

  for (let day = 1; day <= dim; day++) {
    const w = isWeekend(year, monthIndex, day);
    const td = document.createElement("td");
    td.className = `${w ? "weekend " : ""}sticky-footer-num`.trim();
    td.textContent = String(onShiftCount[day]);
    td.setAttribute("aria-label", `На смене ${onShiftCount[day]} чел.`);
    footRow.appendChild(td);
  }
  foot.appendChild(footRow);
}

function onPillClick(rowIndex, day, pillEl) {
  if (state.mode !== "edit") return;
  const data = getDataset();
  if (!data) return;
  const current = data.employees[rowIndex].schedule[day] ?? "";
  const next = cycleCode(current);

  if (!state.scheduleOverrides) state.scheduleOverrides = {};
  if (!state.scheduleOverrides[rowIndex]) state.scheduleOverrides[rowIndex] = {};
  state.scheduleOverrides[rowIndex][day] = next;

  if (next) {
    pillEl.textContent = next;
    pillEl.className = "pill";
    const st = getLegendStyle(next);
    pillEl.style.background = st.bg;
    pillEl.style.color = st.fg;
    pillEl.setAttribute("aria-label", `Отметка ${next}`);
    pillEl.title = `Код: ${next}`;
  } else {
    pillEl.textContent = EMPTY_MARK;
    pillEl.className = "pill pill--empty";
    pillEl.style.background = "";
    pillEl.style.color = "";
    pillEl.setAttribute("aria-label", "Нет отметки");
    pillEl.title = "Нет отметки — клик в режиме редактирования";
  }
  updateFooterTotals();
}

function updateFooterTotals() {
  const data = getDataset();
  if (!data) return;
  const { year, monthIndex } = parseMonthKey(state.monthKey);
  const dim = daysInMonth(year, monthIndex);
  const onShiftCount = {};
  for (let day = 1; day <= dim; day++) onShiftCount[day] = 0;

  const { rows } = getFilteredEmployeesForView(data);
  rows.forEach((emp) => {
    for (let day = 1; day <= dim; day++) {
      const code = emp.schedule[day] ?? "";
      if (ON_SHIFT_CODES.has(code)) onShiftCount[day] += 1;
    }
  });

  const footRow = document.querySelector("#scheduleFoot tr");
  if (!footRow) return;
  const cells = footRow.querySelectorAll("td.sticky-footer-num");
  cells.forEach((td, i) => {
    const day = i + 1;
    if (day <= dim) {
      const n = onShiftCount[day];
      td.textContent = String(n);
      td.setAttribute("aria-label", `На смене ${n} чел.`);
    }
  });
}

function render() {
  buildLegend();
  const data = getDataset();
  document.getElementById("yearLabel").textContent = "2026";

  if (!data || !data.employees.length) {
    const tbl = document.getElementById("scheduleTable");
    tbl.querySelectorAll("colgroup").forEach((el) => el.remove());
    document.getElementById("vacationOut").innerHTML = "";
    document.getElementById("vacationIn").innerHTML = "";
    const msg =
      "Нет данных для этого месяца — выберите май или июнь 2026 либо добавьте записи в app.js.";
    document.getElementById("scheduleBody").innerHTML = `<tr><td colspan="99" style="padding:24px;text-align:center;color:var(--muted)">${msg}</td></tr>`;
    document.getElementById("scheduleHead").innerHTML = "";
    document.getElementById("scheduleFoot").innerHTML = "";
    document.getElementById("employeeCount").textContent = "0 сотр.";
    renderHiddenColumnsBar();
    syncLegendChrome();
    return;
  }

  const { rows: filteredRows } = getFilteredEmployeesForView(data);
  if (state.legendFilterCode && filteredRows.length === 0) {
    renderVacationCards(data);
    const tbl = document.getElementById("scheduleTable");
    tbl.querySelectorAll("colgroup").forEach((el) => el.remove());
    document.getElementById("scheduleHead").innerHTML = "";
    document.getElementById("scheduleBody").innerHTML = `<tr><td colspan="99" style="padding:24px;text-align:center;color:var(--muted)">В этом месяце ни у кого нет отметки «${state.legendFilterCode}». Выберите другой код или нажмите «Показать всех».</td></tr>`;
    document.getElementById("scheduleFoot").innerHTML = "";
    document.getElementById("employeeCount").textContent = `0 из ${employeesForSection(data.employees, state.sectionId).length} сотр.`;
    renderHiddenColumnsBar();
    syncLegendChrome();
    return;
  }

  renderVacationCards(data);
  renderSchedule(data);
  renderHiddenColumnsBar();
  syncLegendChrome();
}

function exportFor1C() {
  const data = getDataset();
  if (!data) {
    alert("Нет данных для экспорта.");
    return;
  }
  const { year, monthIndex } = parseMonthKey(state.monthKey);
  const { rows } = getFilteredEmployeesForView(data);
  const payload = {
    generatedAt: new Date().toISOString(),
    period: { year, month: monthIndex + 1 },
    section: state.sectionId,
    legendFilter: state.legendFilterCode,
    employees: rows.map((e) => ({
      tn: e.tn,
      name: e.name,
      position: e.position,
      daysOnShift: e.daysOnShift,
      schedule: e.schedule,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `workwatch-export-${state.monthKey}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Для демо: июнь = те же люди, график по дням 1–30 как в мае */
function ensureJunePlaceholder() {
  const june = DATABASE["2026-6"];
  if (june.employees.length === 0 && DATABASE["2026-5"]) {
    june.employees = DATABASE["2026-5"].employees.map((emp) => {
      const schedule = {};
      for (let d = 1; d <= 30; d++) {
        schedule[d] = emp.schedule[d] ?? "";
      }
      return { ...emp, schedule };
    });
  }
}

ensureJunePlaceholder();
init();
