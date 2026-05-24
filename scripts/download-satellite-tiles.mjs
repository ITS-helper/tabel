#!/usr/bin/env node
/**
 * Скачивает спутниковые тайлы Esri для офлайн-APK (охват объекта СПГ).
 * Запуск: npm run mobile:tiles
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const META_PATH = path.join(ROOT, "data", "ble-satellite-tiles-meta.json");
const OUT_ROOT = path.join(ROOT, "assets", "tiles", "satellite");

const CONCURRENCY = 10;
const RETRIES = 3;

function lat2tile(lat, zoom) {
  return Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
      2) *
      2 ** zoom
  );
}

function lon2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function tileRange(meta, zoom) {
  const [minLat, minLng] = meta.southWest;
  const [maxLat, maxLng] = meta.northEast;
  const x0 = lon2tile(minLng, zoom);
  const x1 = lon2tile(maxLng, zoom);
  const y0 = lat2tile(maxLat, zoom);
  const y1 = lat2tile(minLat, zoom);
  const tiles = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) tiles.push({ z: zoom, x, y });
  }
  return tiles;
}

async function fetchTile(url, dest, attempt = 1) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 400) return "skip";
  const res = await fetch(url);
  if (!res.ok) {
    if (attempt < RETRIES) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
      return fetchTile(url, dest, attempt + 1);
    }
    throw new Error(`${res.status} ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 400) throw new Error(`empty ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return "ok";
}

async function runPool(items, worker, concurrency) {
  let i = 0;
  let ok = 0;
  let skip = 0;
  let fail = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      try {
        const r = await worker(item);
        if (r === "skip") skip++;
        else ok++;
      } catch (e) {
        fail++;
        console.warn("[tiles]", e.message || e);
      }
      if ((ok + skip + fail) % 200 === 0) {
        process.stdout.write(`\r[tiles] ${ok + skip + fail}/${items.length} (ok ${ok}, skip ${skip}, fail ${fail})`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => next()));
  process.stdout.write("\n");
  return { ok, skip, fail };
}

async function main() {
  if (!fs.existsSync(META_PATH)) throw new Error("missing ble-satellite-tiles-meta.json");
  const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
  const all = [];
  for (let z = meta.minZoom; z <= meta.maxZoom; z++) {
    all.push(...tileRange(meta, z));
  }
  console.log(`[tiles] ${all.length} tiles z${meta.minZoom}–${meta.maxZoom} → ${OUT_ROOT}`);
  const t0 = Date.now();
  const { ok, skip, fail } = await runPool(
    all,
    ({ z, x, y }) => {
      const url = meta.urlTemplate.replace("{z}", z).replace("{x}", x).replace("{y}", y);
      const dest = path.join(OUT_ROOT, String(z), String(x), `${y}.jpg`);
      return fetchTile(url, dest);
    },
    CONCURRENCY
  );
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[tiles] done in ${sec}s — new ${ok}, cached ${skip}, failed ${fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
