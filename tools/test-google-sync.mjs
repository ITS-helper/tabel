import fs from "fs";
import vm from "vm";

const code =
  fs.readFileSync("d:/tabel/google-sheet-sync.js", "utf8") +
  ";globalThis.WorkWatchGoogleSync;";
const ctx = { globalThis: {} };
vm.runInNewContext(code, ctx);
const { parseGoogleSheetCsv } = ctx.globalThis.WorkWatchGoogleSync;

const csv = fs.readFileSync("d:/tabel/tools/sheet-sample.csv", "utf8");
const parsed = parseGoogleSheetCsv(csv, 2026);
console.log("layout", parsed.layout);
console.log(
  "spans",
  parsed.spans.map((s) => `${s.monthKey}@${s.startCol} d=${s.dim}`).join(" | ")
);
const aug = parsed.spans.find((s) => s.monthKey === "2026-8");
console.log("august dim", aug?.dim, "(expect ~30-31)");
const june = parsed.months.find((m) => m.monthKey === "2026-6");
for (const name of ["Зацепин Никита Валериевич", "Гаджиев Ильгар Бахтиярович"]) {
  const e = june?.employees.find((x) => x.name === name);
  if (e) console.log(name, "june 6-9:", [6, 7, 8, 9].map((d) => e.schedule[d] || "-").join(" "));
}
