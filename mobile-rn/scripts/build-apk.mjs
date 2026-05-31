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

function run(cmd, args, cwd = root, env = process.env) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("[mobile-rn] sync ble cache asset…");
run("node", ["scripts/sync-ble-cache-asset.mjs"]);

console.log("[mobile-rn] prebuild android…");
run("npx", ["expo", "prebuild", "--platform", "android", "--clean"]);

const sdkProps = path.join(androidDir, "local.properties");
const parentSdk = path.join(root, "..", "android", "local.properties");
if (!fs.existsSync(sdkProps) && fs.existsSync(parentSdk)) {
  fs.copyFileSync(parentSdk, sdkProps);
  console.log("[mobile-rn] copied local.properties from Capacitor android/");
}

const gradleProps = path.join(androidDir, "gradle.properties");
if (fs.existsSync(gradleProps)) {
  let gp = fs.readFileSync(gradleProps, "utf8");
  gp = gp.replace(/newArchEnabled=false/g, "newArchEnabled=true");
  fs.writeFileSync(gradleProps, gp);
}

const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const debugMode = process.argv.includes("--debug");
const task = debugMode ? "assembleDebug" : "assembleRelease";
console.log(`[mobile-rn] ${task}…`);
run(gradlew, [task], androidDir, {
  ANDROID_HOME: process.env.ANDROID_HOME || "C:\\Android\\Sdk",
  ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || "C:\\Android\\Sdk",
});

const sub = debugMode ? "debug" : "release";
const apkName = debugMode ? "app-debug.apk" : "app-release.apk";
const apkSrc = path.join(androidDir, "app", "build", "outputs", "apk", sub, apkName);
if (!fs.existsSync(apkSrc)) {
  console.error("APK not found:", apkSrc);
  process.exit(1);
}

fs.mkdirSync(distDir, { recursive: true });
const label = debugMode ? "debug" : "release";
const version = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")).expo.version;
const out = path.join(distDir, `workwatch-ble-rn-v${version}-${label}.apk`);
fs.copyFileSync(apkSrc, out);
console.log("[mobile-rn] OK:", out);
