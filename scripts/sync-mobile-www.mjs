#!/usr/bin/env node
/**
 * Сборка web-assets для Capacitor (APK): копирует BLE-карту в mobile/www.
 * Запуск: npm run mobile:sync
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "mobile", "www");
const VENDOR = path.join(OUT, "vendor");

function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

function vendorFromNode(rel, outName) {
  const src = path.join(ROOT, "node_modules", rel);
  if (!fs.existsSync(src)) {
    console.warn(`[mobile:sync] skip missing vendor: ${rel}`);
    return;
  }
  copyFile(src, path.join(VENDOR, outName || path.basename(rel)));
}

function patchHtml(html) {
  let out = html;
  out = out.replace(/<html lang="ru">/, '<html lang="ru" data-ww-native="1">');
  out = out.replace(
    /<title>.*?<\/title>/,
    "<title>WORK WATCH — Карта меток</title>"
  );
  out = out.replace(
    /href="https:\/\/fonts\.googleapis\.com\/css2[^"]+"/,
    'href="vendor/fonts.css"'
  );
  out = out.replace(
    /https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css/g,
    "vendor/leaflet.css"
  );
  out = out.replace(
    /https:\/\/unpkg\.com\/leaflet\.markercluster@1\.5\.3\/dist\/MarkerCluster\.css/g,
    "vendor/MarkerCluster.css"
  );
  out = out.replace(
    /https:\/\/unpkg\.com\/leaflet\.markercluster@1\.5\.3\/dist\/MarkerCluster\.Default\.css/g,
    "vendor/MarkerCluster.Default.css"
  );
  out = out.replace(/href="ble-map\.css\?[^"]+"/, 'href="ble-map.css"');
  out = out.replace(
    /https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js/g,
    "vendor/leaflet.js"
  );
  out = out.replace(
    /https:\/\/unpkg\.com\/leaflet-imageoverlay-rotated@0\.2\.0\/ImageOverlay\.Rotated\.js/g,
    "vendor/ImageOverlay.Rotated.js"
  );
  out = out.replace(
    /https:\/\/unpkg\.com\/leaflet\.markercluster@1\.5\.3\/dist\/leaflet\.markercluster\.js/g,
    "vendor/leaflet.markercluster.js"
  );
  out = out.replace(
    /https:\/\/cdn\.jsdelivr\.net\/npm\/fflate@0\.8\.2\/umd\/index\.min\.js[^"]*/g,
    "vendor/fflate.min.js"
  );
  out = out.replace(/src="ble-genplan-mask\.js\?[^"]+"/, 'src="ble-genplan-mask.js"');
  out = out.replace(/src="ble-map\.js\?[^"]+"/, 'src="ble-map.js"');
  out = out.replace(
    /src="ble-map-fullscreen-patch\.js\?[^"]+"/,
    'src="ble-map-fullscreen-patch.js"'
  );
  out = out.replace(
    /<a class="ble-map-page-back" href="index\.html" id="bleMapBackLink">← График<\/a>/,
    '<a class="ble-map-page-back" href="#" id="bleMapBackLink" hidden>← График</a>'
  );
  return out;
}

function writeMinimalFontsCss() {
  /* Офлайн-заглушка: системные шрифты вместо Google Fonts в APK */
  fs.writeFileSync(
    path.join(VENDOR, "fonts.css"),
    `/* mobile APK: системные шрифты вместо Google Fonts */
:root { --font-display: Oswald, "Segoe UI", sans-serif; --font-body: "Source Sans 3", system-ui, sans-serif; }
body { font-family: var(--font-body); }
`
  );
}

async function fetchVendor(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  console.log("[mobile:sync] →", OUT);
  rmDir(OUT);
  ensureDir(VENDOR);

  const srcHtml = path.join(ROOT, "ble-map.html");
  if (!fs.existsSync(srcHtml)) throw new Error("ble-map.html not found");
  fs.writeFileSync(path.join(OUT, "index.html"), patchHtml(fs.readFileSync(srcHtml, "utf8")));

  for (const f of [
    "ble-map.js",
    "ble-map.css",
    "ble-genplan-mask.js",
    "ble-map-fullscreen-patch.js",
  ]) {
    copyFile(path.join(ROOT, f), path.join(OUT, f));
  }

  copyDir(path.join(ROOT, "assets"), path.join(OUT, "assets"));

  ensureDir(path.join(OUT, "data"));
  for (const f of [
    "ble-genplan-meta.json",
    "ble-map-cache-meta.json",
    "ble-field-pack-meta.json",
  ]) {
    const p = path.join(ROOT, "data", f);
    if (fs.existsSync(p)) copyFile(p, path.join(OUT, "data", f));
  }
  const cache = path.join(ROOT, "data", "ble-map-cache.json");
  if (fs.existsSync(cache)) {
    console.log("[mobile:sync] ble-map-cache.json (fallback offline list)");
    copyFile(cache, path.join(OUT, "data", "ble-map-cache.json"));
  }

  vendorFromNode("leaflet/dist/leaflet.css", "leaflet.css");
  vendorFromNode("leaflet/dist/leaflet.js", "leaflet.js");
  vendorFromNode("leaflet.markercluster/dist/MarkerCluster.css", "MarkerCluster.css");
  vendorFromNode(
    "leaflet.markercluster/dist/MarkerCluster.Default.css",
    "MarkerCluster.Default.css"
  );
  vendorFromNode(
    "leaflet.markercluster/dist/leaflet.markercluster.js",
    "leaflet.markercluster.js"
  );
  vendorFromNode("fflate/umd/index.js", "fflate.min.js");

  const rotatedLocal = path.join(ROOT, "mobile", "vendor-cache", "ImageOverlay.Rotated.js");
  if (fs.existsSync(rotatedLocal)) {
    copyFile(rotatedLocal, path.join(VENDOR, "ImageOverlay.Rotated.js"));
  } else {
    console.log("[mobile:sync] fetch ImageOverlay.Rotated.js …");
    await fetchVendor(
      "https://unpkg.com/leaflet-imageoverlay-rotated@0.2.1/Leaflet.ImageOverlay.Rotated.js",
      path.join(VENDOR, "ImageOverlay.Rotated.js")
    );
    ensureDir(path.dirname(rotatedLocal));
    copyFile(path.join(VENDOR, "ImageOverlay.Rotated.js"), rotatedLocal);
  }

  writeMinimalFontsCss();

  console.log("[mobile:sync] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
