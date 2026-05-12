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
 * Коды отметок (как в Google Таблице «График работы на объектах»).
 * Панель «Объекты» — множественный фильтр по этим кодам.
 * «СПГ» / «СПГ.» — табель объекта Усть-Луга (не путать с ИНК и др.).
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

/** Нет ни одного дня «на смене» (те же коды, что в строке «Всего на смене») — в табеле не показываем */
function employeeHasNoShiftsInMonth(emp, dim) {
  for (let d = 1; d <= dim; d++) {
    const c = emp.schedule[d] ?? "";
    if (ON_SHIFT_CODES.has(c)) return false;
  }
  return true;
}

const SECTIONS = [
  { id: "ust", title: "Усть-Луга" },
  { id: "pilot", title: "Пилотные проекты" },
  { id: "summary", title: "Сводная" },
];

/** По умолчанию эти ФИО отнесены к пилотным проектам (переопределяется в «Объекты и состав») */
const DEFAULT_PILOT_NAMES = new Set([
  "Мищенко Егор Александрович",
  "Бердников Александр Львович",
  "Сергеев Тимофей Ильич",
  "Трубаев Никита Васильевич",
  "Одиноков Александр Евгеньевич",
  "Насыров Максим Тимурович",
]);

const STORAGE_SECTION_ASSIGN = "ww-section-overrides";
const STORAGE_SECTION_TITLES = "ww-section-titles";
/** Сессия браузера: после ввода пароля режим редактирования доступен до закрытия вкладки */
const STORAGE_EDIT_SESSION = "ww-edit-session";
const EDIT_PASSWORD = "2323";

/** Supabase: общая синхронизация (см. supabase-schema.sql в репозитории) */
const SUPABASE_URL = "https://owcuvcshwtivqueftiuk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_zMRDhywx67zYK6SLGAyg-A_4KXV_Ujc";
const TABEL_STATE_ROW_ID = "global";
const STORAGE_SCHEDULE_BY_MONTH = "ww-schedule-by-month";
const STORAGE_ROSTER_EXTRAS = "ww-roster-extras";
const STORAGE_LEGEND_INCLUDE_NO_SHIFTS = "ww-legend-include-no-shifts";
const SUPABASE_PUSH_DEBOUNCE_MS = 900;

let supabasePushTimer = null;

function loadLegendIncludeNoShifts() {
  try {
    return localStorage.getItem(STORAGE_LEGEND_INCLUDE_NO_SHIFTS) === "1";
  } catch (_) {
    return false;
  }
}

function persistLegendIncludeNoShifts() {
  try {
    localStorage.setItem(STORAGE_LEGEND_INCLUDE_NO_SHIFTS, state.legendIncludeNoShifts ? "1" : "0");
  } catch (_) {}
}

let scheduleCellPickerEl = null;
let scheduleCellPickerDocFn = null;
let scheduleCellPickerKeyFn = null;

/** Левый клик + протягивание по дням — копировать отметку как в Excel */
const PILL_FILL_DRAG_THRESHOLD_PX = 6;
let pillFillInteraction = null;

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
    let fixed = false;
    for (const key of ["ust", "pilot"]) {
      if (typeof out[key] === "string" && out[key].trim().toLowerCase() === "admin") {
        delete out[key];
        fixed = true;
      }
    }
    if (fixed) {
      try {
        localStorage.setItem(STORAGE_SECTION_TITLES, JSON.stringify(out));
      } catch (_) {}
    }
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
  "Подгорбунских Иван Леонидович",
  "Погорелец Мария Анатольевна",
  "Трефилов Алексей Павлович",
  "Штепа Илья Вадимович",
  "Ивахненко Сергей Игоревич",
  "Червяков Сергей Андреевич",
  "Тучин Сергей Геннадьевич",
];

const PILOT_NAME_ORDER = [
  "Мищенко Егор Александрович",
  "Бердников Александр Львович",
  "Сергеев Тимофей Ильич",
  "Трубаев Никита Васильевич",
  "Одиноков Александр Евгеньевич",
  "Насыров Максим Тимурович",
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
  scheduleRemotePersistDebounced();
  render();
}

function resetSectionAssignOverrides() {
  state.sectionAssignOverrides = {};
  persistSectionAssignOverrides();
  scheduleRemotePersistDebounced();
  render();
}

function resetSectionTitleOverrides() {
  state.sectionTitleOverrides = {};
  persistSectionTitleOverrides();
  scheduleRemotePersistDebounced();
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
  scheduleRemotePersistDebounced();
  const inputEl = document.getElementById(kind === "ust" ? "titleUstInput" : "titlePilotInput");
  if (inputEl && (!v || v === defTitle)) inputEl.value = sectionTabTitle(kind);
  refreshTeamAssignSelectLabels();
  buildSectionNav();
  syncCurrentSectionTitle();
}

function rosterFieldBucketForMonth(monthKey) {
  if (!state.employeeFieldOverridesByMonth[monthKey]) state.employeeFieldOverridesByMonth[monthKey] = {};
  return state.employeeFieldOverridesByMonth[monthKey];
}

function updateBaseEmployeeFieldsFromDialog(empName, tn, position) {
  const mk = state.monthKey;
  const b = rosterFieldBucketForMonth(mk);
  b[empName] = { ...(b[empName] || {}), tn, position };
  persistRosterExtrasLocal();
  scheduleRemotePersistDebounced();
  render();
}

function updateAddedEmployeeFieldsFromDialog(empName, tn, position) {
  const mk = state.monthKey;
  const list = state.addedEmployeesByMonth[mk];
  if (!list) return;
  const i = list.findIndex((a) => a.name === empName);
  if (i < 0) return;
  list[i] = { ...list[i], tn: String(tn).trim(), position: String(position).trim() };
  persistRosterExtrasLocal();
  scheduleRemotePersistDebounced();
  render();
}

function handleAddEmployeeClick() {
  if (state.mode !== "edit" || !isEditSessionUnlocked()) return;
  const tnEl = document.getElementById("teamAddTn");
  const nameEl = document.getElementById("teamAddName");
  const posEl = document.getElementById("teamAddPos");
  const secEl = document.getElementById("teamAddSection");
  const tn = tnEl ? tnEl.value.trim() : "";
  const name = nameEl ? nameEl.value.trim() : "";
  const position = posEl ? posEl.value.trim() : "";
  const sectionId = secEl && (secEl.value === "pilot" || secEl.value === "ust") ? secEl.value : "ust";
  if (!name) {
    alert("Введите ФИО.");
    return;
  }
  const data = getDataset();
  if (!data) return;
  const lower = name.toLowerCase();
  if (data.employees.some((e) => String(e.name).trim().toLowerCase() === lower)) {
    alert("Сотрудник с таким ФИО уже есть в списке.");
    return;
  }
  const mk = state.monthKey;
  if (!state.addedEmployeesByMonth[mk]) state.addedEmployeesByMonth[mk] = [];
  state.addedEmployeesByMonth[mk].push({
    tn,
    name,
    position,
    daysOnShift: 0,
    schedule: {},
  });
  persistRosterExtrasLocal();
  scheduleRemotePersistDebounced();
  setEmployeeSection(name, sectionId);
  if (tnEl) tnEl.value = "";
  if (nameEl) nameEl.value = "";
  if (posEl) posEl.value = "";
  populateTeamAssignTable();
}

function populateTeamAssignTable() {
  const data = getDataset();
  const tbody = document.getElementById("teamAssignBody");
  const addPanel = document.getElementById("teamRosterAddPanel");
  if (!data || !tbody) return;
  tbody.innerHTML = "";
  const sorted = [...data.employees].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const monthKey = state.monthKey;
  const addedList = state.addedEmployeesByMonth[monthKey] || [];
  const addedNames = new Set(addedList.map((a) => a.name));
  const canEditPeople = state.mode === "edit" && isEditSessionUnlocked();
  if (addPanel) addPanel.hidden = !canEditPeople;
  const secAdd = document.getElementById("teamAddSection");
  if (secAdd) {
    secAdd.querySelectorAll("option").forEach((opt) => {
      if (opt.value === "ust" || opt.value === "pilot") opt.textContent = sectionTabTitle(opt.value);
    });
  }
  sorted.forEach((emp) => {
    const isAdded = addedNames.has(emp.name);
    const tr = document.createElement("tr");
    tr.dataset.empName = emp.name;
    tr.dataset.addedRow = isAdded ? "1" : "";

    const tdTn = document.createElement("td");
    if (canEditPeople) {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "input team-dialog__cell-input";
      inp.value = emp.tn ?? "";
      inp.maxLength = 32;
      inp.autocomplete = "off";
      inp.addEventListener("change", () => {
        const posInp = tr.querySelector('input[data-field="position"]');
        const posVal = posInp ? posInp.value : emp.position ?? "";
        if (isAdded) updateAddedEmployeeFieldsFromDialog(emp.name, inp.value, posVal);
        else updateBaseEmployeeFieldsFromDialog(emp.name, inp.value, posVal);
      });
      tdTn.appendChild(inp);
    } else {
      tdTn.textContent = emp.tn ?? "";
    }

    const tdName = document.createElement("td");
    tdName.textContent = emp.name;

    const tdPos = document.createElement("td");
    if (canEditPeople) {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "input team-dialog__cell-input";
      inp.dataset.field = "position";
      inp.value = emp.position ?? "";
      inp.maxLength = 160;
      inp.autocomplete = "off";
      inp.addEventListener("change", () => {
        const tnInp = tr.querySelector("td:first-child input");
        const tnVal = tnInp ? tnInp.value : emp.tn ?? "";
        if (isAdded) updateAddedEmployeeFieldsFromDialog(emp.name, tnVal, inp.value);
        else updateBaseEmployeeFieldsFromDialog(emp.name, tnVal, inp.value);
      });
      tdPos.appendChild(inp);
    } else {
      tdPos.textContent = emp.position != null && String(emp.position).trim() !== "" ? String(emp.position) : "";
    }

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
    sel.disabled = !canEditPeople;
    sel.addEventListener("change", () => setEmployeeSection(emp.name, sel.value));
    tdSel.appendChild(sel);

    tr.appendChild(tdTn);
    tr.appendChild(tdName);
    tr.appendChild(tdPos);
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
  const ustIn = document.getElementById("titleUstInput");
  const pilIn = document.getElementById("titlePilotInput");
  if (ustIn) ustIn.removeAttribute("readonly");
  if (pilIn) pilIn.removeAttribute("readonly");
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

  if (btn) btn.addEventListener("click", () => openTeamDialog());
  if (done)
    done.addEventListener("click", () => {
      const u = document.getElementById("titleUstInput");
      const p = document.getElementById("titlePilotInput");
      if (u) applyTitleInput("ust", u.value);
      if (p) applyTitleInput("pilot", p.value);
      if (dlg) dlg.close();
    });
  if (dismiss)
    dismiss.addEventListener("click", () => {
      if (dlg) dlg.close();
    });
  if (dlg) {
    dlg.addEventListener("close", () => {
      const u = document.getElementById("titleUstInput");
      const p = document.getElementById("titlePilotInput");
      fillTeamDialogTitleInputs();
      if (u) u.setAttribute("readonly", "");
      if (p) p.setAttribute("readonly", "");
    });
  }
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
  const addEmpBtn = document.getElementById("teamAddEmployeeBtn");
  if (addEmpBtn) addEmpBtn.addEventListener("click", () => handleAddEmployeeClick());
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
    vacationsOut: [],
    vacationsIn: [],
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

function injectScheduleColgroup(table, dayCount, vis, todayDay) {
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
  for (let d = 1; d <= dayCount; d++) {
    const col = document.createElement("col");
    col.className = "schedule-col-day" + (todayDay === d ? " schedule-col-day--today" : "");
    cg.appendChild(col);
  }
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

/** Коды дня в графике для отпуска: «В пути» — первый и последний день, между — «ОТ» (LEGEND). */
const VACATION_OT = "ОТ";
const VACATION_TRAVEL = "ВП";

function formatRuDate(year, monthIndex, day) {
  return `${pad(day)}.${pad(monthIndex + 1)}.${year}`;
}

function dayScheduleCode(schedule, day) {
  return String(schedule[day] ?? "").trim();
}

/**
 * По объединённому графику: отпуск — непрерывная цепочка ВП и/или ОТ с хотя бы одним ОТ
 * (типично ВП — выезд, ОТ — дни отпуска, ВП — возвращение). Начало периода — первый день цепочки,
 * конец — последний. Возврат на работу — первый день после цепочки, если он в этом месяце.
 * Цепочка только из ОТ (без ВП в выгрузке) тоже учитывается.
 */
function computeVacationSummaryFromSchedules(data, year, monthIndex) {
  const dim = daysInMonth(year, monthIndex);
  const departures = [];
  const returns = [];
  const emps = data?.employees;
  if (!Array.isArray(emps) || emps.length === 0) {
    return { departures, returns };
  }

  for (const emp of emps) {
    const schedule = emp.schedule || {};
    const isTravelOrOT = (day) => {
      const c = dayScheduleCode(schedule, day);
      return c === VACATION_OT || c === VACATION_TRAVEL;
    };
    const segmentHasOT = (start, end) => {
      for (let x = start; x <= end; x++) {
        if (dayScheduleCode(schedule, x) === VACATION_OT) return true;
      }
      return false;
    };

    let d = 1;
    while (d <= dim) {
      while (d <= dim && !isTravelOrOT(d)) d++;
      if (d > dim) break;
      const start = d;
      while (d <= dim && isTravelOrOT(d)) d++;
      const end = d - 1;
      if (!segmentHasOT(start, end)) continue;

      const prevWasPart = start > 1 && isTravelOrOT(start - 1);
      if (!prevWasPart) {
        const nDays = end - start + 1;
        departures.push({
          name: emp.name,
          tn: emp.tn,
          startDay: start,
          endDay: end,
          startLabel: formatRuDate(year, monthIndex, start),
          endLabel: formatRuDate(year, monthIndex, end),
          nDays,
        });
      }

      if (d <= dim && !isTravelOrOT(d)) {
        returns.push({
          name: emp.name,
          tn: emp.tn,
          returnDay: d,
          dateLabel: formatRuDate(year, monthIndex, d),
        });
      }
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name, "ru");
  departures.sort((a, b) => a.startDay - b.startDay || byName(a, b));
  returns.sort((a, b) => a.returnDay - b.returnDay || byName(a, b));
  return { departures, returns };
}

/**
 * Число месяца для столбца «сегодня», если в графике открыт тот же календарный месяц, что и у системной даты.
 * Год в табеле может отличаться (в данных часто один год, например 2026) — совпадение года не требуется.
 * 29 февраля при невисокосном феврале в графике — последний день месяца.
 */
function viewMonthTodayDayNumber(year, monthIndex) {
  const n = new Date();
  if (n.getMonth() !== monthIndex) return null;
  const dim = daysInMonth(year, monthIndex);
  const d = Math.min(n.getDate(), dim);
  if (d < 1) return null;
  return d;
}

/** Один раз на выбранный месяц: прокрутить горизонтальный скролл к колонке «сегодня» */
let scheduleScrollToTodayAppliedForMonthKey = null;

function queueScheduleScrollToTodayColumn() {
  const { year, monthIndex } = parseMonthKey(state.monthKey);
  const todayD = viewMonthTodayDayNumber(year, monthIndex);
  if (todayD == null) return;
  if (scheduleScrollToTodayAppliedForMonthKey === state.monthKey) return;
  scheduleScrollToTodayAppliedForMonthKey = state.monthKey;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const th = document.querySelector(`#scheduleHead th.schedule-day-th[data-schedule-day="${todayD}"]`);
      if (!th) return;
      th.scrollIntoView({ block: "nearest", inline: "center" });
    });
  });
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

const STORAGE_UI_BLOCKS = "ww-ui-blocks";

function isEditSessionUnlocked() {
  try {
    return sessionStorage.getItem(STORAGE_EDIT_SESSION) === "1";
  } catch (_) {
    return false;
  }
}

function unlockEditSession() {
  try {
    sessionStorage.setItem(STORAGE_EDIT_SESSION, "1");
  } catch (_) {}
}

function applyMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".segmented__btn").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.mode === state.mode)
  );
  document.body.dataset.mode = state.mode;
  if (mode === "view") closeScheduleCellPicker();
  render();
}

function bindEditPasswordDialog() {
  const dlg = document.getElementById("editPwdDialog");
  const inp = document.getElementById("editPwdInput");
  const ok = document.getElementById("editPwdOk");
  const cancel = document.getElementById("editPwdCancel");
  const err = document.getElementById("editPwdErr");
  if (!dlg || !inp || !ok || !cancel || !err) return;

  const hideErr = () => {
    err.hidden = true;
    err.textContent = "";
  };

  const trySubmit = () => {
    hideErr();
    if (inp.value === EDIT_PASSWORD) {
      unlockEditSession();
      dlg.close();
      inp.value = "";
      applyMode("edit");
    } else {
      err.textContent = "Неверный пароль.";
      err.hidden = false;
      inp.select();
    }
  };

  ok.addEventListener("click", trySubmit);
  cancel.addEventListener("click", () => {
    hideErr();
    inp.value = "";
    dlg.close();
  });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      trySubmit();
    }
  });
  dlg.addEventListener("close", () => {
    hideErr();
    inp.value = "";
  });
}

function openEditPasswordDialog() {
  const dlg = document.getElementById("editPwdDialog");
  const inp = document.getElementById("editPwdInput");
  const err = document.getElementById("editPwdErr");
  if (!dlg || !inp) return;
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
  inp.value = "";
  if (typeof dlg.showModal === "function") dlg.showModal();
  else alert("Обновите браузер: нужна поддержка диалога для ввода пароля.");
  setTimeout(() => inp.focus(), 0);
}

function ensureScheduleCellPicker() {
  if (scheduleCellPickerEl) return scheduleCellPickerEl;
  const el = document.createElement("select");
  el.className = "schedule-cell-picker";
  el.hidden = true;
  el.setAttribute("aria-label", "Отметка объекта");
  document.body.appendChild(el);
  scheduleCellPickerEl = el;
  return el;
}

function closeScheduleCellPicker() {
  const el = scheduleCellPickerEl;
  if (!el || el.hidden) return;
  el.hidden = true;
  el.onchange = null;
  if (scheduleCellPickerDocFn) {
    document.removeEventListener("mousedown", scheduleCellPickerDocFn, true);
    scheduleCellPickerDocFn = null;
  }
  if (scheduleCellPickerKeyFn) {
    document.removeEventListener("keydown", scheduleCellPickerKeyFn, true);
    scheduleCellPickerKeyFn = null;
  }
}

function openScheduleCellPicker(rowIndex, day, pillEl) {
  if (state.mode !== "edit" || !isEditSessionUnlocked()) return;
  const data = getDataset();
  if (!data) return;
  closeScheduleCellPicker();
  const sel = ensureScheduleCellPicker();
  sel.innerHTML = "";
  const oEmpty = document.createElement("option");
  oEmpty.value = "";
  oEmpty.textContent = "— пусто";
  sel.appendChild(oEmpty);
  for (const item of LEGEND) {
    const o = document.createElement("option");
    o.value = item.code;
    o.textContent = `${item.code} — ${item.label}`;
    sel.appendChild(o);
  }
  const current = data.employees[rowIndex].schedule[day] ?? "";
  sel.value = LEGEND.some((l) => l.code === current) ? current : "";

  const r = pillEl.getBoundingClientRect();
  const pad = 4;
  const w = Math.max(220, Math.min(Math.max(r.width, 240), 320));
  let left = r.left;
  let top = r.bottom + pad;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  if (left < 8) left = 8;
  const estH = 200;
  if (top + estH > window.innerHeight - 8) top = Math.max(8, r.top - estH - pad);
  sel.style.left = `${left}px`;
  sel.style.top = `${top}px`;
  sel.style.width = `${w}px`;
  sel.dataset.rowIndex = String(rowIndex);
  sel.dataset.day = String(day);
  sel._pillEl = pillEl;
  sel.hidden = false;

  scheduleCellPickerKeyFn = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeScheduleCellPicker();
    }
  };
  document.addEventListener("keydown", scheduleCellPickerKeyFn, true);

  setTimeout(() => {
    scheduleCellPickerDocFn = (e) => {
      if (e.target === sel || sel.contains(e.target)) return;
      closeScheduleCellPicker();
    };
    document.addEventListener("mousedown", scheduleCellPickerDocFn, true);
  }, 0);

  sel.onchange = () => {
    const next = sel.value;
    const ri = Number(sel.dataset.rowIndex, 10);
    const d = Number(sel.dataset.day, 10);
    applyScheduleCellValue(ri, d, next, sel._pillEl);
    closeScheduleCellPicker();
  };

  requestAnimationFrame(() => {
    sel.focus();
    if (typeof sel.showPicker === "function") {
      try {
        sel.showPicker();
      } catch (_) {}
    }
  });
}

function applyScheduleCellValue(rowIndex, day, next, pillEl) {
  if (!pillEl) return;
  const bucket = scheduleOverridesBucket();
  if (!bucket[rowIndex]) bucket[rowIndex] = {};
  bucket[rowIndex][day] = next;

  if (next) {
    pillEl.textContent = next;
    pillEl.className = "pill";
    const st = getLegendStyle(next);
    pillEl.style.background = st.bg;
    pillEl.style.color = st.fg;
    pillEl.setAttribute("aria-label", `Отметка ${next}`);
    pillEl.title = "Код: " + next + ". Клик — список; тяните — копировать на дни";
  } else {
    pillEl.textContent = EMPTY_MARK;
    pillEl.className = "pill pill--empty";
    pillEl.style.background = "";
    pillEl.style.color = "";
    pillEl.setAttribute("aria-label", "Нет отметки");
    pillEl.title = "Клик — список; тяните — очистить диапазон";
  }
  persistScheduleByMonthLocal();
  scheduleRemotePersistDebounced();
  updateFooterTotals();
}

function pillUnderPoint(clientX, clientY) {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    if (node.nodeType !== 1) continue;
    const el = node.classList.contains("pill") ? node : node.closest(".pill");
    if (el && el.dataset.row != null && el.dataset.day != null) return el;
  }
  return null;
}

function clearFillDragPreview() {
  document.querySelectorAll(".pill--fill-range").forEach((p) => p.classList.remove("pill--fill-range"));
  document.querySelectorAll(".schedule-td--fill-range").forEach((td) => td.classList.remove("schedule-td--fill-range"));
  document.querySelectorAll(".schedule-tr--fill-active").forEach((tr) => tr.classList.remove("schedule-tr--fill-active"));
  updateFillDragHint(null);
}

function updateFillDragPreview() {
  clearFillDragPreview();
  const pi = pillFillInteraction;
  if (!pi || !pi.dragging) return;
  const lo = Math.min(pi.day0, pi.day1);
  const hi = Math.max(pi.day0, pi.day1);
  const row = String(pi.rowIndex);
  let trEl = null;
  document.querySelectorAll(`#scheduleBody .pill[data-row="${row}"]`).forEach((pill) => {
    const d = Number(pill.dataset.day, 10);
    if (!Number.isNaN(d) && d >= lo && d <= hi) {
      pill.classList.add("pill--fill-range");
      const td = pill.closest("td");
      if (td) {
        td.classList.add("schedule-td--fill-range");
        if (!trEl) trEl = td.closest("tr");
      }
    }
  });
  if (trEl) trEl.classList.add("schedule-tr--fill-active");
  updateFillDragHint(pi);
}

let scheduleFillHintEl = null;

function ensureScheduleFillHintEl() {
  if (scheduleFillHintEl) return scheduleFillHintEl;
  const el = document.createElement("div");
  el.id = "scheduleFillHint";
  el.className = "schedule-fill-hint";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.hidden = true;
  document.body.appendChild(el);
  scheduleFillHintEl = el;
  return el;
}

/** Подсказка внизу экрана: что копируется и диапазон дней */
function updateFillDragHint(pi) {
  const el = ensureScheduleFillHintEl();
  if (!pi || !pi.dragging) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  const lo = Math.min(pi.day0, pi.day1);
  const hi = Math.max(pi.day0, pi.day1);
  const val = pi.code ? `«${pi.code}»` : "пустую ячейку";
  el.textContent =
    lo === hi
      ? `Протягивание: ${val} — день ${lo}. Ведите в сторону, чтобы охватить несколько дней. Отпустите — применить.`
      : `Протягивание: ${val} — дни ${lo}–${hi}. Отпустите кнопку мыши — применить.`;
  el.hidden = false;
}

function cancelPillFillInteraction() {
  if (!pillFillInteraction) return;
  document.removeEventListener("pointermove", pillFillInteraction.onMove);
  document.removeEventListener("pointerup", pillFillInteraction.onUp);
  document.removeEventListener("pointercancel", pillFillInteraction.onUp);
  document.body.classList.remove("pill-fill-dragging");
  clearFillDragPreview();
  pillFillInteraction = null;
}

function applyScheduleRowDayRange(rowIndex, dayA, dayB, code) {
  const data = getDataset();
  if (!data || rowIndex < 0 || rowIndex >= data.employees.length) return;
  const { year, monthIndex } = parseMonthKey(state.monthKey);
  const dim = daysInMonth(year, monthIndex);
  const lo = Math.max(1, Math.min(Math.min(dayA, dayB), dim));
  const hi = Math.min(dim, Math.max(Math.max(dayA, dayB), 1));
  const bucket = scheduleOverridesBucket();
  if (!bucket[rowIndex]) bucket[rowIndex] = {};
  for (let d = lo; d <= hi; d++) {
    bucket[rowIndex][d] = code;
  }
  persistScheduleByMonthLocal();
  scheduleRemotePersistDebounced();
  render();
}

function startPillFillInteraction(ev, rowIndex, day, pillEl) {
  if (state.mode !== "edit" || !isEditSessionUnlocked()) return;
  if (ev.button !== 0) return;
  const data = getDataset();
  if (!data) return;
  if (pillFillInteraction) cancelPillFillInteraction();

  const code = data.employees[rowIndex].schedule[day] ?? "";

  const onMove = (e) => {
    if (!pillFillInteraction) return;
    const pi = pillFillInteraction;
    const dx = e.clientX - pi.startX;
    const dy = e.clientY - pi.startY;
    if (!pi.dragging && dx * dx + dy * dy >= PILL_FILL_DRAG_THRESHOLD_PX * PILL_FILL_DRAG_THRESHOLD_PX) {
      pi.dragging = true;
      document.body.classList.add("pill-fill-dragging");
      closeScheduleCellPicker();
      updateFillDragPreview();
    }
    if (!pi.dragging) return;
    const p = pillUnderPoint(e.clientX, e.clientY);
    if (p && p.dataset.row === String(pi.rowIndex)) {
      const d = Number(p.dataset.day, 10);
      if (!Number.isNaN(d) && pi.day1 !== d) {
        pi.day1 = d;
        updateFillDragPreview();
      }
    }
  };

  const onUp = () => {
    if (!pillFillInteraction) return;
    const pi = pillFillInteraction;
    cancelPillFillInteraction();
    if (pi.dragging) {
      applyScheduleRowDayRange(pi.rowIndex, pi.day0, pi.day1, pi.code);
    } else {
      openScheduleCellPicker(pi.rowIndex, pi.day0, pi.pillEl);
    }
  };

  pillFillInteraction = {
    rowIndex,
    day0: day,
    day1: day,
    code,
    startX: ev.clientX,
    startY: ev.clientY,
    dragging: false,
    pillEl,
    onMove,
    onUp,
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
  ev.preventDefault();
}

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

function loadScheduleByMonthFromLocal() {
  try {
    const r = localStorage.getItem(STORAGE_SCHEDULE_BY_MONTH);
    if (!r) return {};
    const o = JSON.parse(r);
    return typeof o === "object" && o !== null && !Array.isArray(o) ? o : {};
  } catch (_) {
    return {};
  }
}

function loadRosterExtrasFromLocal() {
  try {
    const r = localStorage.getItem(STORAGE_ROSTER_EXTRAS);
    if (!r) return { employeeFieldOverridesByMonth: {}, addedEmployeesByMonth: {} };
    const o = JSON.parse(r);
    return {
      employeeFieldOverridesByMonth:
        typeof o.employeeFieldOverridesByMonth === "object" && o.employeeFieldOverridesByMonth != null
          ? o.employeeFieldOverridesByMonth
          : {},
      addedEmployeesByMonth:
        typeof o.addedEmployeesByMonth === "object" && o.addedEmployeesByMonth != null
          ? o.addedEmployeesByMonth
          : {},
    };
  } catch (_) {
    return { employeeFieldOverridesByMonth: {}, addedEmployeesByMonth: {} };
  }
}

const _rosterInit = loadRosterExtrasFromLocal();

let state = {
  monthKey: "2026-5",
  sectionId: "ust",
  mode: "view",
  theme: localStorage.getItem("ww-theme") || "light",
  /** Видимость закреплённых столбцов (дни месяца не относятся сюда) */
  stickyVisibility: loadStickyVisibility(),
  /** Фильтр табеля: набор кодов отметок (пусто — все сотрудники; OR по выбранным) */
  legendFilterCodes: new Set(),
  /** Показывать всех по вкладке, в т.ч. без смен на объектах в этом месяце */
  legendIncludeNoShifts: loadLegendIncludeNoShifts(),
  /** правки ячеек: ключ месяца "YYYY-M" → индекс строки → день → код */
  scheduleByMonth: loadScheduleByMonthFromLocal(),
  /** Переназначение объекта (ФИО → ust | pilot), только отличия от DEFAULT_PILOT_NAMES */
  sectionAssignOverrides: loadSectionAssignOverrides(),
  /** Переименование вкладок ust / pilot */
  sectionTitleOverrides: loadSectionTitleOverrides(),
  /** Легенда / отпуска: true = панель развёрнута (localStorage ww-ui-blocks) */
  uiBlocks: loadUiBlocks(),
  /** Месяц → ФИО из базы → правки ТН и должности */
  employeeFieldOverridesByMonth: _rosterInit.employeeFieldOverridesByMonth,
  /** Месяц → добавленные вручную записи (в конец списка) */
  addedEmployeesByMonth: _rosterInit.addedEmployeesByMonth,
};

function scheduleOverridesBucket() {
  const k = state.monthKey;
  if (!state.scheduleByMonth[k]) state.scheduleByMonth[k] = {};
  return state.scheduleByMonth[k];
}

function persistScheduleByMonthLocal() {
  try {
    localStorage.setItem(STORAGE_SCHEDULE_BY_MONTH, JSON.stringify(state.scheduleByMonth));
  } catch (_) {}
}

function persistRosterExtrasLocal() {
  try {
    localStorage.setItem(
      STORAGE_ROSTER_EXTRAS,
      JSON.stringify({
        employeeFieldOverridesByMonth: state.employeeFieldOverridesByMonth,
        addedEmployeesByMonth: state.addedEmployeesByMonth,
      })
    );
  } catch (_) {}
}

function supabaseRestHeaders(extra = {}) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function buildSharedPayload() {
  return {
    sectionAssignOverrides: { ...state.sectionAssignOverrides },
    sectionTitleOverrides: { ...state.sectionTitleOverrides },
    scheduleByMonth: JSON.parse(JSON.stringify(state.scheduleByMonth)),
    employeeFieldOverridesByMonth: JSON.parse(JSON.stringify(state.employeeFieldOverridesByMonth)),
    addedEmployeesByMonth: JSON.parse(JSON.stringify(state.addedEmployeesByMonth)),
    legendIncludeNoShifts: !!state.legendIncludeNoShifts,
  };
}

function applySharedPayload(payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.sectionAssignOverrides && typeof payload.sectionAssignOverrides === "object") {
    state.sectionAssignOverrides = {};
    for (const k of Object.keys(payload.sectionAssignOverrides)) {
      const v = payload.sectionAssignOverrides[k];
      if (v === "pilot" || v === "ust") state.sectionAssignOverrides[k] = v;
    }
    try {
      localStorage.setItem(STORAGE_SECTION_ASSIGN, JSON.stringify(state.sectionAssignOverrides));
    } catch (_) {}
  }
  if (payload.sectionTitleOverrides && typeof payload.sectionTitleOverrides === "object") {
    state.sectionTitleOverrides = {};
    const o = payload.sectionTitleOverrides;
    if (typeof o.ust === "string" && o.ust.trim().toLowerCase() !== "admin") state.sectionTitleOverrides.ust = o.ust;
    if (typeof o.pilot === "string" && o.pilot.trim().toLowerCase() !== "admin") state.sectionTitleOverrides.pilot = o.pilot;
    try {
      localStorage.setItem(STORAGE_SECTION_TITLES, JSON.stringify(state.sectionTitleOverrides));
    } catch (_) {}
  }
  if (payload.scheduleByMonth && typeof payload.scheduleByMonth === "object") {
    state.scheduleByMonth = JSON.parse(JSON.stringify(payload.scheduleByMonth));
    persistScheduleByMonthLocal();
  }
  if (payload.employeeFieldOverridesByMonth != null && typeof payload.employeeFieldOverridesByMonth === "object") {
    state.employeeFieldOverridesByMonth = JSON.parse(JSON.stringify(payload.employeeFieldOverridesByMonth));
  }
  if (payload.addedEmployeesByMonth != null && typeof payload.addedEmployeesByMonth === "object") {
    state.addedEmployeesByMonth = JSON.parse(JSON.stringify(payload.addedEmployeesByMonth));
  }
  if (
    (payload.employeeFieldOverridesByMonth != null && typeof payload.employeeFieldOverridesByMonth === "object") ||
    (payload.addedEmployeesByMonth != null && typeof payload.addedEmployeesByMonth === "object")
  ) {
    persistRosterExtrasLocal();
  }
  if (typeof payload.legendIncludeNoShifts === "boolean") {
    state.legendIncludeNoShifts = payload.legendIncludeNoShifts;
    persistLegendIncludeNoShifts();
  }
}

async function pullTabelRemoteState() {
  const url = `${SUPABASE_URL}/rest/v1/tabel_state?id=eq.${encodeURIComponent(
    TABEL_STATE_ROW_ID
  )}&select=payload`;
  const res = await fetch(url, { headers: supabaseRestHeaders() });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${res.status} ${errText}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return;
  const p = rows[0].payload;
  if (p != null && typeof p === "object") applySharedPayload(p);
}

async function pushTabelRemoteState() {
  const row = {
    id: TABEL_STATE_ROW_ID,
    payload: buildSharedPayload(),
    updated_at: new Date().toISOString(),
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tabel_state`, {
    method: "POST",
    headers: supabaseRestHeaders({
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify([row]),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.warn("Supabase push failed", res.status, errText);
  }
}

function scheduleRemotePersistDebounced() {
  if (supabasePushTimer) clearTimeout(supabasePushTimer);
  supabasePushTimer = setTimeout(() => {
    supabasePushTimer = null;
    void pushTabelRemoteState();
  }, SUPABASE_PUSH_DEBOUNCE_MS);
}

async function initRemoteSync() {
  try {
    await pullTabelRemoteState();
    render();
  } catch (e) {
    console.warn("Supabase pull:", e?.message || e);
  }
}

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
  const monthKey = state.monthKey;
  const overrides = state.scheduleByMonth[monthKey];
  const fieldAll = state.employeeFieldOverridesByMonth[monthKey] || {};
  const employeesBase = base.employees.map((emp, i) => {
    let e = emp;
    if (overrides && overrides[i]) {
      e = { ...emp, schedule: { ...emp.schedule, ...overrides[i] } };
    }
    const pos = POSITION_BY_NAME[e.name];
    if (pos != null && String(pos).trim() !== "") {
      e = { ...e, position: pos };
    }
    const fo = fieldAll[e.name];
    if (fo) {
      if (fo.tn !== undefined) e = { ...e, tn: String(fo.tn).trim() };
      if (fo.position !== undefined) e = { ...e, position: String(fo.position).trim() };
    }
    return e;
  });
  const rawAdded = state.addedEmployeesByMonth[monthKey] || [];
  const addedMapped = rawAdded.map((a) => ({
    tn: a.tn != null ? String(a.tn).trim() : "",
    name: a.name,
    position: a.position != null ? String(a.position).trim() : "",
    daysOnShift: Number(a.daysOnShift) || 0,
    schedule: a.schedule && typeof a.schedule === "object" ? { ...a.schedule } : {},
    __fromManualAdd: true,
  }));
  const employees = [...employeesBase, ...addedMapped];
  return { ...base, employees };
}

function init() {
  applyTheme(state.theme);
  buildMonthSelect();
  buildSectionNav();
  bindControls();
  bindEditPasswordDialog();
  bindStickyTableClick();
  bindTeamDialog();
  bindCollapsiblePanels();
  syncCollapsiblePanels();
  render();
  void initRemoteSync();
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
      state.legendFilterCodes.clear();
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

/** Вручную добавленные показываем в табеле даже без смен; остальных — только при наличии смен */
function employeeRowShownInSchedule(emp, dim) {
  if (emp.__fromManualAdd) return true;
  return !employeeHasNoShiftsInMonth(emp, dim);
}

/** Сотрудники вкладки: без строк, если за месяц не было смен (см. ON_SHIFT_CODES); фильтр легенды (ИЛИ) */
function getFilteredEmployeesForView(data) {
  const { year, monthIndex } = parseMonthKey(state.monthKey);
  const dim = daysInMonth(year, monthIndex);
  const baseRows = employeesForSection(data.employees, state.sectionId);
  const pool = state.legendIncludeNoShifts
    ? baseRows
    : baseRows.filter((emp) => employeeRowShownInSchedule(emp, dim));
  const total = pool.length;
  const codes = [...state.legendFilterCodes];
  const rows =
    codes.length === 0
      ? pool
      : pool.filter((emp) =>
          codes.some((c) => employeeHasLegendCodeInMonth(emp, c, dim))
        );
  return { rows, total, dim };
}

function syncLegendChrome() {
  const clearBtn = document.getElementById("legendClearBtn");
  if (clearBtn) clearBtn.hidden = state.legendFilterCodes.size === 0;
  const allBtn = document.getElementById("legendIncludeNoShiftsBtn");
  if (allBtn) {
    allBtn.textContent = state.legendIncludeNoShifts ? "Только со сменами" : "Показать всех";
    allBtn.classList.toggle("is-active", state.legendIncludeNoShifts);
    allBtn.setAttribute("aria-pressed", state.legendIncludeNoShifts ? "true" : "false");
  }
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
    const selected = state.legendFilterCodes.has(item.code);
    if (selected) chip.classList.add("legend-chip--active");
    chip.setAttribute("role", "listitem");
    chip.dataset.legendCode = item.code;
    chip.title = `${item.label}. Нажмите, чтобы включить или выключить код в фильтре. Можно выбрать несколько отметок (например СПГ и СПГ.).`;
    chip.setAttribute("aria-pressed", selected ? "true" : "false");
    chip.innerHTML = `
      <span class="legend-chip__dot" style="background:${item.bg};border:1px solid ${item.fg}40" aria-hidden="true"></span>
      <span class="legend-chip__code">${item.code}</span>
      <span class="legend-chip__name">${item.label}</span>`;
    chip.addEventListener("click", () => {
      if (state.legendFilterCodes.has(item.code)) state.legendFilterCodes.delete(item.code);
      else state.legendFilterCodes.add(item.code);
      render();
    });
    list.appendChild(chip);
  });
  syncLegendChrome();
}

function bindControls() {
  document.getElementById("monthSelect").addEventListener("change", (e) => {
    scheduleScrollToTodayAppliedForMonthKey = null;
    state.monthKey = e.target.value;
    state.legendFilterCodes.clear();
    state.legendIncludeNoShifts = false;
    persistLegendIncludeNoShifts();
    render();
  });

  document.getElementById("themeToggle").addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });

  document.querySelectorAll(".segmented__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = btn.dataset.mode;
      if (m === "edit" && !isEditSessionUnlocked()) {
        openEditPasswordDialog();
        return;
      }
      applyMode(m);
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
      state.legendFilterCodes.clear();
      render();
    });
  }

  const legendIncludeBtn = document.getElementById("legendIncludeNoShiftsBtn");
  if (legendIncludeBtn) {
    legendIncludeBtn.addEventListener("click", () => {
      state.legendIncludeNoShifts = !state.legendIncludeNoShifts;
      persistLegendIncludeNoShifts();
      scheduleRemotePersistDebounced();
      render();
    });
  }

}

function appendVacationCardRow(ul, { name, tn, mainText, metaText }) {
  const li = document.createElement("li");
  li.className = "card__item card__item--vacation";
  const strong = document.createElement("strong");
  strong.textContent = name;
  li.appendChild(strong);
  if (tn != null && String(tn).trim() !== "") {
    const tnEl = document.createElement("span");
    tnEl.className = "card__item-vac-tn";
    tnEl.textContent = String(tn).trim();
    li.appendChild(tnEl);
  }
  const when = document.createElement("span");
  when.className = "card__item-vac-when";
  when.textContent = mainText;
  li.appendChild(when);
  if (metaText) {
    const meta = document.createElement("span");
    meta.className = "card__meta";
    meta.textContent = metaText;
    li.appendChild(meta);
  }
  ul.appendChild(li);
}

function renderVacationCards(data) {
  const outEl = document.getElementById("vacationOut");
  const inEl = document.getElementById("vacationIn");
  if (!outEl || !inEl) return;

  const { year, monthIndex } = parseMonthKey(state.monthKey);
  const monthTitle = `${MONTH_NAMES[monthIndex]} ${year}`;
  const titleOut = document.querySelector(".card--vac-out .card__title");
  const titleIn = document.querySelector(".card--vac-in .card__title");
  if (titleOut) titleOut.textContent = `Уезжают в отпуск — ${monthTitle}`;
  if (titleIn) titleIn.textContent = `Возвращаются с отпуска — ${monthTitle}`;

  outEl.innerHTML = "";
  inEl.innerHTML = "";

  if (!data?.employees?.length) {
    const empty = '<li class="card__empty">Нет данных сотрудников для выбранного месяца</li>';
    outEl.innerHTML = empty;
    inEl.innerHTML = empty;
    return;
  }

  const { rows } = getFilteredEmployeesForView(data);
  const slice = { employees: rows };

  if (!rows.length) {
    const empty =
      '<li class="card__empty">По текущему разделу и фильтру нет строк в графике — отпуска не показаны</li>';
    outEl.innerHTML = empty;
    inEl.innerHTML = empty;
    return;
  }

  const { departures, returns } = computeVacationSummaryFromSchedules(slice, year, monthIndex);

  if (!departures.length) {
    outEl.innerHTML =
      '<li class="card__empty">Нет отпуска по графику (цепочка ВП/ОТ с хотя бы одним ОТ) среди видимых строк</li>';
  } else {
    departures.forEach((v) => {
      const sameDay = v.startDay === v.endDay;
      const range = sameDay ? v.startLabel : `${v.startLabel} — ${v.endLabel}`;
      const mainText = `${range} · ${v.nDays} календ. дн.`;
      appendVacationCardRow(outEl, { name: v.name, tn: v.tn, mainText, metaText: "" });
    });
  }

  if (!returns.length) {
    inEl.innerHTML =
      '<li class="card__empty">Нет выхода на работу после отпуска в этом месяце (цепочка до конца месяца или нет ОТ)</li>';
  } else {
    returns.forEach((v) => {
      appendVacationCardRow(inEl, {
        name: v.name,
        tn: v.tn,
        mainText: `Выход на работу ${v.dateLabel}`,
        metaText: "",
      });
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
  const todayD = viewMonthTodayDayNumber(year, monthIndex);
  injectScheduleColgroup(table, dim, vis, todayD);

  const fullEmployees = data.employees;
  const { rows: employees, total: totalEmployees } = getFilteredEmployeesForView(data);
  const badge = document.getElementById("employeeCount");
  if (state.legendFilterCodes.size > 0) {
    const label = [...state.legendFilterCodes].join(", ");
    badge.textContent = `${employees.length} из ${totalEmployees} сотр.`;
    badge.title = `Фильтр: есть хотя бы один день с одной из отметок: ${label}`;
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
    th.innerHTML = `<span class="sticky-th__main">${STICKY_LABEL[key]}</span>`;
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
    th.dataset.scheduleDay = String(day);
    if (todayD === day) th.classList.add("schedule-day-col--today");
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
      td.className = (w ? "weekend " : "").trim();
      if (todayD === day) td.classList.add("schedule-day-col--today");
      td.dataset.scheduleDay = String(day);
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
      const canPick = state.mode === "edit" && isEditSessionUnlocked();
      pill.title = canPick
        ? code
          ? `Код: ${code}. Клик — список; зажмите и тяните по дням — заполнить как в Excel`
          : "Клик — список; зажмите и тяните — очистить диапазон дней"
        : code
          ? `Код: ${code}`
          : "Нет отметки — включите режим редактирования";
      pill.addEventListener("pointerdown", (e) => startPillFillInteraction(e, rowIndex, day, pill));

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
    if (todayD === day) td.classList.add("schedule-day-col--today");
    td.dataset.scheduleDay = String(day);
    td.textContent = String(onShiftCount[day]);
    td.setAttribute("aria-label", `На смене ${onShiftCount[day]} чел.`);
    footRow.appendChild(td);
  }
  foot.appendChild(footRow);
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
  closeScheduleCellPicker();
  cancelPillFillInteraction();
  buildLegend();
  const data = getDataset();
  document.getElementById("yearLabel").textContent = "2026";

  if (!data || !data.employees.length) {
    const tbl = document.getElementById("scheduleTable");
    tbl.querySelectorAll("colgroup").forEach((el) => el.remove());
    renderVacationCards(data || { employees: [] });
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

  const { rows: filteredRows, total: totalInSectionWithMarks } = getFilteredEmployeesForView(data);
  if (state.legendFilterCodes.size > 0 && filteredRows.length === 0) {
    renderVacationCards(data);
    const tbl = document.getElementById("scheduleTable");
    tbl.querySelectorAll("colgroup").forEach((el) => el.remove());
    document.getElementById("scheduleHead").innerHTML = "";
    const codesLabel = [...state.legendFilterCodes].join(", ");
    document.getElementById("scheduleBody").innerHTML = `<tr><td colspan="99" style="padding:24px;text-align:center;color:var(--muted)">В этом месяце нет сотрудников с отметками: ${codesLabel}. Измените выбор или нажмите «Показать всех».</td></tr>`;
    document.getElementById("scheduleFoot").innerHTML = "";
    document.getElementById("employeeCount").textContent = `0 из ${totalInSectionWithMarks} сотр.`;
    renderHiddenColumnsBar();
    syncLegendChrome();
    return;
  }

  renderVacationCards(data);
  renderSchedule(data);
  renderHiddenColumnsBar();
  syncLegendChrome();
  queueScheduleScrollToTodayColumn();
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
    legendFilter: [...state.legendFilterCodes],
    employees: rows.map((e) => {
      const { __fromManualAdd: _m, ...rest } = e;
      return {
        tn: rest.tn,
        name: rest.name,
        position: rest.position,
        daysOnShift: rest.daysOnShift,
        schedule: rest.schedule,
      };
    }),
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
