/**
 * Пересборка scripts/parsed-employees-2026-h1.js из CSV (google-sheet-sync парсер).
 * Сохраняет порядок строк из текущего git HEAD — чтобы не сбить scheduleByMonth по индексам.
 * Запуск: node tools/regen-parsed-h1.mjs [path/to.csv]
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = process.argv[2] || path.join(__dirname, "sheet-supabase.csv");
if (!fs.existsSync(csvPath)) {
  console.error("CSV not found:", csvPath);
  process.exit(1);
}

const code = fs.readFileSync(path.join(__dirname, "..", "google-sheet-sync.js"), "utf8");
const wrapped = code.replace(
  'typeof window !== "undefined" ? window : globalThis',
  "globalThis"
);
eval(wrapped);

const repoRoot = path.join(__dirname, "..");
let oldParsedCache = null;

function loadAllOldParsed() {
  if (oldParsedCache) return oldParsedCache;
  const fromGit = execSync("git show HEAD:scripts/parsed-employees-2026-h1.js", {
    encoding: "utf8",
    cwd: repoRoot,
  });
  const sandbox = {};
  vm.runInNewContext(fromGit, sandbox);
  oldParsedCache = sandbox;
  return sandbox;
}

function loadOldMonth(m) {
  const all = loadAllOldParsed();
  return all[`PARSED_2026_${m}`] || [];
}

function normName(name) {
  return WorkWatchGoogleSync.normalizeName(name);
}

function mergeMonthEmployees(oldList, parsedList) {
  const byName = new Map(parsedList.map((e) => [normName(e.name), e]));
  const used = new Set();
  const merged = [];

  for (const old of oldList) {
    const key = normName(old.name);
    const fresh = byName.get(key);
    if (fresh) {
      used.add(key);
      merged.push({
        tn: fresh.tn || old.tn,
        name: fresh.name,
        position: old.position || "",
        daysOnShift: fresh.daysOnShift,
        schedule: fresh.schedule,
      });
    } else {
      merged.push({ ...old });
    }
  }

  for (const fresh of parsedList) {
    const key = normName(fresh.name);
    if (used.has(key)) continue;
    merged.push({
      tn: fresh.tn,
      name: fresh.name,
      position: "",
      daysOnShift: fresh.daysOnShift,
      schedule: fresh.schedule,
    });
  }

  return merged;
}

const text = fs.readFileSync(csvPath, "utf8");
const parsed = WorkWatchGoogleSync.parseGoogleSheetCsv(text, 2026);
const months = [1, 2, 3, 4, 5, 6];

let body = `/* Автогенерация из ${path.basename(csvPath)} — 2026 янв–июнь (google-sheet-sync, порядок строк сохранён) */\n`;
for (const m of months) {
  const mk = `2026-${m}`;
  const month = parsed.months.find((x) => x.monthKey === mk);
  const parsedEmps = (month?.employees || []).map((e) => ({
    tn: e.tn,
    name: e.name,
    position: "",
    daysOnShift: e.daysOnShift,
    schedule: e.schedule,
  }));
  const oldEmps = loadOldMonth(m);
  const employees = mergeMonthEmployees(oldEmps, parsedEmps);
  body += `var PARSED_2026_${m} = ${JSON.stringify(employees, null, 2)};\n\n`;
}

const outPath = path.join(__dirname, "..", "scripts", "parsed-employees-2026-h1.js");
fs.writeFileSync(outPath, body, "utf8");

for (const m of months) {
  const mk = `2026-${m}`;
  const month = parsed.months.find((x) => x.monthKey === mk);
  const employees = mergeMonthEmployees(loadOldMonth(m), (month?.employees || []).map((e) => ({
    tn: e.tn,
    name: e.name,
    position: "",
    daysOnShift: e.daysOnShift,
    schedule: e.schedule,
  })));
  const filled = employees.filter((e) => Object.values(e.schedule).some((c) => c)).length;
  console.log(`${mk}: ${employees.length} rows, ${filled} with any code`);
}

const june = mergeMonthEmployees(
  loadOldMonth(6),
  (parsed.months.find((x) => x.monthKey === "2026-6")?.employees || []).map((e) => ({
    tn: e.tn,
    name: e.name,
    position: "",
    daysOnShift: e.daysOnShift,
    schedule: e.schedule,
  }))
);
const nasIdx = june.findIndex((e) => e.name.includes("Насыров"));
const nas = june[nasIdx];
if (nas) {
  console.log(
    "Насыров idx",
    nasIdx,
    "июнь 1-9:",
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => nas.schedule[d] || "-").join(" ")
  );
}
