#!/usr/bin/env node
/**
 * Сборка debug APK (нужны Android SDK и JDK 21).
 *
 * Имена: dist/workwatch-ble-map-v{versionName}-vc{code}-web{build}[-{label}].apk
 * Предыдущие workwatch-ble-map*.apk из dist/ → dist/apk-archive/
 *
 * Метка (необяз.): node scripts/build-android-apk.mjs --label GATT
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ANDROID = path.join(ROOT, "android");
const BUILD_GRADLE = path.join(ANDROID, "app", "build.gradle");
const BLE_MAP_JS = path.join(ROOT, "ble-map.js");
const OUT_APK = path.join(
  ANDROID,
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk"
);
const DIST_DIR = path.join(ROOT, "dist");
const ARCHIVE_DIR = path.join(DIST_DIR, "apk-archive");

function parseArgs(argv) {
  let label = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--label" && argv[i + 1]) {
      label = String(argv[++i]).trim();
    } else if (argv[i]?.startsWith("--label=")) {
      label = argv[i].slice("--label=".length).trim();
    }
  }
  return { label: label.replace(/[^a-zA-Z0-9._-]+/g, "") };
}

function readAndroidVersion() {
  const gradle = fs.readFileSync(BUILD_GRADLE, "utf8");
  const code = gradle.match(/versionCode\s+(\d+)/)?.[1];
  const name = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
  if (!code || !name) {
    throw new Error("Не удалось прочитать versionCode/versionName из android/app/build.gradle");
  }
  return { versionCode: Number(code), versionName: name };
}

function readWebBuild() {
  const js = fs.readFileSync(BLE_MAP_JS, "utf8");
  const m = js.match(/const\s+BLE_MAP_BUILD\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("Не найден BLE_MAP_BUILD в ble-map.js");
  return m[1];
}

function slugVersionName(name) {
  return String(name)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildApkFileName({ versionName, versionCode, webBuild, label }) {
  const parts = [
    "workwatch-ble-map",
    `v${slugVersionName(versionName)}`,
    `vc${versionCode}`,
    `web${webBuild}`,
  ];
  if (label) parts.push(label);
  return `${parts.join("-")}.apk`;
}

function archiveExistingApks() {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  if (!fs.existsSync(DIST_DIR)) return 0;
  let moved = 0;
  for (const name of fs.readdirSync(DIST_DIR)) {
    if (!name.startsWith("workwatch-ble-map") || !name.endsWith(".apk")) continue;
    const from = path.join(DIST_DIR, name);
    let to = path.join(ARCHIVE_DIR, name);
    if (fs.existsSync(to)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      to = path.join(ARCHIVE_DIR, name.replace(/\.apk$/, `_${stamp}.apk`));
    }
    fs.renameSync(from, to);
    console.log(`[mobile:apk] archive → ${path.relative(ROOT, to)}`);
    moved++;
  }
  return moved;
}

const { label } = parseArgs(process.argv.slice(2));
const { versionCode, versionName } = readAndroidVersion();
const webBuild = readWebBuild();
const outName = buildApkFileName({ versionName, versionCode, webBuild, label });
const DIST_OUT = path.join(DIST_DIR, outName);

const localProps = path.join(ANDROID, "local.properties");
if (!fs.existsSync(localProps)) {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    (process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk")
      : path.join(process.env.HOME || "", "Android", "Sdk"));
  if (!fs.existsSync(sdk)) {
    console.error(
      "Android SDK не найден. Установите SDK или создайте android/local.properties (см. local.properties.example)."
    );
    process.exit(1);
  }
  const escaped = sdk.replace(/\\/g, "\\\\");
  fs.writeFileSync(localProps, `sdk.dir=${escaped}\n`);
  console.log("[mobile:apk] wrote", localProps);
}

const javaHome =
  process.env.JAVA_HOME ||
  (process.platform === "win32"
    ? "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.10.7-hotspot"
    : "");

const gradlew =
  process.platform === "win32"
    ? path.join(ANDROID, "gradlew.bat")
    : path.join(ANDROID, "gradlew");

const env = { ...process.env };
if (javaHome && fs.existsSync(javaHome)) env.JAVA_HOME = javaHome;
if (process.env.ANDROID_HOME) env.ANDROID_HOME = process.env.ANDROID_HOME;
else if (fs.existsSync("C:\\Android\\Sdk")) env.ANDROID_HOME = "C:\\Android\\Sdk";

console.log(
  `[mobile:apk] version ${versionName} (${versionCode}), web ${webBuild}${label ? `, label ${label}` : ""}`
);
console.log("[mobile:apk] gradlew assembleDebug …");
const r = spawnSync(gradlew, ["assembleDebug", "--no-daemon"], {
  cwd: ANDROID,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (r.status !== 0) process.exit(r.status ?? 1);
if (!fs.existsSync(OUT_APK)) {
  console.error("[mobile:apk] APK not found:", OUT_APK);
  process.exit(1);
}

const archived = archiveExistingApks();
if (archived) console.log(`[mobile:apk] archived ${archived} previous APK(s)`);

fs.mkdirSync(DIST_DIR, { recursive: true });
fs.copyFileSync(OUT_APK, DIST_OUT);
const mb = (fs.statSync(DIST_OUT).size / (1024 * 1024)).toFixed(2);
console.log(`[mobile:apk] OK → ${DIST_OUT} (${mb} МБ)`);
