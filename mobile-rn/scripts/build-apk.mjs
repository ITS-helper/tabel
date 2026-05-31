#!/usr/bin/env node
/**
 * Сборка release APK для mobile-rn (отдельно от Capacitor android/).
 * Требует: Android SDK, JAVA_HOME, prebuild.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const androidDir = path.join(root, "android");
const distDir = path.join(root, "dist");

function run(cmd, args, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("[mobile-rn] prebuild android…");
run("npx", ["expo", "prebuild", "--platform", "android", "--clean"]);

const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
console.log("[mobile-rn] assembleRelease…");
run(gradlew, ["assembleRelease"], androidDir);

const apkSrc = path.join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
if (!fs.existsSync(apkSrc)) {
  console.error("APK not found:", apkSrc);
  process.exit(1);
}

fs.mkdirSync(distDir, { recursive: true });
const label = process.argv.includes("--debug") ? "debug" : "release";
const version = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")).expo.version;
const out = path.join(distDir, `workwatch-ble-rn-v${version}-${label}.apk`);
fs.copyFileSync(apkSrc, out);
console.log("[mobile-rn] OK:", out);
