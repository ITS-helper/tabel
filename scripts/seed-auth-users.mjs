/**
 * Учётки WORK WATCH для всех сотрудников из табеля.
 * Запуск: npm install && npm run seed-auth
 * Затем scripts/auth-users-seed.sql в Supabase SQL Editor (после supabase-auth.sql).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "AdminChangeMe2026!";
const EMPLOYEE_DEFAULT_PASSWORD = process.env.EMPLOYEE_DEFAULT_PASSWORD || "12345678";
const RESET_PASSWORDS = process.env.SEED_RESET_PASSWORDS !== "0";

const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function normalizeTn(tn) {
  const t = String(tn || "").trim();
  if (!t || t === "—" || t === "–" || t === "-" || t === "—") return "";
  return t;
}

function translitWord(w) {
  return [...String(w).toLowerCase()]
    .map((c) => TRANSLIT[c] ?? (/[a-z0-9]/.test(c) ? c : ""))
    .join("");
}

function loginForEmployee(tn, name) {
  const t = normalizeTn(tn);
  if (/^\d+$/.test(t)) return t;
  const parts = String(name).trim().split(/\s+/);
  const fam = translitWord(parts[0] || "user");
  const ini = translitWord((parts[1] || "x")[0]);
  let base = `${fam}_${ini}`.replace(/[^a-z0-9_]/g, "").slice(0, 28);
  if (!base) base = "user";
  return base;
}

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

function tnScore(tn) {
  const t = normalizeTn(tn);
  if (/^\d+$/.test(t)) return 2;
  if (t) return 1;
  return 0;
}

async function hash(pw) {
  return bcrypt.hash(pw, 10);
}

/** name → { tn, name } — лучший ТН по всем месяцам в выгрузке */
function collectFromParsedFile(filePath) {
  const out = new Map();
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, "utf8");
  const re = /"tn"\s*:\s*"([^"]*)"\s*,\s*"name"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) {
    const tn = normalizeTn(m[1]);
    const name = m[2].trim();
    if (!name) continue;
    const prev = out.get(name);
    if (!prev || tnScore(tn) > tnScore(prev.tn)) out.set(name, { tn, name });
  }
  return out;
}

function collectFromPositionByName(appJs) {
  const out = new Map();
  const start = appJs.indexOf("const POSITION_BY_NAME = {");
  if (start < 0) return out;
  const end = appJs.indexOf("\n};", start);
  const block = end > start ? appJs.slice(start, end) : appJs.slice(start);
  const re = /"([^"]+)":\s*"/g;
  let m;
  while ((m = re.exec(block))) {
    const name = m[1].trim();
    if (name && !out.has(name)) out.set(name, { tn: "", name });
  }
  return out;
}

function mergeEmployeeMaps(...maps) {
  const out = new Map();
  for (const map of maps) {
    for (const [name, rec] of map) {
      const prev = out.get(name);
      if (!prev || tnScore(rec.tn) > tnScore(prev.tn)) out.set(name, rec);
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

const parsedPath = path.join(ROOT, "scripts", "parsed-employees-2026-h1.js");
const appJsPath = path.join(ROOT, "app.js");
const appJs = fs.readFileSync(appJsPath, "utf8");

const employees = mergeEmployeeMaps(
  collectFromParsedFile(parsedPath),
  collectFromPositionByName(appJs)
);

if (employees.length === 0) {
  console.error("Не найдено сотрудников. Проверьте scripts/parsed-employees-2026-h1.js и app.js.");
  process.exit(1);
}

const rows = [];
const migrations = [];
const credLines = [
  "# WORK WATCH — начальные пароли (не коммитьте).",
  `# Админ: ${ADMIN_LOGIN}`,
  `# Сотрудники: ${EMPLOYEE_DEFAULT_PASSWORD}`,
  "",
];

const adminHash = await hash(ADMIN_PASSWORD);
rows.push(
  `insert into public.workwatch_auth_users (login, password_hash, employee_name, role, must_change_password) values ('${sqlEscape(ADMIN_LOGIN.toLowerCase())}', '${adminHash}', null, 'admin', false) on conflict (login) do update set password_hash = excluded.password_hash, role = excluded.role, employee_name = excluded.employee_name, must_change_password = excluded.must_change_password;`
);
credLines.push(`${ADMIN_LOGIN}\t${ADMIN_PASSWORD}\t(администратор)`);
credLines.push("");

const usedLogins = new Set([ADMIN_LOGIN.toLowerCase()]);
const empHash = await hash(EMPLOYEE_DEFAULT_PASSWORD);
const loginByName = new Map();

for (const { tn, name } of employees) {
  let login = loginForEmployee(tn, name);
  let n = 2;
  while (usedLogins.has(login)) {
    login = `${loginForEmployee(tn, name)}_${n}`;
    n++;
  }
  usedLogins.add(login);
  loginByName.set(name, login);
  credLines.push(`${login}\t${EMPLOYEE_DEFAULT_PASSWORD}\t${tn || "—"}\t${name}`);

  migrations.push(
    `delete from public.workwatch_sessions where login in (select login from public.workwatch_auth_users where employee_name = '${sqlEscape(name)}' and role = 'employee' and login <> '${sqlEscape(login)}');`,
    `delete from public.workwatch_auth_users where employee_name = '${sqlEscape(name)}' and role = 'employee' and login <> '${sqlEscape(login)}';`
  );

  const conflictPwd = RESET_PASSWORDS
    ? "password_hash = excluded.password_hash, must_change_password = excluded.must_change_password,"
    : "";
  rows.push(
    `insert into public.workwatch_auth_users (login, password_hash, employee_name, role, must_change_password) values ('${sqlEscape(login)}', '${empHash}', '${sqlEscape(name)}', 'employee', true) on conflict (login) do update set ${conflictPwd} employee_name = excluded.employee_name, role = excluded.role;`
  );
}

const sqlPath = path.join(__dirname, "auth-users-seed.sql");
const credPath = path.join(__dirname, "auth-credentials.txt");
const sqlBody = [
  "-- Сгенерировано scripts/seed-auth-users.mjs",
  `-- Сотрудников: ${employees.length}, пароль: ${EMPLOYEE_DEFAULT_PASSWORD}`,
  "-- Удаляет старые логины (translit), если у сотрудника появился ТН.",
  "begin;",
  ...migrations,
  ...rows,
  "commit;",
].join("\n");

fs.writeFileSync(credPath, credLines.join("\n") + "\n", "utf8");
fs.writeFileSync(sqlPath, sqlBody + "\n", "utf8");

console.error(`Сотрудников: ${employees.length}`);
console.error(`SQL: ${sqlPath}`);
console.error(`Пароли: ${credPath}`);
console.log(sqlBody);
