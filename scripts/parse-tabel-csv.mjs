/**
 * Парсинг выгрузки Google Таблицы → фрагмент для DATABASE в app.js
 * Запуск: node scripts/parse-tabel-csv.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Выгрузка: Таблица → Файл → Скачать → CSV; или export?format=csv&gid=… */
const csvPath = path.join(
  __dirname,
  "..",
  process.env.TABEL_CSV || "google_sheet_raw.csv"
);

const text = fs.readFileSync(csvPath, "utf8");

/** Простой CSV по строкам с учётом кавычек */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (c === "\n" || (c === "\r" && next === "\n"))) {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      if (c === "\r") i++;
      continue;
    }
    if (!inQuotes && c === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

const rows = parseCSV(text);
if (rows.length < 3) {
  console.error("CSV слишком короткий");
  process.exit(1);
}

/** Дни в месяце 2026 */
function dim(y, m) {
  return new Date(y, m, 0).getDate();
}

const MONTH_LEN = Array.from({ length: 12 }, (_, m) => dim(2026, m + 1));

/** Индекс первой колонки «день 1» для месяца m (1–12) подряд после ФИО */
function monthDayColStart(m1to12) {
  let col = 5;
  for (let m = 1; m < m1to12; m++) col += MONTH_LEN[m - 1];
  return col;
}

/** Нормализация кода ячейки → ключ для приложения (как в легенде Google Таблицы) */
function normalizeCell(raw) {
  if (raw == null) return "";
  let s = String(raw).trim().replace(/\uFEFF/g, "");
  if (!s) return "";

  // Длинное тире в выгрузке — пустая ячейка в UI
  if (s === "—") return "";

  // Минус / короткое тире — код «Отсутствует»
  if (s === "-" || s === "−" || s === "–") return "-";

  const t = s.replace(/−/g, "-");

  // Ночные смены: СПГ. и ТСБ. (точка частью кода)
  if (/^СПГ\.\s*$/i.test(t)) return "СПГ.";
  if (/^ТСБ\.\s*$/i.test(t)) return "ТСБ.";
  if (/^СПГ\s*$/i.test(t)) return "СПГ";
  if (/^ТСБ\s*$/i.test(t)) return "ТСБ";

  // Старые латинские сокращения из черновиков
  if (/^OT$/i.test(t)) return "ОТ";
  if (/^BX$/i.test(t)) return "ВХ";

  const map = new Map([
    ["ОТ", "ОТ"],
    ["ВХ", "ВХ"],
    ["Б", "Б"],
    ["БЛ", "БЛ"],
    ["ВП", "ВП"],
    ["О", "О"],
    ["УР", "УР"],
    ["ИНК", "ИНК"],
    ["ГАЛС", "ГАЛС"],
    ["М", "М"],
    ["АПК", "АПК"],
    ["ЗЛ", "ЗЛ"],
  ]);

  if (map.has(t)) return map.get(t);

  return t;
}

function isEmployeeRow(cols) {
  const fio = (cols[4] || "").trim();
  const tn = (cols[3] || "").trim();
  if (!fio) return false;
  if (/кол-во|итого|сотрудников|нехватка|^\s*спг\s*:/i.test(fio)) return false;
  if (/^Итого|^СПГ:|^ТСБ|^ТСБ\./i.test(fio)) return false;
  if (tn && /^\d+$/.test(tn)) return true;
  if (/^[А-ЯЁ][а-яё\-]+\s+[А-ЯЁ][а-яё\-]+/.test(fio)) return true;
  return false;
}

function extractMonthSchedule(cols, m1to12) {
  const start = monthDayColStart(m1to12);
  const dmax = MONTH_LEN[m1to12 - 1];
  const schedule = {};
  for (let d = 1; d <= dmax; d++) {
    const v = cols[start + d - 1];
    schedule[d] = normalizeCell(v);
  }
  return schedule;
}

/** Совпадает с ON_SHIFT_CODES в app.js */
function daysOnShiftFromSchedule(schedule, dmax) {
  let n = 0;
  const shiftCodes = new Set([
    "СПГ",
    "СПГ.",
    "ИНК",
    "УР",
    "ГАЛС",
    "М",
    "АПК",
    "ЗЛ",
  ]);
  for (let d = 1; d <= dmax; d++) {
    if (shiftCodes.has(schedule[d])) n++;
  }
  return n;
}

const employees = [];
for (const cols of rows) {
  if (!isEmployeeRow(cols)) continue;
  const tn = String(cols[3] || "").trim() || "—";
  const name = String(cols[4] || "").trim();
  /** Колонка C в этой выгрузке — подпись к аббревиатуре из легенды слева (Отпуск, ВСМ…), не должность сотрудника. Должности в CSV нет. */
  const position = "";

  const schedule = extractMonthSchedule(cols, 5); // май 2026
  const dmax = MONTH_LEN[4];
  employees.push({
    tn,
    name,
    position,
    daysOnShift: daysOnShiftFromSchedule(schedule, dmax),
    schedule,
  });
}

const json = JSON.stringify(employees, null, 2);
const out = `/* Автогенерация из tabel-sheet.csv — май 2026 (подключать перед app.js) */\nvar PARSED_EMPLOYEES_MAY = ${json};\n`;
fs.writeFileSync(path.join(__dirname, "parsed-employees-may.js"), out, "utf8");

console.log(`Сотрудников (май 2026): ${employees.length}`);
console.log("Записано scripts/parsed-employees-may.js");
