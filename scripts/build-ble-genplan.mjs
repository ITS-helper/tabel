/**
 * Генплан → растр для слоя карты BLE.
 * Привязка: растягиваем лист на bbox всех меток из data/ble-map-cache.json (+ отступ).
 *
 * Запуск: npm run ble-genplan
 *   BLE_GENPLAN_DWG  — путь к DWG (приоритет по умолчанию)
 *   BLE_GENPLAN_PDF  — путь к PDF (запасной вариант)
 *   BLE_GENPLAN_SOURCE — auto | dwg | pdf
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync, spawnSync } from "child_process";
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

const TG_DIR = path.join(process.env.USERPROFILE || "", "Downloads", "Telegram Desktop");
const DEFAULT_PDF = path.join(TG_DIR, "MFP-RD-(L0-00-000)-C 2030 (RU)_02.pdf");
const DWG_NAME_RE = /РАЗБИВ|СПГ|SPG/i;

const PAD_LAT = 0.0018;
const PAD_LNG = 0.0028;
/** Ширина растра (DWG через SVG → resvg); для читаемого текста на зуме */
const RENDER_WIDTH = 14000;
const JPEG_QUALITY = 94;

const LIBREDWG_VER = "0.13.4";
const LIBREDWG_ZIP = `libredwg-${LIBREDWG_VER}-win64.zip`;
const LIBREDWG_URL = `https://github.com/LibreDWG/libredwg/releases/download/${LIBREDWG_VER}/${LIBREDWG_ZIP}`;
const LIBREDWG_TOOLS = path.join(__dirname, ".tools", "libredwg");

const POPPLER_VER = "25.12.0-0";
const POPPLER_ZIP = `Release-${POPPLER_VER}.zip`;
const POPPLER_URL = `https://github.com/oschwartz10612/poppler-windows/releases/download/v${POPPLER_VER}/${POPPLER_ZIP}`;
const POPPLER_TOOLS = path.join(__dirname, ".tools", "poppler");

function findInTree(dir, fileName) {
  if (!fs.existsSync(dir)) return null;
  const walk = (d) => {
    for (const name of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, name.name);
      if (name.isFile() && name.name.toLowerCase() === fileName.toLowerCase()) return p;
      if (name.isDirectory()) {
        const hit = walk(p);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(dir);
}

function findDwgPath() {
  if (process.env.BLE_GENPLAN_DWG && fs.existsSync(process.env.BLE_GENPLAN_DWG)) {
    return process.env.BLE_GENPLAN_DWG;
  }
  if (fs.existsSync(TG_DIR)) {
    const hits = fs
      .readdirSync(TG_DIR)
      .filter((n) => /\.dwg$/i.test(n) && DWG_NAME_RE.test(n));
    if (hits.length) return path.join(TG_DIR, hits[0]);
  }
  return null;
}

function findPdfPath() {
  if (process.env.BLE_GENPLAN_PDF && fs.existsSync(process.env.BLE_GENPLAN_PDF)) {
    return process.env.BLE_GENPLAN_PDF;
  }
  if (fs.existsSync(DEFAULT_PDF)) return DEFAULT_PDF;
  if (fs.existsSync(TG_DIR)) {
    const hit = fs
      .readdirSync(TG_DIR)
      .filter((n) => /\.pdf$/i.test(n) && /MFP-RD|L0-00-000|2030/i.test(n));
    if (hit[0]) return path.join(TG_DIR, hit[0]);
  }
  throw new Error(
    `PDF не найден. Укажите BLE_GENPLAN_PDF или положите файл в ${DEFAULT_PDF}`
  );
}

function resolveSourceMode() {
  const mode = (process.env.BLE_GENPLAN_SOURCE || "auto").toLowerCase();
  if (mode === "dwg" || mode === "pdf") return mode;
  return findDwgPath() ? "dwg" : "pdf";
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

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function ensureLibreDwg() {
  let exe = findInTree(LIBREDWG_TOOLS, "dwg2SVG.exe");
  if (exe) return exe;
  fs.mkdirSync(LIBREDWG_TOOLS, { recursive: true });
  const zipPath = path.join(LIBREDWG_TOOLS, LIBREDWG_ZIP);
  console.log("[ble-genplan] скачивание LibreDWG…");
  await downloadFile(LIBREDWG_URL, zipPath);
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${LIBREDWG_TOOLS.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: "inherit" }
  );
  exe = findInTree(LIBREDWG_TOOLS, "dwg2SVG.exe");
  if (!exe) throw new Error("dwg2SVG.exe не найден после распаковки LibreDWG");
  return exe;
}

function dwgToSvg(dwg2svgExe, dwgPath) {
  const tmpDir = path.join(LIBREDWG_TOOLS, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const svgPath = path.join(tmpDir, "genplan.svg");
  const errPath = path.join(tmpDir, "genplan.err.txt");

  const r = spawnSync(dwg2svgExe, ["--mspace", dwgPath], {
    encoding: "utf8",
    maxBuffer: 120 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.stderr) {
    try {
      fs.writeFileSync(errPath, r.stderr);
    } catch {
      /* ignore */
    }
    const warnLines = r.stderr.split(/\r?\n/).filter((l) => /UNKNOWN_ENT|warning/i.test(l));
    if (warnLines.length) {
      console.warn(`[ble-genplan] dwg2SVG: ${warnLines.length} предупреждений (см. ${errPath})`);
    }
  }
  if (r.status !== 0) {
    throw new Error(`dwg2SVG exit ${r.status}: ${(r.stderr || r.stdout || "").slice(0, 400)}`);
  }
  const svg = r.stdout;
  if (!svg || !/^\s*<\?xml|<\s*svg/i.test(svg)) {
    throw new Error("dwg2SVG не вернул валидный SVG");
  }
  fs.writeFileSync(svgPath, svg, "utf8");
  return svgPath;
}

async function renderDwg(dwgPath) {
  const dwg2svg = await ensureLibreDwg();
  console.log("[ble-genplan] DWG → SVG…");
  const svgPath = dwgToSvg(dwg2svg, dwgPath);
  console.log("[ble-genplan] SVG → PNG, width", RENDER_WIDTH);
  const { Resvg } = await import("@resvg/resvg-js");
  const svgBuf = fs.readFileSync(svgPath);
  const resvg = new Resvg(svgBuf, {
    fitTo: { mode: "width", value: RENDER_WIDTH },
    background: "white",
  });
  return resvg.render().asPng();
}

async function ensurePdftoppm() {
  let bin = findInTree(POPPLER_TOOLS, "pdftoppm.exe");
  if (bin) return bin;
  fs.mkdirSync(POPPLER_TOOLS, { recursive: true });
  const zipPath = path.join(POPPLER_TOOLS, POPPLER_ZIP);
  console.log("[ble-genplan] скачивание Poppler…");
  await downloadFile(POPPLER_URL, zipPath);
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${POPPLER_TOOLS.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: "inherit" }
  );
  bin = findInTree(POPPLER_TOOLS, "pdftoppm.exe");
  if (!bin) throw new Error("pdftoppm.exe не найден после распаковки Poppler");
  return bin;
}

async function renderPdf(pdfPath) {
  const pdftoppm = await ensurePdftoppm();
  const tmpDir = path.join(POPPLER_TOOLS, "tmp-render");
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

async function writeOutputs(pngBuf, meta) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PNG, pngBuf);
  const sharp = (await import("sharp")).default;
  await sharp(pngBuf)
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(OUT_JPG);
  const useFile = meta.source_dwg
    ? "ble-genplan.png"
    : fs.statSync(OUT_JPG).size < fs.statSync(OUT_PNG).size
      ? "ble-genplan.jpg"
      : "ble-genplan.png";
  meta.image = useFile;
  meta.version = 2;
  meta.render_width = RENDER_WIDTH;
  meta.updated_at = new Date().toISOString();
  meta.attribution = meta.source_dwg
    ? "Разбивочник СПГ (DWG, привязка по меткам BLE)"
    : "Генплан L0 (привязка по меткам BLE)";
  meta.note =
    "Автопривязка по охвату меток; для сантиметровой точности — подгонка генплана на карте.";
  fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2));
  const imgPath = path.join(OUT_DIR, useFile);
  const dim = await sharp(imgPath).metadata();
  console.log("bounds", meta.southWest, meta.northEast);
  console.log("image", useFile, dim.width, "×", dim.height, "bytes", fs.statSync(imgPath).size);
  console.log("meta", OUT_META);
}

async function main() {
  const mode = resolveSourceMode();
  const bounds = loadMarkerBounds();
  console.log("markers", bounds.markerCount);
  console.log("source mode", mode);

  let pngBuf;
  let meta = {
    southWest: bounds.southWest,
    northEast: bounds.northEast,
  };

  if (mode === "dwg") {
    const dwgPath = findDwgPath();
    if (!dwgPath) {
      throw new Error(
        "DWG не найден. Укажите BLE_GENPLAN_DWG или положите «РАЗБИВОЧНИК СПГ*.dwg» в Telegram Desktop"
      );
    }
    console.log("dwg", dwgPath);
    pngBuf = await renderDwg(dwgPath);
    meta.source_dwg = path.basename(dwgPath);
  } else {
    const pdfPath = findPdfPath();
    console.log("pdf", pdfPath);
    pngBuf = await renderPdf(pdfPath);
    meta.source_pdf = path.basename(pdfPath);
  }

  await writeOutputs(pngBuf, meta);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
