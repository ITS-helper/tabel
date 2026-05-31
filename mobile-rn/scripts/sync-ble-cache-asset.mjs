#!/usr/bin/env node
/** Копирует data/ble-map-cache.json → mobile-rn/assets/ для офлайн-снимка в APK. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "..", "data", "ble-map-cache.json");
const destDir = path.join(root, "assets");
const dest = path.join(destDir, "ble-map-cache.json");

if (!fs.existsSync(src)) {
  console.warn("[sync-ble-cache] skip: no", src);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
const stat = fs.statSync(dest);
console.log("[sync-ble-cache] OK:", dest, `(${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
