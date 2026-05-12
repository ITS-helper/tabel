import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(__dirname, "..", "google_sheet_raw.csv");

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
  return rows;
}

function dim(y, m) {
  return new Date(y, m, 0).getDate();
}
const MONTH_LEN = Array.from({ length: 12 }, (_, m) => dim(2026, m + 1));

function monthDayColStart(m1to12) {
  let col = 5;
  for (let m = 1; m < m1to12; m++) col += MONTH_LEN[m - 1];
  return col;
}

const text = fs.readFileSync(csvPath, "utf8");
const rows = parseCSV(text);
const start = monthDayColStart(5);
console.log("May day 1 col index", start, "expected", 5 + 31 + 28 + 31 + 30);

const bondar = rows.find((r) => (r[4] || "").includes("Бондарь"));
if (bondar) {
  console.log("Bondar ncol", bondar.length);
  const slice = bondar.slice(start, start + 31);
  console.log("Bondar May (31):", slice.join(" | "));
}
const becker = rows.find((r) => (r[4] || "").includes("Беккер"));
if (becker) {
  console.log("Becker ncol", becker.length);
  console.log("Becker May:", becker.slice(start, start + 31).join(" | "));
}

if (bondar && becker) {
  console.log("\nBondar [118..132]:", bondar.slice(118, 133).map((c, i) => `${118 + i}:${c}`).join(" "));
  console.log("Becker [118..132]:", becker.slice(118, 133).map((c, i) => `${118 + i}:${c}`).join(" "));
}
