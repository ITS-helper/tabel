/**
 * Генерация SQL для учёток WORK WATCH (логин + bcrypt-хеш пароля).
 * Запуск: npm install && node scripts/seed-auth-users.mjs > scripts/auth-users-seed.sql
 * Затем выполнить auth-users-seed.sql в Supabase SQL Editor (после supabase-auth.sql).
 *
 * Переменные:
 *   ADMIN_LOGIN=admin  ADMIN_PASSWORD=...  — учётка администратора
 *   EMPLOYEE_PASSWORD_PREFIX=Ww  — пароль сотрудника: {prefix}{логин} (см. auth-credentials.txt)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "AdminChangeMe2026!";
const EMP_PREFIX = process.env.EMPLOYEE_PASSWORD_PREFIX || "Ww";

/** ФИО из POSITION_BY_NAME в app.js + типичный список из выгрузки */
const EMPLOYEES = [
  ["11604", "Беккер Александр Анатольевич"],
  ["29455", "Бондарь Роман Альбертович"],
  ["23430", "Гаджиев Ильгар Бахтиярович"],
  ["24722", "Зацепин Никита Валериевич"],
  ["11356", "Кумейко Николай Александрович"],
  ["30403", "Окунев Александр Игоревич"],
  ["28760", "Шуйский Иван Андреевич"],
  ["18173", "Савчук Руслан Ростиславович"],
  ["16287", "Бурангулов Руслан Азаматович"],
  ["29456", "Газизуллин Рустам Дамирович"],
  ["27537", "Зуев Леонид Олегович"],
  ["23755", "Насыров Максим Тимурович"],
  ["16613", "Мищенко Егор Александрович"],
  ["7245", "Бердников Александр Львович"],
  ["12683", "Сергеев Тимофей Ильич"],
  ["25680", "Трубаев Никита Васильевич"],
  ["27321", "Одиноков Александр Евгеньевич"],
  ["27728", "Доркин Филипп Александрович"],
  ["472", "Подгорбунских Иван Леонидович"],
  ["22084", "Погорелец Мария Анатольевна"],
  ["7232", "Трефилов Алексей Павлович"],
  ["29135", "Штепа Илья Вадимович"],
  ["", "Жарков Александр Владиславович"],
  ["", "Магомедов Султан Абдурахманович"],
  ["", "Аюшеев Дандар Дамбаевич"],
  ["", "Ивахненко Сергей Игоревич"],
  ["", "Червяков Сергей Андреевич"],
  ["", "Смирнов Павел Александрович"],
  ["", "Устян Авенир Григорьевич"],
  ["", "Вишневский Сергей Арсенович"],
  ["", "Тучин Сергей Геннадьевич"],
];

const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function translitWord(w) {
  return [...String(w).toLowerCase()]
    .map((c) => TRANSLIT[c] ?? (/[a-z0-9]/.test(c) ? c : ""))
    .join("");
}

function loginForEmployee(tn, name) {
  const t = String(tn || "").trim();
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

async function hash(pw) {
  return bcrypt.hash(pw, 10);
}

const rows = [];
const credLines = [
  "# WORK WATCH — начальные пароли (не коммитьте в git). Передайте сотрудникам и смените в Supabase.",
  `# Админ: логин ${ADMIN_LOGIN}`,
  "",
];

const adminHash = await hash(ADMIN_PASSWORD);
rows.push(
  `insert into public.workwatch_auth_users (login, password_hash, employee_name, role) values ('${sqlEscape(ADMIN_LOGIN.toLowerCase())}', '${adminHash}', null, 'admin') on conflict (login) do update set password_hash = excluded.password_hash, role = excluded.role, employee_name = excluded.employee_name;`
);
credLines.push(`${ADMIN_LOGIN}\t${ADMIN_PASSWORD}\t(администратор)`);
credLines.push("");

const usedLogins = new Set([ADMIN_LOGIN.toLowerCase()]);

for (const [tn, name] of EMPLOYEES) {
  let login = loginForEmployee(tn, name);
  let n = 2;
  while (usedLogins.has(login)) {
    login = `${loginForEmployee(tn, name)}_${n}`;
    n++;
  }
  usedLogins.add(login);
  const password = `${EMP_PREFIX}${login}`;
  const h = await hash(password);
  credLines.push(`${login}\t${password}\t${name}`);
  rows.push(
    `insert into public.workwatch_auth_users (login, password_hash, employee_name, role) values ('${sqlEscape(login)}', '${h}', '${sqlEscape(name)}', 'employee') on conflict (login) do update set password_hash = excluded.password_hash, employee_name = excluded.employee_name, role = excluded.role;`
  );
}

const credPath = path.join(__dirname, "auth-credentials.txt");
fs.writeFileSync(credPath, credLines.join("\n") + "\n", "utf8");

console.error(`Список паролей: ${credPath}`);
console.log("-- Сгенерировано scripts/seed-auth-users.mjs");
console.log("begin;");
console.log(rows.join("\n"));
console.log("commit;");
