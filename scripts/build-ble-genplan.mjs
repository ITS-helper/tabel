/**
 * Генплан → растр для слоя карты BLE.
 * Привязка: растягиваем лист на bbox всех меток из data/ble-map-cache.json (+ отступ).
 *
 * Запуск: npm run ble-genplan
 *   BLE_GENPLAN_PDF — путь к PDF (по умолчанию — файл из Downloads)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CACHE_PATH = path.join(ROOT, "data", "ble-map-cache.json");
const OUT_DIR = path.join(ROOT, "data");
const OUT_PNG = path.join(OUT_DIR, "ble-genplan.png");
const OUT_JPG = path.join(OUT_DIR, "ble-genplan.jpg");
const OUT_META = path.join(OUT_DIR, "ble-genplan-meta.json");

const DEFAULT_PDF = path.join(
  process.env.USERPROFILE || "",
  "Downloads",
  "Telegram Desktop",
  "MFP-RD-(L0-00-000)-C 2030 (RU)_02.pdf"
);

const PAD_LAT = 0.0018;
const PAD_LNG = 0.0028;
const RENDER_WIDTH = 5200;
const JPEG_QUALITY = 86;

function findPdfPath() {
  if (process.env.BLE_GENPLAN_PDF && fs.existsSync(process.env.BLE_GENPLAN_PDF)) {
    return process.env.BLE_GENPLAN_PDF;
  }
  if (fs.existsSync(DEFAULT_PDF)) return DEFAULT_PDF;
  const tg = path.join(process.env.USERPROFILE || "", "Downloads", "Telegram Desktop");
  if (fs.existsSync(tg)) {
    const hit = fs
      .readdirSync(tg)
      .filter((n) => /\.pdf$/i.test(n) && /MFP-RD|L0-00-000|2030/i.test(n));
    if (hit[0]) return path.join(tg, hit[0]);
  }
  throw new Error(
    `PDF не найден. Укажите BLE_GENPLAN_PDF или положите файл в ${DEFAULT_PDF}`
  );
}

function loadMarkerBounds() {
  const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  const pts = raw.payload || [];
  const lats = [];
  const lngs = [];
  for (const p of pts) {
    const lat = Number(p.latitude);
    const lng = Number(p.longitude);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) > 10 &&
      Math.abs(lng) > 10
    ) {
      lats.push(lat);
      lngs.push(lng);
    }
  }
  if (!lats.length) throw new Error("В ble-map-cache.json нет координат меток");
  return {
    southWest: [Math.min(...lats) - PAD_LAT, Math.min(...lngs) - PAD_LNG],
    northEast: [Math.max(...lats) + PAD_LAT, Math.max(...lngs) + PAD_LNG],
    markerCount: lats.length,
  };
}

const POPPLER_VER = "25.12.0-0";
const POPPLER_ZIP = `Release-${POPPLER_VER}.zip`;
const POPPLER_URL = `https://github.com/oschwartz10612/poppler-windows/releases/download/v${POPPLER_VER}/${POPPLER_ZIP}`;
const TOOLS_DIR = path.join(__dirname, ".tools", "poppler");

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function findPdftoppm() {
  const candidates = [
    path.join(TOOLS_DIR, "Library", "bin", "pdftoppm.exe"),
    path.join(TOOLS_DIR, "poppler-25.12.0", "Library", "bin", "pdftoppm.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, name.name);
        if (name.isFile() && name.name.toLowerCase() === "pdftoppm.exe") return p;
        if (name.isDirectory()) {
          const hit = walk(p);
          if (hit) return hit;
        }
      }
      return null;
    };
    if (fs.existsSync(TOOLS_DIR)) {
      const hit = walk(TOOLS_DIR);
      if (hit) return hit;
    }
  } catch {
    /* ignore */
  }
  if (process.env.POPPLER_BIN) {
    const p = path.join(process.env.POPPLER_BIN, "pdftoppm.exe");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function ensurePdftoppm() {
  const existing = findPdftoppm();
  if (existing) return existing;
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  const zipPath = path.join(TOOLS_DIR, POPPLER_ZIP);
  console.log("[ble-genplan] скачивание Poppler…");
  await downloadFile(POPPLER_URL, zipPath);
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${TOOLS_DIR.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: "inherit" }
  );
  const bin = findPdftoppm();
  if (!bin) throw new Error("pdftoppm.exe не найден после распаковки Poppler");
  return bin;
}

async function renderPdfWithPoppler(pdfPath) {
  const pdftoppm = await ensurePdftoppm();
  const tmpDir = path.join(TOOLS_DIR, "tmp-render");
  fs.mkdirSync(tmpDir, { recursive: true });
  const prefix = path.join(tmpDir, "page");
  const dpi = 220;
  execFileSync(
    pdftoppm,
    ["-png", "-r", String(dpi), "-singlefile", "-f", "1", "-l", "1", pdfPath, prefix],
    { stdio: "inherit" }
  );
  const pngPath = `${prefix}.png`;
  if (!fs.existsSync(pngPath)) throw new Error(`не создан ${pngPath}`);
  const sharp = (await import("sharp")).default;
  const buf = await sharp(pngPath)
    .resize({ width: RENDER_WIDTH, withoutEnlargement: false })
    .png()
    .toBuffer();
  try {
    fs.unlinkSync(pngPath);
  } catch {
    /* ignore */
  }
  return buf;
}

async function renderPdf(pdfPath) {
  return renderPdfWithPoppler(pdfPath);
}

async function writeOutputs(pngBuf, meta) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PNG, pngBuf);
  const sharp = (await import("sharp")).default;
  await sharp(pngBuf).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(OUT_JPG);
  const useFile =
    fs.statSync(OUT_JPG).size < fs.statSync(OUT_PNG).size ? "ble-genplan.jpg" : "ble-genplan.png";
  meta.image = useFile;
  meta.version = 1;
  meta.updated_at = new Date().toISOString();
  meta.attribution = "Генплан L0 (привязка по меткам BLE)";
  meta.note =
    "Автопривязка по охвату меток; для сантиметровой точности нужна ручная коррекция в GIS.";
  fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2));
  console.log("bounds", meta.southWest, meta.northEast);
  console.log("image", useFile, "bytes", fs.statSync(path.join(OUT_DIR, useFile)).size);
  console.log("meta", OUT_META);
}

async function main() {
  const pdfPath = findPdfPath();
  console.log("pdf", pdfPath);
  const bounds = loadMarkerBounds();
  console.log("markers", bounds.markerCount);
  const pngBuf = await renderPdf(pdfPath);
  await writeOutputs(pngBuf, {
    southWest: bounds.southWest,
    northEast: bounds.northEast,
    source_pdf: path.basename(pdfPath),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
