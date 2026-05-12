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

/** Нормализация кода ячейки → ключ для приложения */
function normalizeCell(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (!s || s === "-" || s === "—") return "";
  s = s.replace(/\uFEFF/g, "");
  // единый вид точки в аббревиатурах
  const base = s.replace(/\.+$/, "").replace(/−/g, "-");
  const upperish = base.toUpperCase();

  const map = new Map([
    ["ОТ", "OT"],
    ["ВХ", "BX"],
    ["Б", "Б"],
    ["БЛ", "Б"],
    ["УР", "УР"],
    ["ИНК", "ИНК"],
    ["ГАЛС", "ГАЛС"],
  ]);

  if (map.has(base)) return map.get(base);
  if (upperish.startsWith("СПГ")) return "ИНК";
  if (upperish.startsWith("ТСБ")) return "ТСБ";
  if (base === "ВП") return "ВП";
  if (base === "О") return "О";
  if (base === "М") return "М";
  if (base === "АПК") return "АПК";
  if (base === "ЗЛ") return "ЗЛ";
  if (base === "ОТ") return "OT";

  return base;
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

function daysOnShiftFromSchedule(schedule, dmax) {
  let n = 0;
  const shiftCodes = new Set(["ИНК", "УР", "ГАЛС"]);
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
  const position = String(cols[2] || "").trim() || "—";

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
