#!/usr/bin/env node
/**
 * Сборка debug APK (нужны Android SDK и JDK 21).
 * Результат: dist/workwatch-ble-map-debug.apk
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ANDROID = path.join(ROOT, "android");
const OUT_APK = path.join(
  ANDROID,
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk"
);
const DIST = path.join(ROOT, "dist", "workwatch-ble-map-debug.apk");

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

fs.mkdirSync(path.dirname(DIST), { recursive: true });
fs.copyFileSync(OUT_APK, DIST);
const mb = (fs.statSync(DIST).size / (1024 * 1024)).toFixed(2);
console.log(`[mobile:apk] OK → ${DIST} (${mb} МБ)`);
