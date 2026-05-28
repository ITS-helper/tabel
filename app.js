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
/** Сессия входа (sessionStorage): токен и роль после workwatch_login в Supabase */
const STORAGE_AUTH_SESSION = "ww-auth-session";
const AUTH_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const AUTH_DEFAULT_EMPLOYEE_PASSWORD = "12345678";

const AUTH_TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Supabase: общая синхронизация (см. supabase-schema.sql в репозитории) */
const SUPABASE_URL = "https://owcuvcshwtivqueftiuk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_zMRDhywx67zYK6SLGAyg-A_4KXV_Ujc";
const TABEL_STATE_ROW_ID = "global";
const STORAGE_SCHEDULE_BY_MONTH = "ww-schedule-by-month";
const STORAGE_ROSTER_EXTRAS = "ww-roster-extras";
const STORAGE_LEGEND_INCLUDE_NO_SHIFTS = "ww-legend-include-no-shifts";
const STORAGE_ZONE_PLACEMENT = "ww-zone-placement";
const SUPABASE_PUSH_DEBOUNCE_MS = 900;
const STORAGE_GOOGLE_SYNC_BACKUP = "ww-google-sync-backup";
const GOOGLE_SHEET_FETCH_FN = "google-sheet-fetch";

let supabasePushTimer = null;
let googleSheetSyncInFlight = false;

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
  if (!isAdminAuth()) return;
  if (sectionId !== "pilot" && sectionId !== "ust") return;
  if (defaultSectionForName(name) === sectionId) delete state.sectionAssignOverrides[name];
  else state.sectionAssignOverrides[name] = sectionId;
  persistSectionAssignOverrides();
  scheduleRemotePersistDebounced();
  render();
}

function resetSectionAssignOverrides() {
  if (!isAdminAuth()) return;
  state.sectionAssignOverrides = {};
  persistSectionAssignOverrides();
  scheduleRemotePersistDebounced();
  render();
}

function resetSectionTitleOverrides() {
  if (!isAdminAuth()) return;
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
  if (!isAdminAuth()) return;
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
  if (isArchiveView()) return;
  if (!canEditRosterAndObjects()) return;
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
  const canEditPeople = canEditRosterAndObjects();
  const showAuthCol = isAdminAuth();
  const authColHead = document.getElementById("teamAuthColHead");
  if (authColHead) authColHead.hidden = !showAuthCol;
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
        const loginCode = tr.querySelector(".team-dialog__login");
        if (loginCode) loginCode.textContent = authLoginForEmployee(inp.value, emp.name);
      });
      tdTn.appendChild(inp);
    } else {
      tdTn.textContent = emp.tn ?? "";
    }

    const tdName = document.createElement("td");
    tdName.textContent = emp.name;

    const tdLogin = document.createElement("td");
    tdLogin.className = "team-dialog__login-cell";
    const loginCode = document.createElement("code");
    loginCode.className = "team-dialog__login";
    loginCode.textContent = authLoginForEmployee(emp.tn, emp.name);
    tdLogin.appendChild(loginCode);

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

    if (showAuthCol) {
      const tdAuth = document.createElement("td");
      tdAuth.className = "team-dialog__auth-cell";
      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "btn btn--outline btn--sm team-dialog__reset-pwd";
      resetBtn.textContent = "↺ " + AUTH_DEFAULT_EMPLOYEE_PASSWORD;
      resetBtn.title = "Сбросить пароль и привязать логин к текущему ТН";
      resetBtn.addEventListener("click", () => {
        const tnInp = tr.querySelector("td:first-child input");
        const tnVal = tnInp ? tnInp.value : emp.tn ?? "";
        void adminResetEmployeeAuth(emp.name, tnVal, resetBtn);
      });
      tdAuth.appendChild(resetBtn);
      tr.appendChild(tdTn);
      tr.appendChild(tdName);
      tr.appendChild(tdLogin);
      tr.appendChild(tdPos);
      tr.appendChild(tdSel);
      tr.appendChild(tdAuth);
    } else {
      tr.appendChild(tdTn);
      tr.appendChild(tdName);
      tr.appendChild(tdLogin);
      tr.appendChild(tdPos);
      tr.appendChild(tdSel);
    }
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
  const admin = isAdminAuth();
  if (ustIn) {
    if (admin) ustIn.removeAttribute("readonly");
    else ustIn.setAttribute("readonly", "");
  }
  if (pilIn) {
    if (admin) pilIn.removeAttribute("readonly");
    else pilIn.setAttribute("readonly", "");
  }
  fillTeamDialogTitleInputs();
  populateTeamAssignTable();
  const resetAssign = document.getElementById("teamAssignReset");
  const resetTitles = document.getElementById("teamTitlesReset");
  if (resetAssign) resetAssign.hidden = !admin;
  if (resetTitles) resetTitles.hidden = !admin;
  const dlg = document.getElementById("teamDialog");
  if (dlg) dlg.showModal();
}

function bindTeamDialog() {
  const dlg = document.getElementById("teamDialog");
  const done = document.getElementById("teamDialogDone");
  const dismiss = document.getElementById("teamDialogDismiss");
  const resetAssign = document.getElementById("teamAssignReset");
  const resetTitles = document.getElementById("teamTitlesReset");

  if (done)
    done.addEventListener("click", () => {
      if (isAdminAuth()) {
        const u = document.getElementById("titleUstInput");
        const p = document.getElementById("titlePilotInput");
        if (u) applyTitleInput("ust", u.value);
        if (p) applyTitleInput("pilot", p.value);
      }
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
      if (!isAdminAuth()) return;
      if (!confirm("Сбросить состав команд к значениям по умолчанию?")) return;
      resetSectionAssignOverrides();
      populateTeamAssignTable();
    });
  if (resetTitles)
    resetTitles.addEventListener("click", () => {
      if (!isAdminAuth()) return;
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
  "2026-1": {
    vacationsOut: [],
    vacationsIn: [],
    employees: typeof PARSED_2026_1 !== "undefined" ? PARSED_2026_1 : [],
  },
  "2026-2": {
    vacationsOut: [],
    vacationsIn: [],
    employees: typeof PARSED_2026_2 !== "undefined" ? PARSED_2026_2 : [],
  },
  "2026-3": {
    vacationsOut: [],
    vacationsIn: [],
    employees: typeof PARSED_2026_3 !== "undefined" ? PARSED_2026_3 : [],
  },
  "2026-4": {
    vacationsOut: [],
    vacationsIn: [],
    employees: typeof PARSED_2026_4 !== "undefined" ? PARSED_2026_4 : [],
  },
  "2026-5": {
    vacationsOut: [],
    vacationsIn: [],
    employees: typeof PARSED_2026_5 !== "undefined" ? PARSED_2026_5 : [],
  },
  "2026-6": {
    vacationsOut: [],
    vacationsIn: [],
    employees: typeof PARSED_2026_6 !== "undefined" ? PARSED_2026_6 : [],
  },
  "2026-7": {
    vacationsOut: [],
    vacationsIn: [],
    employees: [],
  },
  "2026-8": {
    vacationsOut: [],
    vacationsIn: [],
    employees: [],
  },
  "2026-9": {
    vacationsOut: [],
    vacationsIn: [],
    employees: [],
  },
  "2026-10": {
    vacationsOut: [],
    vacationsIn: [],
    employees: [],
  },
  "2026-11": {
    vacationsOut: [],
    vacationsIn: [],
    employees: [],
  },
  "2026-12": {
    vacationsOut: [],
    vacationsIn: [],
    employees: [],
  },
};

/**
 * Дополнительные статические периоды (другой год и т.п.): в селекторе в группе «Архив»;
 * только просмотр, как и остальной архив.
 */
const ARCHIVE_DATABASE = {
  "2025-5": {
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

function injectScheduleColgroup(table, monthSegments, vis) {
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
  monthSegments.forEach((seg, segIdx) => {
    if (segIdx > 0) {
      const gap = document.createElement("col");
      gap.className = "schedule-col-month-gap";
      cg.appendChild(gap);
    }
    for (let d = 1; d <= seg.dim; d++) {
      const col = document.createElement("col");
      col.className = "schedule-col-day" + (seg.todayD === d ? " schedule-col-day--today" : "");
      cg.appendChild(col);
    }
  });
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

/** Следующий календарный месяц после ключа `YYYY-M`. */
function nextMonthKey(mk) {
  const { year, monthIndex } = parseMonthKey(mk);
  const d = new Date(year, monthIndex + 1, 1);
  return monthKey(d.getFullYear(), d.getMonth());
}

/** Два месяца в таблице графика: выбранный и следующий. */
function scheduleMonthSegmentsForView() {
  const primaryMk = state.monthKey;
  const secondaryMk = nextMonthKey(primaryMk);
  return [primaryMk, secondaryMk].map((monthKey) => {
    const { year, monthIndex } = parseMonthKey(monthKey);
    return {
      monthKey,
      year,
      monthIndex,
      dim: daysInMonth(year, monthIndex),
      todayD: viewMonthTodayDayNumber(year, monthIndex),
    };
  });
}

function canEditScheduleMonthKey(monthKey) {
  return isLiveMonthKey(monthKey);
}

/** Год ключей в `DATABASE` (март–декабрь в селекторе: архив / остаток года, кроме трёх «живых» месяцев). */
const CURRENT_SCHEDULE_YEAR = 2026;
/** С какого месяца (1–12) внутри `CURRENT_SCHEDULE_YEAR` показывать месяцы в группе «Архив». */
const ARCHIVE_SELECTOR_FROM_MONTH = 3;

/** «Живые» месяцы: предыдущий, текущий и следующий календарный — для них доступно редактирование. */
function liveCalendarMonthKeys() {
  const t = new Date();
  const prev = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  const next = new Date(t.getFullYear(), t.getMonth() + 1, 1);
  return [
    monthKey(prev.getFullYear(), prev.getMonth()),
    monthKey(t.getFullYear(), t.getMonth()),
    monthKey(next.getFullYear(), next.getMonth()),
  ];
}

function isLiveMonthKey(monthKey) {
  return liveCalendarMonthKeys().includes(monthKey);
}

/** Месяц целиком ещё впереди (после текущего календарного месяца). */
function isFutureMonthKey(monthKey) {
  const { year, monthIndex } = parseMonthKey(monthKey);
  const now = new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth();
  if (year > cy) return true;
  if (year < cy) return false;
  return monthIndex > cm;
}

function isArchiveMonthKey(monthKey) {
  return !isLiveMonthKey(monthKey);
}

function isArchiveView() {
  return isArchiveMonthKey(state.monthKey);
}

/** Месяцы, которые можно выбрать в селекторе (живые + архив с марта года + ключи ARCHIVE_DATABASE). */
function collectSelectableMonthKeys() {
  const keys = [];
  const seen = new Set();
  const push = (k) => {
    if (seen.has(k)) return;
    seen.add(k);
    keys.push(k);
  };
  liveCalendarMonthKeys().forEach(push);
  const fromIdx = ARCHIVE_SELECTOR_FROM_MONTH - 1;
  for (let m = fromIdx; m < 12; m++) {
    push(monthKey(CURRENT_SCHEDULE_YEAR, m));
  }
  Object.keys(ARCHIVE_DATABASE).forEach(push);
  return keys;
}

function ensureValidMonthKey() {
  const ok = new Set(collectSelectableMonthKeys());
  if (!ok.has(state.monthKey)) {
    const live = liveCalendarMonthKeys();
    state.monthKey = live[1] || live[0];
  }
}

/** Пустой каркас месяца для выбора в селекторе без записи в DATABASE. */
function emptyMonthDataset() {
  return { vacationsOut: [], vacationsIn: [], employees: [] };
}

function monthKeyAllowedSynthetic(monthKey) {
  if (isLiveMonthKey(monthKey)) return true;
  if (ARCHIVE_DATABASE[monthKey]) return true;
  const { year, monthIndex } = parseMonthKey(monthKey);
  return year === CURRENT_SCHEDULE_YEAR && monthIndex + 1 >= ARCHIVE_SELECTOR_FROM_MONTH;
}

function syncHeaderSchedulePeriod() {
  const yl = document.getElementById("yearLabel");
  if (yl) {
    const p = parseMonthKey(state.monthKey);
    const s = parseMonthKey(nextMonthKey(state.monthKey));
    if (p.year === s.year) {
      yl.textContent = `${MONTH_NAMES[p.monthIndex]}–${MONTH_NAMES[s.monthIndex]} ${p.year}`;
    } else {
      yl.textContent = `${MONTH_NAMES[p.monthIndex]} ${p.year} – ${MONTH_NAMES[s.monthIndex]} ${s.year}`;
    }
  }
  document.body.dataset.archiveView = isArchiveView() ? "1" : "0";
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

function datesEqualCal(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Число календарных дней включительно от start до end (оба — даты без времени). */
function calendarDaysInclusive(start, end) {
  const a0 = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const b0 = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((b0 - a0) / 864e5) + 1;
}

function dayScheduleCode(schedule, day) {
  return String(schedule[day] ?? "").trim();
}

/**
 * По объединённому графику (все месяцы года `year` из `getDatasetForMonthKey`): отпуск —
 * непрерывная цепочка ВП и/или ОТ с хотя бы одним ОТ. Если цепочка заходит из прошлого месяца,
 * в блоке «Уезжают» показываются полные даты начала и конца и длина всего отпуска.
 * «Возвращаются» — первый день после цепочки, если он попадает в открытый месяц (в т.ч. после отпуска, оборвавшегося в конце прошлого месяца).
 */
function computeVacationSummaryFromSchedules(data, year, monthIndex) {
  const dim = daysInMonth(year, monthIndex);
  const departures = [];
  const returns = [];
  const emps = data?.employees;
  if (!Array.isArray(emps) || emps.length === 0) {
    return { departures, returns };
  }

  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex, dim);
  const departureKeys = new Set();
  const returnKeys = new Set();

  for (const emp of emps) {
    for (let d = 1; d <= dim; d++) {
      const c = dayScheduleCode(emp.schedule, d);
      if (c !== VACATION_OT && c !== VACATION_TRAVEL) continue;
      const anchor = new Date(year, monthIndex, d);
      const seg = expandVacationSegmentCalendar(emp.name, anchor, year);
      if (!seg) continue;
      if (!vacationSegmentHasOT(emp.name, seg.start, seg.end, year)) continue;

      const overlaps = seg.end >= monthStart && seg.start <= monthEnd;
      if (!overlaps) continue;

      const key = `${emp.name}|${seg.start.getTime()}`;
      if (departureKeys.has(key)) continue;
      departureKeys.add(key);

      const nDays = calendarDaysInclusive(seg.start, seg.end);
      departures.push({
        name: emp.name,
        tn: emp.tn,
        sortTs: seg.start.getTime(),
        startLabel: formatRuDate(
          seg.start.getFullYear(),
          seg.start.getMonth(),
          seg.start.getDate()
        ),
        endLabel: formatRuDate(seg.end.getFullYear(), seg.end.getMonth(), seg.end.getDate()),
        nDays,
      });
    }

    for (let d = 1; d <= dim; d++) {
      const cur = new Date(year, monthIndex, d);
      const codeCur = scheduleCodeOnCalendarDate(emp.name, cur, year);
      if (codeCur === VACATION_OT || codeCur === VACATION_TRAVEL) continue;
      const prev = new Date(cur);
      prev.setDate(prev.getDate() - 1);
      const codePrev = scheduleCodeOnCalendarDate(emp.name, prev, year);
      if (codePrev !== VACATION_OT && codePrev !== VACATION_TRAVEL) continue;
      const seg = expandVacationSegmentCalendar(emp.name, prev, year);
      if (!seg || !vacationSegmentHasOT(emp.name, seg.start, seg.end, year)) continue;
      if (!datesEqualCal(seg.end, prev)) continue;

      const rkey = `${emp.name}|${cur.getTime()}`;
      if (returnKeys.has(rkey)) continue;
      returnKeys.add(rkey);

      returns.push({
        name: emp.name,
        tn: emp.tn,
        sortTs: cur.getTime(),
        returnDay: d,
        dateLabel: formatRuDate(year, monthIndex, d),
      });
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name, "ru");
  departures.sort((a, b) => a.sortTs - b.sortTs || byName(a, b));
  returns.sort((a, b) => a.sortTs - b.sortTs || byName(a, b));
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
  if (scheduleScrollToTodayAppliedForMonthKey === state.monthKey) return;
  const segments = scheduleMonthSegmentsForView();
  const hit = segments.find((seg) => seg.todayD != null);
  if (!hit) return;
  scheduleScrollToTodayAppliedForMonthKey = state.monthKey;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const th = document.querySelector(
        `#scheduleHead tr.schedule-head-days th.schedule-day-th[data-schedule-month-key="${hit.monthKey}"][data-schedule-day="${hit.todayD}"]`
      );
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

const STORAGE_UI_BLOCKS = "ww-ui-blocks-v2";

function normalizeEmployeeTn(tn) {
  const t = String(tn ?? "").trim();
  if (!t || t === "—" || t === "–" || t === "-") return "";
  return t;
}

function authTransliterateWord(w) {
  return [...String(w).toLowerCase()]
    .map((c) => AUTH_TRANSLIT[c] ?? (/[a-z0-9]/.test(c) ? c : ""))
    .join("");
}

/** Логин как в seed-auth-users.mjs: ТН или фамилия_и */
function authLoginForEmployee(tn, name) {
  const t = normalizeEmployeeTn(tn);
  if (/^\d+$/.test(t)) return t;
  const parts = String(name).trim().split(/\s+/);
  const fam = authTransliterateWord(parts[0] || "user");
  const ini = authTransliterateWord((parts[1] || "x")[0]);
  let base = `${fam}_${ini}`.replace(/[^a-z0-9_]/g, "").slice(0, 28);
  if (!base) base = "user";
  return base;
}

function getAuthSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_AUTH_SESSION);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.token) return null;
    const exp = s.expiresAt ? new Date(s.expiresAt).getTime() : 0;
    if (exp && Date.now() > exp) {
      clearAuthSession();
      return null;
    }
    return s;
  } catch (_) {
    return null;
  }
}

function setAuthSession(payload) {
  const expiresAt =
    payload.expires_at ||
    new Date(Date.now() + AUTH_SESSION_MAX_AGE_MS).toISOString();
  const s = {
    token: payload.token,
    login: payload.login,
    role: payload.role,
    employeeName: payload.employee_name || null,
    expiresAt,
    mustChangePassword: !!payload.must_change_password,
  };
  try {
    sessionStorage.setItem(STORAGE_AUTH_SESSION, JSON.stringify(s));
  } catch (_) {}
  syncAuthChrome();
}

function clearAuthSession() {
  const s = getAuthSession();
  if (s?.token) {
    void supabaseRpcLogout(s.token);
  }
  try {
    sessionStorage.removeItem(STORAGE_AUTH_SESSION);
  } catch (_) {}
  syncAuthChrome();
}

function isEditSessionUnlocked() {
  return getAuthSession() != null;
}

function isAdminAuth() {
  const s = getAuthSession();
  return s?.role === "admin";
}

function canEditEmployeeSchedule(empName) {
  if (!isEditSessionUnlocked() || isArchiveView() || state.mode !== "edit") return false;
  const s = getAuthSession();
  if (!s) return false;
  if (s.role === "admin") return true;
  if (sectionIdForEmployee(s.employeeName) === "ust") return false;
  return s.employeeName === empName;
}

function scheduleEditHintForUser() {
  const s = getAuthSession();
  if (!s) return "Войдите в систему.";
  if (s.role === "admin") return "Редактирование всех строк (администратор).";
  if (sectionIdForEmployee(s.employeeName) === "ust") {
    return "Усть-Луга: график редактирует только администратор.";
  }
  return "Можно менять только свою строку (пилотные проекты).";
}

function scheduleEditDeniedMessage() {
  const s = getAuthSession();
  if (!s) return "Войдите в систему.";
  if (s.role === "admin") return "";
  if (sectionIdForEmployee(s.employeeName) === "ust") {
    return "Сотрудники Усть-Луги не редактируют график. Изменения вносит администратор.";
  }
  return "Можно редактировать только свою строку. Все строки — у администратора.";
}

function canEditScheduleRow(rowIndex, monthKey = state.monthKey) {
  if (!canEditScheduleMonthKey(monthKey)) return false;
  const data = getDatasetForMonthKey(monthKey);
  const emp = data?.employees?.[rowIndex];
  if (!emp) return false;
  return canEditEmployeeSchedule(emp.name);
}

function canEditRosterAndObjects() {
  return state.mode === "edit" && isAdminAuth() && !isArchiveView();
}

async function supabaseRpcLogin(login, password) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/workwatch_login`;
  const res = await fetch(url, {
    method: "POST",
    headers: supabaseRestHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      p_login: login,
      p_password: password,
      p_ip: "web",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.hint || `HTTP ${res.status}`);
  }
  return data;
}

async function supabaseRpcLogout(token) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/workwatch_logout`, {
      method: "POST",
      headers: supabaseRestHeaders(),
      body: JSON.stringify({ p_token: token }),
    });
  } catch (_) {}
}

async function supabaseRpcAdminResetEmployeeAuth(token, employeeName, login) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/workwatch_admin_reset_employee_auth`;
  const res = await fetch(url, {
    method: "POST",
    headers: supabaseRestHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      p_token: token,
      p_employee_name: employeeName,
      p_login: login,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.hint || `HTTP ${res.status}`);
  }
  return data;
}

function adminResetErrorMessageRu(errCode) {
  switch (errCode) {
    case "invalid_session":
      return "Сессия истекла. Войдите снова как администратор.";
    case "forbidden":
      return "Сброс пароля доступен только администратору.";
    case "invalid_input":
      return "Укажите ФИО и логин (ТН или ярлык).";
    default:
      return "Не удалось сбросить пароль.";
  }
}

async function adminResetEmployeeAuth(employeeName, tn, triggerBtn) {
  if (!isAdminAuth()) {
    alert("Сброс пароля доступен только администратору.");
    return;
  }
  const session = getAuthSession();
  if (!session?.token) {
    alert("Войдите как администратор.");
    return;
  }
  const login = authLoginForEmployee(tn, employeeName);
  const tnLabel = normalizeEmployeeTn(tn) || "—";
  const ok = confirm(
    `Сбросить пароль для «${employeeName}»?\n\n` +
      `ТН: ${tnLabel}\nЛогин: ${login}\nПароль: ${AUTH_DEFAULT_EMPLOYEE_PASSWORD}\n\n` +
      "Учётка будет создана или обновлена. При следующем входе сотрудник задаст новый пароль."
  );
  if (!ok) return;
  if (triggerBtn) triggerBtn.disabled = true;
  try {
    const data = await supabaseRpcAdminResetEmployeeAuth(session.token, employeeName, login);
    if (!data?.ok) {
      alert(adminResetErrorMessageRu(data?.error));
      return;
    }
    alert(`Готово.\nЛогин: ${data.login}\nПароль: ${AUTH_DEFAULT_EMPLOYEE_PASSWORD}`);
  } catch (e) {
    const msg = String(e?.message || e || "");
    if (msg.includes("workwatch_admin_reset_employee_auth") || msg.includes("Could not find")) {
      alert("Сброс в интерфейсе не настроен — выполните supabase-auth.sql в Supabase.");
    } else {
      alert(msg.length > 160 ? "Ошибка сброса пароля. См. консоль (F12)." : msg);
    }
  } finally {
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

async function supabaseRpcChangePassword(token, currentPassword, newPassword) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/workwatch_change_password`;
  const res = await fetch(url, {
    method: "POST",
    headers: supabaseRestHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      p_token: token,
      p_current_password: currentPassword,
      p_new_password: newPassword,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.hint || `HTTP ${res.status}`);
  }
  return data;
}

function patchAuthSession(patch) {
  const s = getAuthSession();
  if (!s) return;
  Object.assign(s, patch);
  try {
    sessionStorage.setItem(STORAGE_AUTH_SESSION, JSON.stringify(s));
  } catch (_) {}
  syncAuthChrome();
}

function authErrorMessageRu(errCode) {
  switch (errCode) {
    case "rate_limited":
      return "Слишком много попыток входа с этого устройства. Подождите около 15 минут.";
    case "account_locked":
      return "Учётная запись временно заблокирована после неудачных попыток. Попробуйте позже.";
    case "invalid_credentials":
      return "Неверный логин или пароль.";
    default:
      return "Не удалось войти. Проверьте логин и пароль.";
  }
}

function changePasswordErrorMessageRu(errCode) {
  switch (errCode) {
    case "invalid_session":
      return "Сессия истекла. Войдите снова.";
    case "invalid_current_password":
      return "Неверный текущий пароль.";
    case "password_too_short":
      return "Новый пароль должен быть не короче 8 символов.";
    case "password_same":
      return "Новый пароль должен отличаться от текущего.";
    case "password_too_weak":
      return "Нельзя использовать начальный пароль «12345678». Задайте свой.";
    default:
      return "Не удалось сменить пароль. Попробуйте ещё раз.";
  }
}

let authMenuOpen = false;

function closeAuthMenu() {
  const panel = document.getElementById("authMenuPanel");
  const trigger = document.getElementById("authMenuTrigger");
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  authMenuOpen = false;
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}

function openAuthMenu() {
  const panel = document.getElementById("authMenuPanel");
  const trigger = document.getElementById("authMenuTrigger");
  if (!panel || !getAuthSession()) return;
  panel.hidden = false;
  authMenuOpen = true;
  if (trigger) trigger.setAttribute("aria-expanded", "true");
}

function syncModeWithAuth() {
  if (isArchiveView()) {
    if (state.mode !== "view") {
      state.mode = "view";
      document.body.dataset.mode = "view";
      closeScheduleCellPicker();
      render();
    }
    return;
  }
  const s = getAuthSession();
  if (s && !s.mustChangePassword) {
    if (state.mode !== "edit") applyMode("edit");
  } else if (!s && state.mode !== "view") {
    applyMode("view");
  }
}

function syncAuthChrome() {
  const label = document.getElementById("authMenuLabel");
  const chevron = document.getElementById("authMenuChevron");
  const trigger = document.getElementById("authMenuTrigger");
  const logoutBtn = document.getElementById("authLogoutBtn");
  const changePwdBtn = document.getElementById("authChangePwdBtn");
  const exportBtn = document.getElementById("exportBtn");
  const teamBtn = document.getElementById("teamDialogBtn");
  const sep = document.getElementById("authMenuSep");
  const s = getAuthSession();
  if (!label || !trigger) return;
  closeAuthMenu();
  if (!s) {
    label.textContent = "Войти";
    trigger.title = "Войти для редактирования табеля";
    trigger.classList.remove("auth-menu__trigger--signed-in");
    if (chevron) chevron.hidden = true;
    if (exportBtn) exportBtn.hidden = true;
    if (teamBtn) teamBtn.hidden = true;
    if (sep) sep.hidden = true;
    if (logoutBtn) logoutBtn.hidden = true;
    if (changePwdBtn) changePwdBtn.hidden = true;
    syncGoogleSyncMenuChrome();
    syncModeWithAuth();
    return;
  }
  trigger.classList.add("auth-menu__trigger--signed-in");
  if (chevron) chevron.hidden = false;
  if (exportBtn) exportBtn.hidden = false;
  if (teamBtn) teamBtn.hidden = false;
  if (sep) sep.hidden = false;
  if (logoutBtn) logoutBtn.hidden = false;
  if (changePwdBtn) changePwdBtn.hidden = false;
  const menuHint = " Меню: экспорт, объекты, смена пароля, выход.";
  if (s.role === "admin") {
    label.textContent = "Админ";
    trigger.title = `Вход: ${s.login}. Редактирование всех строк и настроек объектов.${menuHint}`;
  } else {
    const short = s.employeeName ? s.employeeName.split(" ")[0] : s.login;
    label.textContent = short;
    const schedHint =
      sectionIdForEmployee(s.employeeName) === "ust"
        ? "График только для просмотра (Усть-Луга)."
        : "Можно менять только свою строку (пилотные проекты).";
    trigger.title = `Вход: ${s.employeeName || s.login}. ${schedHint}${menuHint}`;
  }
  syncGoogleSyncMenuChrome();
  syncModeWithAuth();
}

function bindAuthMenu() {
  const trigger = document.getElementById("authMenuTrigger");
  const panel = document.getElementById("authMenuPanel");
  if (!trigger || trigger.dataset.bound === "1") return;
  trigger.dataset.bound = "1";

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!getAuthSession()) {
      openAuthLoginDialog();
      return;
    }
    if (authMenuOpen) closeAuthMenu();
    else openAuthMenu();
  });

  panel?.addEventListener("click", (e) => e.stopPropagation());

  if (!document.body.dataset.authMenuDocBound) {
    document.body.dataset.authMenuDocBound = "1";
    document.addEventListener(
      "click",
      () => {
        closeAuthMenu();
      },
      true
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAuthMenu();
    });
  }

  const exportBtn = document.getElementById("exportBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      closeAuthMenu();
      exportFor1C();
    });
  }
  const teamBtn = document.getElementById("teamDialogBtn");
  if (teamBtn) {
    teamBtn.addEventListener("click", () => {
      closeAuthMenu();
      openTeamDialog();
    });
  }
  bindGoogleSheetSync();
}

function applyMode(mode) {
  if (mode === "edit" && isArchiveView()) {
    alert("В архиве доступен только просмотр. Выберите месяц текущего года, чтобы редактировать табель.");
    return;
  }
  state.mode = mode;
  document.body.dataset.mode = state.mode;
  if (mode === "view") closeScheduleCellPicker();
  render();
}

function bindAuthLoginDialog() {
  const dlg = document.getElementById("editPwdDialog");
  const loginInp = document.getElementById("editLoginInput");
  const pwdInp = document.getElementById("editPwdInput");
  const ok = document.getElementById("editPwdOk");
  const cancel = document.getElementById("editPwdCancel");
  const err = document.getElementById("editPwdErr");
  if (!dlg || !loginInp || !pwdInp || !ok || !cancel || !err) return;

  const hideErr = () => {
    err.hidden = true;
    err.textContent = "";
  };

  const trySubmit = async () => {
    hideErr();
    const login = loginInp.value.trim();
    const password = pwdInp.value;
    if (!login || !password) {
      err.textContent = "Введите логин и пароль.";
      err.hidden = false;
      return;
    }
    ok.disabled = true;
    try {
      const data = await supabaseRpcLogin(login, password);
      if (!data?.ok) {
        err.textContent = authErrorMessageRu(data?.error);
        err.hidden = false;
        pwdInp.select();
        return;
      }
      setAuthSession(data);
      loginInp.value = "";
      pwdInp.value = "";
      if (data.must_change_password) {
        dlg.close();
        openChangePasswordDialog({ required: true });
      } else {
        dlg.close();
        applyMode("edit");
      }
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (msg.includes("workwatch_login") || msg.includes("Could not find")) {
        err.textContent = "Сервис входа не настроен — выполните supabase-auth.sql в Supabase.";
      } else if (msg.includes("crypt") || msg.includes("pgcrypto")) {
        err.textContent =
          "В Supabase не подключено расширение pgcrypto. Database → Extensions → включите pgcrypto, затем снова выполните supabase-auth.sql.";
      } else if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        err.textContent = "Ошибка сети при входе. Откройте сайт по http(s) (не file://) и проверьте интернет.";
      } else {
        err.textContent = msg.length > 120 ? "Ошибка входа. Откройте консоль браузера (F12) для деталей." : msg;
      }
      err.hidden = false;
    } finally {
      ok.disabled = false;
    }
  };

  ok.addEventListener("click", () => void trySubmit());
  cancel.addEventListener("click", () => {
    hideErr();
    loginInp.value = "";
    pwdInp.value = "";
    dlg.close();
  });
  pwdInp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void trySubmit();
    }
  });
  loginInp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      pwdInp.focus();
    }
  });
  dlg.addEventListener("close", () => {
    hideErr();
    loginInp.value = "";
    pwdInp.value = "";
  });
}

function openAuthLoginDialog() {
  const dlg = document.getElementById("editPwdDialog");
  const loginInp = document.getElementById("editLoginInput");
  const pwdInp = document.getElementById("editPwdInput");
  const err = document.getElementById("editPwdErr");
  if (!dlg || !loginInp || !pwdInp) return;
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
  loginInp.value = "";
  pwdInp.value = "";
  if (typeof dlg.showModal === "function") dlg.showModal();
  else alert("Обновите браузер: нужна поддержка диалога для входа.");
  setTimeout(() => loginInp.focus(), 0);
}

let changePwdRequired = false;

function bindChangePasswordDialog() {
  const dlg = document.getElementById("changePwdDialog");
  const cur = document.getElementById("changePwdCurrent");
  const neu = document.getElementById("changePwdNew");
  const neu2 = document.getElementById("changePwdNew2");
  const ok = document.getElementById("changePwdOk");
  const cancel = document.getElementById("changePwdCancel");
  const err = document.getElementById("changePwdErr");
  const hint = document.getElementById("changePwdHint");
  const title = document.getElementById("changePwdTitle");
  if (!dlg || !cur || !neu || !neu2 || !ok || !cancel || !err) return;

  const hideErr = () => {
    err.hidden = true;
    err.textContent = "";
  };

  const trySubmit = async () => {
    hideErr();
    const session = getAuthSession();
    if (!session?.token) {
      err.textContent = "Сначала войдите в систему.";
      err.hidden = false;
      return;
    }
    const current = cur.value;
    const next = neu.value;
    const next2 = neu2.value;
    if (!current || !next) {
      err.textContent = "Заполните текущий и новый пароль.";
      err.hidden = false;
      return;
    }
    if (next !== next2) {
      err.textContent = "Новые пароли не совпадают.";
      err.hidden = false;
      neu2.focus();
      return;
    }
    ok.disabled = true;
    try {
      const data = await supabaseRpcChangePassword(session.token, current, next);
      if (!data?.ok) {
        err.textContent = changePasswordErrorMessageRu(data?.error);
        err.hidden = false;
        return;
      }
      patchAuthSession({ mustChangePassword: false });
      dlg.close();
      cur.value = "";
      neu.value = "";
      neu2.value = "";
      changePwdRequired = false;
      if (state.mode !== "edit") applyMode("edit");
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (msg.includes("workwatch_change_password") || msg.includes("Could not find")) {
        err.textContent = "Смена пароля не настроена — выполните supabase-auth.sql в Supabase.";
      } else {
        err.textContent =
          msg.length > 120 ? "Ошибка смены пароля. Откройте консоль (F12)." : msg;
      }
      err.hidden = false;
    } finally {
      ok.disabled = false;
    }
  };

  ok.addEventListener("click", () => void trySubmit());
  cancel.addEventListener("click", () => {
    if (changePwdRequired) {
      clearAuthSession();
      if (state.mode === "edit") applyMode("view");
    }
    hideErr();
    cur.value = "";
    neu.value = "";
    neu2.value = "";
    dlg.close();
    changePwdRequired = false;
  });
  neu2.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void trySubmit();
    }
  });
  dlg.addEventListener("close", () => {
    if (changePwdRequired && getAuthSession()?.mustChangePassword) {
      setTimeout(() => openChangePasswordDialog({ required: true }), 0);
    }
  });
  dlg.addEventListener("cancel", (e) => {
    if (changePwdRequired) {
      e.preventDefault();
    }
  });

  const changePwdBtn = document.getElementById("authChangePwdBtn");
  if (changePwdBtn) {
    changePwdBtn.addEventListener("click", () => openChangePasswordDialog({ required: false }));
  }
}

function openChangePasswordDialog(opts) {
  const required = !!(opts && opts.required);
  changePwdRequired = required;
  const dlg = document.getElementById("changePwdDialog");
  const cur = document.getElementById("changePwdCurrent");
  const neu = document.getElementById("changePwdNew");
  const neu2 = document.getElementById("changePwdNew2");
  const err = document.getElementById("changePwdErr");
  const hint = document.getElementById("changePwdHint");
  const cancel = document.getElementById("changePwdCancel");
  const title = document.getElementById("changePwdTitle");
  if (!dlg || !cur || !neu || !neu2) return;
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
  cur.value = "";
  neu.value = "";
  neu2.value = "";
  if (title) {
    title.textContent = required ? "Задайте свой пароль" : "Смена пароля";
  }
  if (hint) {
    hint.textContent = required
      ? "Это первый вход. Укажите новый пароль (не короче 8 символов, не «12345678»)."
      : "Новый пароль: не короче 8 символов, не «12345678».";
  }
  if (cancel) {
    cancel.textContent = required ? "Выйти" : "Отмена";
    cancel.hidden = false;
  }
  if (typeof dlg.showModal === "function") dlg.showModal();
  else alert("Обновите браузер для смены пароля.");
  setTimeout(() => cur.focus(), 0);
}

function ensureAuthPasswordFlowOnLoad() {
  const s = getAuthSession();
  if (s?.mustChangePassword) {
    openChangePasswordDialog({ required: true });
  }
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

function openScheduleCellPicker(rowIndex, day, pillEl, monthKey = state.monthKey) {
  if (state.mode !== "edit" || !isEditSessionUnlocked()) return;
  if (!canEditScheduleRow(rowIndex, monthKey)) {
    alert(scheduleEditDeniedMessage());
    return;
  }
  const data = getDatasetForMonthKey(monthKey);
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
  sel.dataset.scheduleMonthKey = monthKey;
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
    const mk = sel.dataset.scheduleMonthKey || state.monthKey;
    applyScheduleCellValue(ri, d, next, sel._pillEl, mk);
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

function applyScheduleCellValue(rowIndex, day, next, pillEl, monthKey = state.monthKey) {
  if (!pillEl) return;
  const bucket = scheduleOverridesBucketFor(monthKey);
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
  document
    .querySelectorAll(
      `#scheduleBody .pill[data-row="${row}"][data-schedule-month-key="${pi.monthKey}"]`
    )
    .forEach((pill) => {
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

function applyScheduleRowDayRange(rowIndex, dayA, dayB, code, monthKey = state.monthKey) {
  if (!canEditScheduleRow(rowIndex, monthKey)) return;
  const data = getDatasetForMonthKey(monthKey);
  if (!data || rowIndex < 0 || rowIndex >= data.employees.length) return;
  const { year, monthIndex } = parseMonthKey(monthKey);
  const dim = daysInMonth(year, monthIndex);
  const lo = Math.max(1, Math.min(Math.min(dayA, dayB), dim));
  const hi = Math.min(dim, Math.max(Math.max(dayA, dayB), 1));
  const bucket = scheduleOverridesBucketFor(monthKey);
  if (!bucket[rowIndex]) bucket[rowIndex] = {};
  for (let d = lo; d <= hi; d++) {
    bucket[rowIndex][d] = code;
  }
  persistScheduleByMonthLocal();
  scheduleRemotePersistDebounced();
  render();
}

function startPillFillInteraction(ev, rowIndex, day, pillEl, monthKey = state.monthKey) {
  if (state.mode !== "edit" || !isEditSessionUnlocked()) return;
  if (!canEditScheduleRow(rowIndex, monthKey)) return;
  if (ev.button !== 0) return;
  const data = getDatasetForMonthKey(monthKey);
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
    if (
      p &&
      p.dataset.row === String(pi.rowIndex) &&
      p.dataset.scheduleMonthKey === pi.monthKey
    ) {
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
      applyScheduleRowDayRange(pi.rowIndex, pi.day0, pi.day1, pi.code, pi.monthKey);
    } else {
      openScheduleCellPicker(pi.rowIndex, pi.day0, pi.pillEl, pi.monthKey);
    }
  };

  pillFillInteraction = {
    rowIndex,
    monthKey,
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
  const collapsed = { legend: false, vacations: false, summary: false, zones: false };
  try {
    const r = localStorage.getItem(STORAGE_UI_BLOCKS);
    if (!r) return collapsed;
    const o = JSON.parse(r);
    return {
      legend: o.legend === true,
      vacations: o.vacations === true,
      summary: o.summary === true,
      zones: o.zones === true,
    };
  } catch (_) {
    return collapsed;
  }
}

function loadZonePlacementFromLocal() {
  try {
    const r = localStorage.getItem(STORAGE_ZONE_PLACEMENT);
    if (!r) return {};
    const o = JSON.parse(r);
    return typeof o === "object" && o !== null && !Array.isArray(o) ? o : {};
  } catch (_) {
    return {};
  }
}

function persistZonePlacementLocal() {
  try {
    localStorage.setItem(STORAGE_ZONE_PLACEMENT, JSON.stringify(state.zonePlacementByMonth));
  } catch (_) {}
}

/** ФИО табеля за месяц на объекте: смены в месяце; сегодня не ОТ (отпуск) */
function getZoneRosterNamesForMonth(monthKey, sectionId) {
  if (sectionId !== "ust" && sectionId !== "pilot") return [];
  const data = getDatasetForMonthKey(monthKey);
  if (!data?.employees?.length) return [];
  const { year, monthIndex } = parseMonthKey(monthKey);
  const dataYear = year;
  const dim = daysInMonth(year, monthIndex);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return employeesForSection(data.employees, sectionId)
    .filter((emp) => !employeeHasNoShiftsInMonth(emp, dim))
    .filter((emp) => scheduleCodeOnCalendarDate(emp.name, today, dataYear) !== VACATION_OT)
    .map((e) => e.name)
    .filter(Boolean);
}

/** Сегодня в графике отметка ВХ — в расстановке автоматически «Выходной» */
function getZoneTodayDayOffNames(monthKey, sectionId) {
  const dataYear = parseMonthKey(monthKey).year;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return getZoneRosterNamesForMonth(monthKey, sectionId).filter(
    (name) => scheduleCodeOnCalendarDate(name, today, dataYear) === "ВХ"
  );
}

function canEditZonePlacement() {
  if (isArchiveView() || state.mode !== "edit") return false;
  return isEditSessionUnlocked();
}

function getZonePlacementLockHint() {
  if (isArchiveView()) return "В архиве расстановку менять нельзя.";
  if (state.mode !== "edit") return "Войдите в систему, чтобы редактировать расстановку.";
  if (!isEditSessionUnlocked()) {
    return "Войдите в систему (логин и пароль из Supabase).";
  }
  return "";
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
  monthKey: (() => {
    const t = new Date();
    return monthKey(t.getFullYear(), t.getMonth());
  })(),
  sectionId: "ust",
  mode: "view",
  theme: "light",
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
  /** Месяц → расстановка по зонам (утро/вечер) */
  zonePlacementByMonth: loadZonePlacementFromLocal(),
};

function scheduleOverridesBucketFor(monthKey) {
  if (!state.scheduleByMonth[monthKey]) state.scheduleByMonth[monthKey] = {};
  return state.scheduleByMonth[monthKey];
}

function scheduleOverridesBucket() {
  return scheduleOverridesBucketFor(state.monthKey);
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
    zonePlacementByMonth: JSON.parse(JSON.stringify(state.zonePlacementByMonth)),
  };
}

function capturePayloadSnapshot() {
  return {
    savedAt: new Date().toISOString(),
    payload: buildSharedPayload(),
  };
}

function loadGoogleSyncBackupMeta() {
  try {
    const r = localStorage.getItem(STORAGE_GOOGLE_SYNC_BACKUP);
    if (!r) return null;
    const o = JSON.parse(r);
    if (!o?.payload || typeof o.payload !== "object") return null;
    return o;
  } catch (_) {
    return null;
  }
}

function saveGoogleSyncBackup(snapshot) {
  try {
    localStorage.setItem(STORAGE_GOOGLE_SYNC_BACKUP, JSON.stringify(snapshot));
  } catch (e) {
    console.warn("Google sync backup not saved", e);
  }
}

function clearGoogleSyncBackup() {
  try {
    localStorage.removeItem(STORAGE_GOOGLE_SYNC_BACKUP);
  } catch (_) {}
}

function hasGoogleSyncBackup() {
  return !!loadGoogleSyncBackupMeta();
}

function applyPayloadSnapshot(snapshot) {
  if (!snapshot?.payload) return;
  applySharedPayload(snapshot.payload);
}

function findEmployeeRowIndexByName(monthKey, name) {
  const data = getDatasetForMonthKey(monthKey);
  if (!data?.employees) return -1;
  const target = WorkWatchGoogleSync.normalizeName(name);
  return data.employees.findIndex((e) => WorkWatchGoogleSync.normalizeName(e.name) === target);
}

async function fetchGoogleSheetCsvText() {
  const url = `${SUPABASE_URL}/functions/v1/${GOOGLE_SHEET_FETCH_FN}`;
  const res = await fetch(url, { headers: supabaseRestHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = data?.hint ? `\n${data.hint}` : "";
    throw new Error((data?.error || `Ошибка ${res.status}`) + hint);
  }
  if (!data?.csv || typeof data.csv !== "string") {
    throw new Error("Пустой ответ от сервера — нет CSV.");
  }
  return data.csv;
}

function applyGoogleSheetParsed(parsed) {
  let updatedCells = 0;
  let updatedSections = 0;
  let addedRows = 0;
  let skippedMonths = 0;

  for (const { monthKey, employees } of parsed.months) {
    if (!monthKeyAllowedSynthetic(monthKey) && !DATABASE[monthKey] && !ARCHIVE_DATABASE[monthKey]) {
      skippedMonths++;
      continue;
    }

    for (const empSheet of employees) {
      const name = WorkWatchGoogleSync.normalizeName(empSheet.name);
      if (!name) continue;

      if (empSheet.sectionId === "ust" || empSheet.sectionId === "pilot") {
        const cur = sectionIdForEmployee(name);
        if (cur !== empSheet.sectionId) {
          state.sectionAssignOverrides[name] = empSheet.sectionId;
          updatedSections++;
        } else if (state.sectionAssignOverrides[name] && defaultSectionForName(name) === empSheet.sectionId) {
          delete state.sectionAssignOverrides[name];
        }
      }

      let rowIndex = findEmployeeRowIndexByName(monthKey, name);

      if (rowIndex < 0) {
        if (!state.addedEmployeesByMonth[monthKey]) state.addedEmployeesByMonth[monthKey] = [];
        const pos =
          typeof POSITION_BY_NAME !== "undefined" && POSITION_BY_NAME[name]
            ? POSITION_BY_NAME[name]
            : "";
        state.addedEmployeesByMonth[monthKey].push({
          tn: empSheet.tn,
          name,
          position: pos,
          daysOnShift: empSheet.daysOnShift,
          schedule: { ...empSheet.schedule },
        });
        addedRows++;
        continue;
      }

      const fieldBucket = rosterFieldBucketForMonth(monthKey);
      const tnNorm = String(empSheet.tn || "").trim();
      if (tnNorm && tnNorm !== "—") {
        const curTn = fieldBucket[name]?.tn;
        const data = getDatasetForMonthKey(monthKey);
        const baseTn = data?.employees?.[rowIndex]?.tn;
        if (tnNorm !== String(curTn ?? baseTn ?? "").trim()) {
          if (!fieldBucket[name]) fieldBucket[name] = {};
          fieldBucket[name].tn = tnNorm;
        }
      }

      const bucket = scheduleOverridesBucketFor(monthKey);
      const data = getDatasetForMonthKey(monthKey);
      const baseEmp = data?.employees?.[rowIndex];
      const nextRow = {};
      for (let d = 1; d <= empSheet.dim; d++) {
        const code = empSheet.schedule[d] ?? "";
        const baseCode = baseEmp?.schedule?.[d] ?? "";
        if (code !== baseCode) {
          nextRow[d] = code;
          updatedCells++;
        }
      }
      if (Object.keys(nextRow).length) bucket[rowIndex] = nextRow;
      else if (bucket[rowIndex]) delete bucket[rowIndex];
    }
  }

  persistSectionAssignOverrides();
  persistScheduleByMonthLocal();
  persistRosterExtrasLocal();
  return { updatedCells, updatedSections, addedRows, skippedMonths };
}

async function runGoogleSheetSync() {
  if (!isAdminAuth()) {
    alert("Синхронизация из Google доступна только администратору.");
    return;
  }
  if (googleSheetSyncInFlight) return;
  if (typeof WorkWatchGoogleSync === "undefined") {
    alert("Модуль google-sheet-sync.js не загружен.");
    return;
  }
  if (
    !window.confirm(
      "Загрузить график из Google Таблицы?\n\nТекущие правки (ячейки, состав, ТН) будут сохранены на этом устройстве для отката. Данные уйдут в облако Supabase после синхронизации.\n\nПродолжить?"
    )
  ) {
    return;
  }

  googleSheetSyncInFlight = true;
  const syncBtn = document.getElementById("googleSheetSyncBtn");
  if (syncBtn) syncBtn.disabled = true;

  try {
    const csv = await fetchGoogleSheetCsvText();
    const parsed = WorkWatchGoogleSync.parseGoogleSheetCsv(
      csv,
      WorkWatchGoogleSync.SHEET_SCHEDULE_YEAR
    );
    const backup = capturePayloadSnapshot();
    const stats = applyGoogleSheetParsed(parsed);
    saveGoogleSyncBackup(backup);
    await pushTabelRemoteState();
    render();
    syncGoogleSyncMenuChrome();
    alert(
      `Синхронизация завершена.\n\n` +
        `Месяцев в таблице: ${parsed.months.length}\n` +
        `Обновлено ячеек (отличий от базы): ${stats.updatedCells}\n` +
        `Смен объекта (состав): ${stats.updatedSections}\n` +
        `Добавлено строк (не было в табеле): ${stats.addedRows}` +
        (stats.skippedMonths ? `\nПропущено месяцев (нет в табеле): ${stats.skippedMonths}` : "") +
        `\n\nОткат: меню → «Откатить синхронизацию Google».`
    );
  } catch (e) {
    console.warn("Google sheet sync failed", e);
    alert(
      `Не удалось синхронизировать.\n\n${e?.message || e}\n\n` +
        "Проверьте доступ к таблице (просмотр по ссылке) и что Edge Function google-sheet-fetch развёрнута в Supabase."
    );
  } finally {
    googleSheetSyncInFlight = false;
    if (syncBtn) syncBtn.disabled = false;
  }
}

async function runGoogleSheetRollback() {
  if (!isAdminAuth()) return;
  const backup = loadGoogleSyncBackupMeta();
  if (!backup) {
    alert("Нет сохранённой копии для отката на этом устройстве.");
    return;
  }
  const when = backup.savedAt
    ? new Date(backup.savedAt).toLocaleString("ru-RU")
    : "неизвестно";
  if (
    !window.confirm(
      `Вернуть табель к состоянию до последней синхронизации из Google?\n\nСохранено: ${when}\n\nПродолжить?`
    )
  ) {
    return;
  }
  try {
    applyPayloadSnapshot(backup);
    clearGoogleSyncBackup();
    await pushTabelRemoteState();
    render();
    syncGoogleSyncMenuChrome();
    alert("Откат выполнен. Состояние восстановлено и отправлено в Supabase.");
  } catch (e) {
    console.warn("Google sync rollback failed", e);
    alert(`Ошибка отката: ${e?.message || e}`);
  }
}

function syncGoogleSyncMenuChrome() {
  const syncBtn = document.getElementById("googleSheetSyncBtn");
  const rollbackBtn = document.getElementById("googleSheetRollbackBtn");
  const admin = isAdminAuth();
  if (syncBtn) syncBtn.hidden = !admin;
  if (rollbackBtn) {
    rollbackBtn.hidden = !admin || !hasGoogleSyncBackup();
    if (admin && hasGoogleSyncBackup()) {
      const b = loadGoogleSyncBackupMeta();
      const when = b?.savedAt
        ? new Date(b.savedAt).toLocaleString("ru-RU", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
      rollbackBtn.title = when ? `Копия от ${when}` : "Вернуть состояние до последней синхронизации";
    }
  }
}

function bindGoogleSheetSync() {
  const syncBtn = document.getElementById("googleSheetSyncBtn");
  const rollbackBtn = document.getElementById("googleSheetRollbackBtn");
  if (syncBtn && syncBtn.dataset.bound !== "1") {
    syncBtn.dataset.bound = "1";
    syncBtn.addEventListener("click", () => {
      closeAuthMenu();
      void runGoogleSheetSync();
    });
  }
  if (rollbackBtn && rollbackBtn.dataset.bound !== "1") {
    rollbackBtn.dataset.bound = "1";
    rollbackBtn.addEventListener("click", () => {
      closeAuthMenu();
      void runGoogleSheetRollback();
    });
  }
  syncGoogleSyncMenuChrome();
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
  if (payload.zonePlacementByMonth != null && typeof payload.zonePlacementByMonth === "object") {
    state.zonePlacementByMonth = JSON.parse(JSON.stringify(payload.zonePlacementByMonth));
    persistZonePlacementLocal();
    if (typeof window.WorkWatchZonePlacement !== "undefined") {
      window.WorkWatchZonePlacement.refresh();
    }
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
  const sumSec = document.getElementById("objectSummarySection");
  const zoneSec = document.getElementById("zonePlacementSection");
  const legBtn = document.getElementById("legendPanelToggle");
  const vacBtn = document.getElementById("vacationPanelToggle");
  const sumBtn = document.getElementById("objectSummaryPanelToggle");
  const zoneBtn = document.getElementById("zonePlacementPanelToggle");
  if (legSec) legSec.classList.toggle("open", state.uiBlocks.legend);
  if (vacSec) vacSec.classList.toggle("open", state.uiBlocks.vacations);
  if (sumSec) sumSec.classList.toggle("open", state.uiBlocks.summary);
  if (zoneSec) zoneSec.classList.toggle("open", state.uiBlocks.zones);
  if (legBtn) legBtn.setAttribute("aria-expanded", state.uiBlocks.legend ? "true" : "false");
  if (vacBtn) vacBtn.setAttribute("aria-expanded", state.uiBlocks.vacations ? "true" : "false");
  if (sumBtn) sumBtn.setAttribute("aria-expanded", state.uiBlocks.summary ? "true" : "false");
  if (zoneBtn) zoneBtn.setAttribute("aria-expanded", state.uiBlocks.zones ? "true" : "false");
}

function bindCollapsiblePanels() {
  const legBtn = document.getElementById("legendPanelToggle");
  const vacBtn = document.getElementById("vacationPanelToggle");
  const sumBtn = document.getElementById("objectSummaryPanelToggle");
  const zoneBtn = document.getElementById("zonePlacementPanelToggle");
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
  if (sumBtn) {
    sumBtn.addEventListener("click", () => {
      state.uiBlocks.summary = !state.uiBlocks.summary;
      persistUiBlocks();
      syncCollapsiblePanels();
    });
  }
  if (zoneBtn) {
    zoneBtn.addEventListener("click", () => {
      state.uiBlocks.zones = !state.uiBlocks.zones;
      persistUiBlocks();
      syncCollapsiblePanels();
    });
  }
}

function initZonePlacementModule() {
  if (typeof window.WorkWatchZonePlacement === "undefined") return;
  window.WorkWatchZonePlacement.init({
    state,
    getMonthKey: () => state.monthKey,
    getSectionId: () => state.sectionId,
    getSectionTitle: () => sectionTabTitle(state.sectionId),
    getRosterNames: () => getZoneRosterNamesForMonth(state.monthKey, state.sectionId),
    getTodayDayOffNames: () => getZoneTodayDayOffNames(state.monthKey, state.sectionId),
    canEdit: canEditZonePlacement,
    getLockHint: getZonePlacementLockHint,
    persistLocal: persistZonePlacementLocal,
    scheduleRemotePersist: scheduleRemotePersistDebounced,
  });
}

function getDatasetForMonthKey(monthKey) {
  const { year } = parseMonthKey(monthKey);
  const forceEmptyFuture =
    year === CURRENT_SCHEDULE_YEAR && isFutureMonthKey(monthKey) && !isLiveMonthKey(monthKey);

  let base = DATABASE[monthKey] || ARCHIVE_DATABASE[monthKey];
  if (forceEmptyFuture) {
    base = emptyMonthDataset();
  } else if (!base) {
    if (monthKeyAllowedSynthetic(monthKey)) base = emptyMonthDataset();
    else return null;
  }
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

function getDataset() {
  return getDatasetForMonthKey(state.monthKey);
}

/** Год графика из выбранного месяца — тот же, что в табеле (сопоставление «сегодня» по числу и месяцу). */
function summaryDataYear() {
  return parseMonthKey(state.monthKey).year;
}

const NIGHT_SHIFT_CODE = "СПГ.";
const ON_SHIFT_DAY_CODES = new Set([...ON_SHIFT_CODES].filter((c) => c !== NIGHT_SHIFT_CODE));
const WEEKEND_CODE = "ВХ";
const SICK_CODES = new Set(["Б", "БЛ"]);

function findEmployeeByNameInData(data, name) {
  if (!data?.employees) return null;
  return data.employees.find((e) => e.name === name) || null;
}

/** Отметка в календарную дату (месяц/год из dataYear табеля). */
function scheduleCodeOnCalendarDate(name, date, dataYear) {
  const mk = monthKey(dataYear, date.getMonth());
  const data = getDatasetForMonthKey(mk);
  const emp = findEmployeeByNameInData(data, name);
  if (!emp) return "";
  const dim = daysInMonth(dataYear, date.getMonth());
  const d = date.getDate();
  if (d < 1 || d > dim) return "";
  return dayScheduleCode(emp.schedule, d);
}

function expandVacationSegmentCalendar(name, anchor, dataYear) {
  const a = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const c0 = scheduleCodeOnCalendarDate(name, a, dataYear);
  if (c0 !== VACATION_OT && c0 !== VACATION_TRAVEL) return null;
  let start = new Date(a);
  let end = new Date(a);
  while (true) {
    const p = new Date(start);
    p.setDate(p.getDate() - 1);
    const c = scheduleCodeOnCalendarDate(name, p, dataYear);
    if (c !== VACATION_OT && c !== VACATION_TRAVEL) break;
    start = p;
  }
  while (true) {
    const n = new Date(end);
    n.setDate(n.getDate() + 1);
    const c = scheduleCodeOnCalendarDate(name, n, dataYear);
    if (c !== VACATION_OT && c !== VACATION_TRAVEL) break;
    end = n;
  }
  return { start, end };
}

function vacationSegmentHasOT(name, start, end, dataYear) {
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endD = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= endD) {
    if (scheduleCodeOnCalendarDate(name, cur, dataYear) === VACATION_OT) return true;
    cur.setDate(cur.getDate() + 1);
  }
  return false;
}

/** Первый календарный день отпуска (ВП/ОТ с ОТ в сегменте), вчера не в отпуске. */
function isFirstVacationCalendarDay(name, date, dataYear) {
  const dNorm = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const c = scheduleCodeOnCalendarDate(name, dNorm, dataYear);
  if (c !== VACATION_OT && c !== VACATION_TRAVEL) return false;
  const prev = new Date(dNorm);
  prev.setDate(prev.getDate() - 1);
  const cPrev = scheduleCodeOnCalendarDate(name, prev, dataYear);
  if (cPrev === VACATION_OT || cPrev === VACATION_TRAVEL) return false;
  const seg = expandVacationSegmentCalendar(name, dNorm, dataYear);
  if (!seg) return false;
  return vacationSegmentHasOT(name, seg.start, seg.end, dataYear);
}

function formatCalendarDateLongRu(d) {
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

const SUMMARY_NAMES_MAX = 7;

function formatNameList(names) {
  const sorted = [...names].sort((a, b) => a.localeCompare(b, "ru"));
  const n = sorted.length;
  if (n === 0) return "—";
  const shown = sorted.slice(0, SUMMARY_NAMES_MAX);
  const rest = n - shown.length;
  const tail = rest > 0 ? ` +${rest}` : "";
  const esc = (s) => {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  };
  return shown.map((s) => esc(s)).join(", ") + tail;
}

function renderObjectSummary() {
  const mount = document.getElementById("objectSummaryMount");
  const ctxEl = document.getElementById("objectSummaryContext");
  if (!mount) return;

  const dataYear = summaryDataYear();
  const today = new Date();
  const todayNorm = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow = new Date(todayNorm);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const mkToday = monthKey(dataYear, todayNorm.getMonth());
  const dataToday = getDatasetForMonthKey(mkToday);
  const sectionTitle = sectionTabTitle(state.sectionId);

  if (ctxEl) {
    ctxEl.textContent = `${sectionTitle} · по графику ${dataYear} г.`;
  }

  if (!dataToday || !dataToday.employees.length) {
    mount.innerHTML = `<p class="object-summary__empty">Нет данных графика за ${MONTH_NAMES[todayNorm.getMonth()]} ${dataYear} — сводка недоступна.</p>`;
    return;
  }

  const pool = employeesForSection(dataToday.employees, state.sectionId);
  if (!pool.length) {
    mount.innerHTML = `<p class="object-summary__empty">Нет сотрудников на вкладке «${sectionTitle}».</p>`;
    return;
  }

  let dayShift = 0;
  let nightShift = 0;
  const weekendToday = [];
  const sickToday = [];
  const weekendTomorrow = [];
  const vacFirstTomorrow = [];

  for (const emp of pool) {
    const codeT = scheduleCodeOnCalendarDate(emp.name, todayNorm, dataYear);
    if (codeT === NIGHT_SHIFT_CODE) nightShift += 1;
    else if (ON_SHIFT_DAY_CODES.has(codeT)) dayShift += 1;
    if (codeT === WEEKEND_CODE) weekendToday.push(emp.name);
    if (SICK_CODES.has(codeT)) sickToday.push(emp.name);

    const codeTom = scheduleCodeOnCalendarDate(emp.name, tomorrow, dataYear);
    if (codeTom === WEEKEND_CODE) weekendTomorrow.push(emp.name);
    if (isFirstVacationCalendarDay(emp.name, tomorrow, dataYear)) vacFirstTomorrow.push(emp.name);
  }

  const wdToday = weekdayShortRu(todayNorm.getFullYear(), todayNorm.getMonth(), todayNorm.getDate());
  const wdTom = weekdayShortRu(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());

  mount.innerHTML = `
    <div class="object-summary__columns">
      <div class="object-summary__col object-summary__col--today">
        <h3 class="object-summary__col-title">Сегодня <span class="object-summary__col-date">${formatCalendarDateLongRu(todayNorm)}, ${wdToday}</span></h3>
        <p class="object-summary__shifts-strip" role="status">
          <span class="object-summary__metric object-summary__metric--day">
            <span class="object-summary__metric-label">День</span>
            <span class="object-summary__metric-value">${dayShift}</span>
          </span>
          <span class="object-summary__metric-sep" aria-hidden="true"></span>
          <span class="object-summary__metric object-summary__metric--night">
            <span class="object-summary__metric-label">Ночь</span>
            <span class="object-summary__metric-value">${nightShift}</span>
          </span>
        </p>
        <div class="object-summary__block">
          <span class="object-summary__block-label">Выходной (ВХ)</span>
          <p class="object-summary__block-text">${formatNameList(weekendToday)}</p>
        </div>
        <div class="object-summary__block">
          <span class="object-summary__block-label">Болеют (Б / БЛ)</span>
          <p class="object-summary__block-text">${formatNameList(sickToday)}</p>
        </div>
      </div>
      <div class="object-summary__col object-summary__col--tomorrow">
        <h3 class="object-summary__col-title">Завтра <span class="object-summary__col-date">${formatCalendarDateLongRu(tomorrow)}, ${wdTom}</span></h3>
        <div class="object-summary__block">
          <span class="object-summary__block-label">Выходной (ВХ)</span>
          <p class="object-summary__block-text">${formatNameList(weekendTomorrow)}</p>
        </div>
        <div class="object-summary__block">
          <span class="object-summary__block-label">Первый день отпуска (ВП / ОТ)</span>
          <p class="object-summary__block-text">${formatNameList(vacFirstTomorrow)}</p>
        </div>
      </div>
    </div>`;
}

const APP_PAGE_STORAGE_KEY = "ww-app-page";
/** Должен совпадать с ?v= в ble-map.html (см. BLE_MAP_BUILD). */
const BLE_MAP_IFRAME_BUILD = "20260529c";

function ensureBleMapIframeCurrent() {
  const iframe = document.querySelector("#page-blemap iframe");
  if (!iframe) return;
  const want = `ble-map.html?v=${BLE_MAP_IFRAME_BUILD}`;
  const cur = iframe.getAttribute("src") || "";
  if (!cur.includes(BLE_MAP_IFRAME_BUILD)) iframe.src = want;
}

function showAppPage(pageId) {
  const valid = pageId === "blemap" ? "blemap" : "tabel";
  document.querySelectorAll(".app-page").forEach((el) => {
    const on = el.id === `page-${valid}`;
    el.classList.toggle("is-active", on);
    el.hidden = !on;
  });
  document.getElementById("app")?.classList.toggle("app--blemap-view", valid === "blemap");
  document.documentElement.classList.toggle("app--blemap-tab", valid === "blemap");
  document.body.classList.toggle("app--blemap-tab", valid === "blemap");
  if (valid === "blemap") {
    ensureBleMapIframeCurrent();
    const iframe = document.querySelector("#page-blemap iframe");
    if (iframe?.contentWindow) {
      try {
        iframe.contentWindow.postMessage({ type: "ww-ble-map-resize" }, "*");
      } catch {
        /* ignore */
      }
    }
  }
  try {
    sessionStorage.setItem(APP_PAGE_STORAGE_KEY, valid);
  } catch {
    /* ignore */
  }
  if (valid !== "blemap") window.scrollTo(0, 0);
}

function bindAppPageNav() {
  const saved = (() => {
    try {
      return sessionStorage.getItem(APP_PAGE_STORAGE_KEY);
    } catch {
      return null;
    }
  })();
  if (saved === "blemap") showAppPage("blemap");
  document.getElementById("appOpenBleMapBtn")?.addEventListener("click", () => showAppPage("blemap"));
  window.addEventListener("message", (e) => {
    if (e.data?.type === "ww-app-nav") {
      showAppPage(e.data.page === "blemap" ? "blemap" : "tabel");
      return;
    }
    if (e.data?.type === "ww-ble-map-fullscreen") {
      document.getElementById("app")?.classList.toggle("app--blemap-fs", !!e.data.open);
    }
  });
}

function init() {
  applyTheme(state.theme);
  syncAuthChrome();
  buildMonthSelect();
  buildSectionNav();
  bindControls();
  bindAuthLoginDialog();
  bindChangePasswordDialog();
  bindAuthMenu();
  ensureAuthPasswordFlowOnLoad();
  syncModeWithAuth();
  bindStickyTableClick();
  bindTeamDialog();
  bindCollapsiblePanels();
  syncCollapsiblePanels();
  bindAppPageNav();
  initZonePlacementModule();
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
  const btn = document.getElementById("themeToggle");
  if (btn) btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
}

function buildMonthSelect() {
  const sel = document.getElementById("monthSelect");
  sel.innerHTML = "";
  ensureValidMonthKey();

  const liveKeys = liveCalendarMonthKeys();
  const liveSet = new Set(liveKeys);
  liveKeys.forEach((key) => {
    const { year, monthIndex } = parseMonthKey(key);
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${MONTH_NAMES[monthIndex]} ${year}`;
    if (key === state.monthKey) opt.selected = true;
    sel.appendChild(opt);
  });

  const fromIdx = ARCHIVE_SELECTOR_FROM_MONTH - 1;
  const archiveSameYear = [];
  const futureSameYear = [];
  for (let m = fromIdx; m < 12; m++) {
    const key = monthKey(CURRENT_SCHEDULE_YEAR, m);
    if (liveSet.has(key)) continue;
    if (isFutureMonthKey(key)) futureSameYear.push(key);
    else archiveSameYear.push(key);
  }
  const extraArchiveKeys = Object.keys(ARCHIVE_DATABASE)
    .filter((k) => !liveSet.has(k) && !archiveSameYear.includes(k) && !futureSameYear.includes(k))
    .sort((a, b) => {
      const pa = parseMonthKey(a);
      const pb = parseMonthKey(b);
      return pa.year !== pb.year ? pa.year - pb.year : pa.monthIndex - pb.monthIndex;
    });

  const archiveKeysOrdered = [...archiveSameYear, ...extraArchiveKeys];
  if (archiveKeysOrdered.length > 0) {
    const og = document.createElement("optgroup");
    og.label = "Архив";
    archiveKeysOrdered.forEach((key) => {
      const { year, monthIndex } = parseMonthKey(key);
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = `${MONTH_NAMES[monthIndex]} ${year}`;
      if (key === state.monthKey) opt.selected = true;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  }

  if (futureSameYear.length > 0) {
    const ogF = document.createElement("optgroup");
    ogF.label = `Остаток ${CURRENT_SCHEDULE_YEAR} (пусто)`;
    futureSameYear.forEach((key) => {
      const { year, monthIndex } = parseMonthKey(key);
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = `${MONTH_NAMES[monthIndex]} ${year}`;
      if (key === state.monthKey) opt.selected = true;
      ogF.appendChild(opt);
    });
    sel.appendChild(ogF);
  }

  syncHeaderSchedulePeriod();
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
    syncModeWithAuth();
    render();
  });

  document.getElementById("themeToggle").addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });

  document.body.dataset.mode = state.mode;

  const logoutBtn = document.getElementById("authLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      closeAuthMenu();
      clearAuthSession();
    });
  }

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
      const sameDay = v.nDays === 1;
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

/** Строки таблицы: выбранный месяц + следующий (сотрудники только во 2-м — в конце). */
function buildScheduleViewRows(primaryData, secondaryData) {
  const { rows: primaryRows, total } = getFilteredEmployeesForView(primaryData);
  const secByName = new Map();
  if (secondaryData?.employees) {
    secondaryData.employees.forEach((e, i) => {
      secByName.set(e.name, i);
    });
  }
  const viewRows = primaryRows.map((emp) => {
    const primaryRowIndex = primaryData.employees.findIndex((e) => e.name === emp.name);
    const secondaryRowIndex = secByName.has(emp.name) ? secByName.get(emp.name) : null;
    return { emp, primaryRowIndex, secondaryRowIndex };
  });

  if (secondaryData) {
    const { year, monthIndex } = parseMonthKey(nextMonthKey(state.monthKey));
    const secDim = daysInMonth(year, monthIndex);
    const codes = [...state.legendFilterCodes];
    const primaryNames = new Set(primaryRows.map((e) => e.name));
    for (const emp of employeesForSection(secondaryData.employees, state.sectionId)) {
      if (primaryNames.has(emp.name)) continue;
      let show =
        state.legendIncludeNoShifts || employeeRowShownInSchedule(emp, secDim);
      if (codes.length > 0) {
        show = show && codes.some((c) => employeeHasLegendCodeInMonth(emp, c, secDim));
      }
      if (!show) continue;
      viewRows.push({
        emp,
        primaryRowIndex: null,
        secondaryRowIndex: secByName.get(emp.name) ?? null,
      });
    }
  }
  return { viewRows, total };
}

function scheduleCodeForViewRow(seg, viewRow, day) {
  const rowIndex =
    seg.monthKey === state.monthKey ? viewRow.primaryRowIndex : viewRow.secondaryRowIndex;
  if (rowIndex == null) return "";
  const data = getDatasetForMonthKey(seg.monthKey);
  const emp = data?.employees?.[rowIndex];
  if (!emp) return "";
  return emp.schedule[day] ?? "";
}

function formatScheduleMonthLabel(seg, monthSegments) {
  const years = new Set(monthSegments.map((s) => s.year));
  if (years.size > 1) {
    return `${MONTH_NAMES[seg.monthIndex]} ${seg.year}`;
  }
  return MONTH_NAMES[seg.monthIndex];
}

function appendScheduleMonthLabelRow(monthRow, monthSegments) {
  monthSegments.forEach((seg, segIdx) => {
    if (segIdx > 0) {
      const gap = document.createElement("th");
      gap.scope = "col";
      gap.rowSpan = 2;
      gap.className = "schedule-month-gap-th";
      gap.setAttribute("aria-hidden", "true");
      gap.innerHTML = "&nbsp;";
      monthRow.appendChild(gap);
    }
    const th = document.createElement("th");
    th.scope = "colgroup";
    th.colSpan = seg.dim;
    th.className = "schedule-month-label-th";
    th.dataset.scheduleMonthKey = seg.monthKey;
    const label = formatScheduleMonthLabel(seg, monthSegments);
    th.textContent = label;
    th.setAttribute("aria-label", `Месяц: ${label}`);
    monthRow.appendChild(th);
  });
}

function appendScheduleMonthDayHeaders(headerRow, seg, monthBoundary) {
  for (let day = 1; day <= seg.dim; day++) {
    const w = isWeekend(seg.year, seg.monthIndex, day);
    const th = document.createElement("th");
    th.scope = "col";
    th.className = `${w ? "weekend " : ""}schedule-day-th`.trim();
    if (day === 1 && monthBoundary) th.classList.add("schedule-day-th--month-start");
    const wd = weekdayShortRu(seg.year, seg.monthIndex, day);
    th.innerHTML = `
      <span class="schedule-day-head">
        <span class="schedule-day-head__d">${pad(day)}.${pad(seg.monthIndex + 1)}</span>
        <span class="schedule-day-head__w">${wd}</span>
      </span>`;
    th.setAttribute(
      "aria-label",
      `${day} ${MONTH_NAMES[seg.monthIndex]} ${seg.year}, ${wd}`
    );
    th.dataset.scheduleDay = String(day);
    th.dataset.scheduleMonthKey = seg.monthKey;
    if (seg.todayD === day) th.classList.add("schedule-day-col--today");
    headerRow.appendChild(th);
  }
}

function appendScheduleMonthGapTd(tr) {
  const td = document.createElement("td");
  td.className = "schedule-month-gap-td";
  td.setAttribute("aria-hidden", "true");
  td.innerHTML = "&nbsp;";
  tr.appendChild(td);
}

function appendScheduleDayCells(tr, viewRow, seg, onShiftCount, monthBoundary) {
  for (let day = 1; day <= seg.dim; day++) {
    const w = isWeekend(seg.year, seg.monthIndex, day);
    const rowIndex =
      seg.monthKey === state.monthKey ? viewRow.primaryRowIndex : viewRow.secondaryRowIndex;
    const code = scheduleCodeForViewRow(seg, viewRow, day);
    const td = document.createElement("td");
    td.className = (w ? "weekend " : "").trim();
    if (day === 1 && monthBoundary) td.classList.add("schedule-day-col--month-start");
    if (seg.todayD === day) td.classList.add("schedule-day-col--today");
    td.dataset.scheduleDay = String(day);
    td.dataset.scheduleMonthKey = seg.monthKey;
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

    if (rowIndex != null) {
      pill.dataset.row = String(rowIndex);
      pill.dataset.day = String(day);
      pill.dataset.scheduleMonthKey = seg.monthKey;
      const canPick = canEditScheduleRow(rowIndex, seg.monthKey);
      pill.title = canPick
        ? code
          ? `Код: ${code}. Клик — список; зажмите и тяните по дням — заполнить как в Excel`
          : "Клик — список; зажмите и тяните — очистить диапазон дней"
        : code
          ? `Код: ${code}`
          : scheduleEditHintForUser();
      if (canPick) {
        pill.classList.add("pill--editable");
        pill.addEventListener("pointerdown", (e) =>
          startPillFillInteraction(e, rowIndex, day, pill, seg.monthKey)
        );
      } else {
        pill.classList.add("pill--readonly");
      }
    } else {
      pill.classList.add("pill--readonly");
      pill.title = code ? `Код: ${code}` : "Нет отметки";
    }

    td.appendChild(pill);
    tr.appendChild(td);
  }
}

function renderSchedule(data) {
  const monthSegments = scheduleMonthSegmentsForView();
  const secondaryData = getDatasetForMonthKey(monthSegments[1].monthKey);
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
  injectScheduleColgroup(table, monthSegments, vis);

  const { viewRows, total: totalEmployees } = buildScheduleViewRows(data, secondaryData);
  const badge = document.getElementById("employeeCount");
  if (state.legendFilterCodes.size > 0) {
    const label = [...state.legendFilterCodes].join(", ");
    badge.textContent = `${viewRows.length} из ${totalEmployees} сотр.`;
    badge.title = `Фильтр: есть хотя бы один день с одной из отметок: ${label} (по выбранному месяцу)`;
  } else {
    badge.textContent = `${viewRows.length} сотр.`;
    badge.removeAttribute("title");
  }

  const monthRow = document.createElement("tr");
  monthRow.className = "schedule-head-months";
  const dayRow = document.createElement("tr");
  dayRow.className = "schedule-head-days";
  const keys = layout.visibleKeys;
  const lastKey = keys[keys.length - 1];

  keys.forEach((key, slot) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.rowSpan = 2;
    th.dataset.stickyKey = key;
    th.className = `sticky-col sticky-${key} ${STICKY_CELL_CLASS[key]} sticky-th-toggle schedule-head-sticky`;
    if (slot === 0) th.classList.add("schedule__corner");
    th.innerHTML = `<div class="sticky-th__inner${key === "days" ? " sticky-th__inner--center" : ""}">
      <span class="sticky-th__main">${STICKY_LABEL[key]}</span>
      <button type="button" class="sticky-th__hide" aria-label="Скрыть столбец «${STICKY_LABEL[key]}»">Скрыть</button>
    </div>`;
    th.title = `Нажмите, чтобы скрыть столбец «${STICKY_LABEL[key]}»`;
    applyStickyGeometry(th, slot, "thead", layout.left[key]);
    if (key === lastKey) th.classList.add("sticky-col--edge");
    monthRow.appendChild(th);
  });

  appendScheduleMonthLabelRow(monthRow, monthSegments);
  monthSegments.forEach((seg, segIdx) => {
    appendScheduleMonthDayHeaders(dayRow, seg, segIdx > 0);
  });
  head.appendChild(monthRow);
  head.appendChild(dayRow);

  const onShiftBySegment = monthSegments.map((seg) => {
    const counts = {};
    for (let day = 1; day <= seg.dim; day++) counts[day] = 0;
    return counts;
  });

  viewRows.forEach((viewRow) => {
    const tr = document.createElement("tr");
    keys.forEach((key, slot) => {
      const cell = slot === 0 ? document.createElement("th") : document.createElement("td");
      if (slot === 0) cell.scope = "row";
      cell.className = `sticky-col sticky-${key} ${STICKY_CELL_CLASS[key]}`;
      cell.textContent = stickyCellValue(viewRow.emp, key);
      applyStickyGeometry(cell, slot, "body", layout.left[key]);
      if (key === lastKey) cell.classList.add("sticky-col--edge");
      tr.appendChild(cell);
    });

    monthSegments.forEach((seg, segIdx) => {
      if (segIdx > 0) appendScheduleMonthGapTd(tr);
      appendScheduleDayCells(tr, viewRow, seg, onShiftBySegment[segIdx], segIdx > 0);
    });
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

  monthSegments.forEach((seg, segIdx) => {
    if (segIdx > 0) appendScheduleMonthGapTd(footRow);
    const onShiftCount = onShiftBySegment[segIdx];
    for (let day = 1; day <= seg.dim; day++) {
      const w = isWeekend(seg.year, seg.monthIndex, day);
      const td = document.createElement("td");
      td.className = `${w ? "weekend " : ""}sticky-footer-num`.trim();
      if (day === 1 && segIdx > 0) td.classList.add("schedule-day-col--month-start");
      if (seg.todayD === day) td.classList.add("schedule-day-col--today");
      td.dataset.scheduleDay = String(day);
      td.dataset.scheduleMonthKey = seg.monthKey;
      td.textContent = String(onShiftCount[day]);
      td.setAttribute(
        "aria-label",
        `На смене ${onShiftCount[day]} чел., ${MONTH_NAMES[seg.monthIndex]}`
      );
      footRow.appendChild(td);
    }
  });
  foot.appendChild(footRow);
}

function updateFooterTotals() {
  const data = getDataset();
  if (!data) return;
  const secondaryData = getDatasetForMonthKey(nextMonthKey(state.monthKey));
  const monthSegments = scheduleMonthSegmentsForView();
  const { viewRows } = buildScheduleViewRows(data, secondaryData);

  const footRow = document.querySelector("#scheduleFoot tr");
  if (!footRow) return;

  monthSegments.forEach((seg) => {
    const onShiftCount = {};
    for (let day = 1; day <= seg.dim; day++) onShiftCount[day] = 0;
    viewRows.forEach((viewRow) => {
      for (let day = 1; day <= seg.dim; day++) {
        const code = scheduleCodeForViewRow(seg, viewRow, day);
        if (ON_SHIFT_CODES.has(code)) onShiftCount[day] += 1;
      }
    });
    footRow
      .querySelectorAll(`td.sticky-footer-num[data-schedule-month-key="${seg.monthKey}"]`)
      .forEach((td) => {
        const day = Number(td.dataset.scheduleDay, 10);
        const n = onShiftCount[day] ?? 0;
        td.textContent = String(n);
        td.setAttribute(
          "aria-label",
          `На смене ${n} чел., ${MONTH_NAMES[seg.monthIndex]}`
        );
      });
  });
}

function render() {
  closeScheduleCellPicker();
  cancelPillFillInteraction();
  buildLegend();
  renderObjectSummary();
  syncHeaderSchedulePeriod();
  const data = getDataset();

  if (!data || !data.employees.length) {
    const tbl = document.getElementById("scheduleTable");
    tbl.querySelectorAll("colgroup").forEach((el) => el.remove());
    renderVacationCards(data || { employees: [] });
    const yk = parseMonthKey(state.monthKey).year;
    const msg =
      yk === CURRENT_SCHEDULE_YEAR && isFutureMonthKey(state.monthKey)
        ? "Этот месяц ещё впереди — пустой план. После начала месяца и импорта из таблицы здесь появятся строки графика."
        : isArchiveView()
          ? "Нет данных за выбранный месяц — добавьте ключ в DATABASE или ARCHIVE_DATABASE в app.js."
          : "Нет данных для этого месяца — выберите другой месяц или добавьте записи в app.js.";
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
  if (typeof window.WorkWatchZonePlacement !== "undefined") {
    window.WorkWatchZonePlacement.refresh();
  }
}

function allArchiveExportMonthKeys() {
  const live = new Set(liveCalendarMonthKeys());
  const keys = [];
  const fromIdx = ARCHIVE_SELECTOR_FROM_MONTH - 1;
  for (let m = fromIdx; m < 12; m++) {
    const k = monthKey(CURRENT_SCHEDULE_YEAR, m);
    if (!live.has(k) && !isFutureMonthKey(k)) keys.push(k);
  }
  for (const k of Object.keys(ARCHIVE_DATABASE)) {
    if (!keys.includes(k) && !isFutureMonthKey(k)) keys.push(k);
  }
  keys.sort((a, b) => {
    const pa = parseMonthKey(a);
    const pb = parseMonthKey(b);
    return pa.year !== pb.year ? pa.year - pb.year : pa.monthIndex - pb.monthIndex;
  });
  return keys;
}

function exportArchiveFullYear() {
  const keys = allArchiveExportMonthKeys();
  if (keys.length === 0) {
    alert("Нет месяцев для выгрузки архива.");
    return;
  }
  const months = {};
  for (const mk of keys) {
    const data = getDatasetForMonthKey(mk);
    if (!data) continue;
    const { year, monthIndex } = parseMonthKey(mk);
    months[mk] = {
      year,
      month: monthIndex + 1,
      employees: data.employees.map((e) => {
        const { __fromManualAdd: _m, ...rest } = e;
        return {
          tn: rest.tn,
          name: rest.name,
          position: rest.position,
          daysOnShift: rest.daysOnShift,
          schedule: rest.schedule,
        };
      }),
      scheduleOverrides: state.scheduleByMonth[mk] ? JSON.parse(JSON.stringify(state.scheduleByMonth[mk])) : {},
      rosterOverrides: {
        employeeFields: state.employeeFieldOverridesByMonth[mk] || {},
        addedEmployees: state.addedEmployeesByMonth[mk] || [],
      },
    };
  }
  const payload = {
    type: "workwatch-archive-year",
    archiveYear: CURRENT_SCHEDULE_YEAR,
    exportedAt: new Date().toISOString(),
    months,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `workwatch-archive-${CURRENT_SCHEDULE_YEAR}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

if (typeof window !== "undefined") {
  window.exportArchiveFullYear = exportArchiveFullYear;
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

init();
