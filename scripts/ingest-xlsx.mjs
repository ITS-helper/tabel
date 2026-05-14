/**
 * Читает .xlsx (как выгрузка «График работы на объектах») → scripts/parsed-employees-2026-h1.js
 * Та же сетка колонок, что и в parse-tabel-csv.mjs: ТН в кол. D (индекс 3), ФИО в E (4),
 * дни месяцев подряд с января 2026.
 *
 * Запуск: npm run ingest-xlsx -- "C:\\Users\\Макс\\Downloads\\файл.xlsx"
 * или:   TABEL_XLSX=... node scripts/ingest-xlsx.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import xlsxPkg from "xlsx";
const XLSX = xlsxPkg.default ?? xlsxPkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const xlsxPath =
  process.argv[2] ||
  process.env.TABEL_XLSX ||
  path.join("C:", "Users", "Макс", "Downloads", "График работы на объектах.xlsx");

if (!fs.existsSync(xlsxPath)) {
  console.error("Файл не найден:", xlsxPath);
  process.exit(1);
}

const wb = XLSX.readFile(xlsxPath, { cellDates: false, raw: false });
const preferredSheet =
  process.env.TABEL_SHEET ||
  wb.SheetNames.find((n) => /график\s*2026/i.test(String(n).trim())) ||
  wb.SheetNames[0];
if (!wb.Sheets[preferredSheet]) {
  console.error("Лист не найден:", preferredSheet, "| есть:", wb.SheetNames.join(", "));
  process.exit(1);
}
console.log("Лист:", preferredSheet);
const sheet = wb.Sheets[preferredSheet];
/** Массив строк; каждая строка — массив ячеек */
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
if (rows.length < 3) {
  console.error("Лист слишком короткий:", preferredSheet);
  process.exit(1);
}

function dim(y, m) {
  return new Date(y, m, 0).getDate();
}

const YEAR = 2026;
const MONTH_LEN = Array.from({ length: 12 }, (_, m) => dim(YEAR, m + 1));
const MONTHS_TO_PARSE = [1, 2, 3, 4, 5, 6];

function monthDayColStart(m1to12) {
  let col = 5;
  for (let m = 1; m < m1to12; m++) col += MONTH_LEN[m - 1];
  return col;
}

function normalizeCell(raw) {
  if (raw == null) return "";
  let s = String(raw).trim().replace(/\uFEFF/g, "");
  if (!s) return "";
  if (s === "—") return "";
  if (s === "-" || s === "−" || s === "–") return "-";
  const t = s.replace(/−/g, "-");
  if (/^СПГ\.\s*$/i.test(t)) return "СПГ.";
  if (/^ТСБ\.\s*$/i.test(t)) return "ТСБ.";
  if (/^СПГ\s*$/i.test(t)) return "СПГ";
  if (/^ТСБ\s*$/i.test(t)) return "ТСБ";
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
  /** На листе «График 2026» у строки сотрудника ТН — число; без ТН — подписи легенды / ФИО без графика */
  if (!/^\d+$/.test(tn)) return false;
  return true;
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
  const shiftCodes = new Set(["СПГ", "СПГ.", "ИНК", "УР", "ГАЛС", "М", "АПК", "ЗЛ"]);
  let n = 0;
  for (let d = 1; d <= dmax; d++) {
    if (shiftCodes.has(schedule[d])) n++;
  }
  return n;
}

function padRow(cols, minLen) {
  const out = cols.slice();
  while (out.length < minLen) out.push("");
  return out;
}

const maxColNeeded = monthDayColStart(6) + MONTH_LEN[5];
const byMonth = {};
for (const m of MONTHS_TO_PARSE) {
  byMonth[m] = [];
}

for (const row of rows) {
  if (!Array.isArray(row) || row.length === 0) continue;
  const cols = padRow(row, maxColNeeded);
  if (!isEmployeeRow(cols)) continue;
  const tn = String(cols[3] || "").trim() || "—";
  const name = String(cols[4] || "").trim();
  const position = "";
  for (const m of MONTHS_TO_PARSE) {
    const schedule = extractMonthSchedule(cols, m);
    const dmax = MONTH_LEN[m - 1];
    byMonth[m].push({
      tn,
      name,
      position,
      daysOnShift: daysOnShiftFromSchedule(schedule, dmax),
      schedule,
    });
  }
}

const monthNames = ["янв", "фев", "мар", "апр", "май", "июн"];
let body = `/* Автогенерация из ${path.basename(xlsxPath)} — ${YEAR} янв–июнь (подключать перед app.js) */\n`;
for (const m of MONTHS_TO_PARSE) {
  const varName = `PARSED_${YEAR}_${m}`;
  body += `var ${varName} = ${JSON.stringify(byMonth[m], null, 2)};\n\n`;
}
const outPath = path.join(__dirname, "parsed-employees-2026-h1.js");
fs.writeFileSync(outPath, body, "utf8");

for (const m of MONTHS_TO_PARSE) {
  console.log(`${YEAR}-${m} (${monthNames[m - 1]}): сотрудников ${byMonth[m].length}`);
}
console.log("Записано", outPath);
