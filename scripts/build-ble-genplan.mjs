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
const RENDER_WIDTH = 24000;
const JPEG_QUALITY = 96;
const GENPLAN_TILE_MIN_Z = 19;
const GENPLAN_TILE_MAX_Z = 20;
const GENPLAN_TILE_SIZE = 256;
const BUILD_TILES = process.env.BLE_GENPLAN_TILES === "1";
/** Цвета растра из DWG (SVG → PNG) */
const GENPLAN_TEXT_COLOR = process.env.BLE_GENPLAN_TEXT_COLOR || "#16a34a";
const GENPLAN_LINE_COLOR = process.env.BLE_GENPLAN_LINE_COLOR || "#000000";
const GENPLAN_TRANSPARENT = process.env.BLE_GENPLAN_TRANSPARENT !== "0";
const GENPLAN_OUT = process.env.BLE_GENPLAN_OUT || "";

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

function styleGenplanSvg(svg) {
  let out = svg;
  out = out.replace(
    /(<text\b[^>]*?\s)fill="(?:black|#000000|#000)"/gi,
    `$1fill="${GENPLAN_TEXT_COLOR}"`
  );
  out = out.replace(
    /(<text\b[^>]*?)style="([^"]*)"/gi,
    (_, open, style) =>
      `${open}style="${style
        .replace(/\bfill\s*:\s*(?:black|#000000|#000)\b/gi, `fill:${GENPLAN_TEXT_COLOR}`)
        .replace(/\bstroke\s*:\s*[^;"]+/gi, (m) =>
          /none/i.test(m) ? m : `stroke:${GENPLAN_LINE_COLOR}`
        )}"`
  );
  out = out.replace(/stroke:\s*black\b/gi, `stroke:${GENPLAN_LINE_COLOR}`);
  out = out.replace(/stroke-width:\s*0(?:\.0+)?px/gi, "stroke-width:0.1px");
  out = out.replace(/fill:\s*black\b/gi, (m, offset) => {
    const before = out.slice(Math.max(0, offset - 80), offset);
    return /<text\b/i.test(before) ? `fill:${GENPLAN_TEXT_COLOR}` : `fill:${GENPLAN_LINE_COLOR}`;
  });
  return out;
}

async function renderDwg(dwgPath) {
  const dwg2svg = await ensureLibreDwg();
  console.log("[ble-genplan] DWG → SVG…");
  const svgPath = dwgToSvg(dwg2svg, dwgPath);
  console.log("[ble-genplan] стили: линии", GENPLAN_LINE_COLOR, "текст", GENPLAN_TEXT_COLOR);
  console.log("[ble-genplan] SVG → PNG, width", RENDER_WIDTH, GENPLAN_TRANSPARENT ? "(прозрачный фон)" : "");
  const { Resvg } = await import("@resvg/resvg-js");
  const svgRaw = fs.readFileSync(svgPath, "utf8");
  const svgStyled = styleGenplanSvg(svgRaw);
  fs.writeFileSync(svgPath.replace(/\.svg$/i, ".styled.svg"), svgStyled, "utf8");
  const resvg = new Resvg(Buffer.from(svgStyled, "utf8"), {
    fitTo: { mode: "width", value: RENDER_WIDTH },
    background: GENPLAN_TRANSPARENT ? "transparent" : "white",
  });
  let pngBuf = resvg.render().asPng();
  pngBuf = await postProcessGenplanPng(pngBuf);
  return pngBuf;
}

/** Прозрачный фон; серый antialias → чистый чёрный / зелёный */
async function postProcessGenplanPng(pngBuf) {
  const sharp = (await import("sharp")).default;
  const [tr, tg, tb] = [0x16, 0xa3, 0x4a];
  const { data, info } = await sharp(pngBuf, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 24) {
      data[i + 3] = 0;
      continue;
    }
    if (g > 50 && g > r + 12 && g > b + 8) {
      data[i] = tr;
      data[i + 1] = tg;
      data[i + 2] = tb;
      data[i + 3] = 255;
    } else if (r + g + b < 520) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    } else {
      data[i + 3] = 0;
    }
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
    limitInputPixels: false,
  })
    .png({ compressionLevel: 6 })
    .toBuffer();
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

function lngToWorldPx(lng, z) {
  return ((lng + 180) / 360) * GENPLAN_TILE_SIZE * 2 ** z;
}

function latToWorldPx(lat, z) {
  const r = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * GENPLAN_TILE_SIZE * 2 ** z
  );
}

async function buildGenplanTiles(pngPath, meta) {
  const sharp = (await import("sharp")).default;
  const im = sharp(pngPath, { limitInputPixels: false });
  const info = await im.metadata();
  const [south, west] = meta.southWest;
  const [north, east] = meta.northEast;
  const tilesRoot = path.join(OUT_DIR, "ble-genplan-tiles");
  if (fs.existsSync(tilesRoot)) {
    fs.rmSync(tilesRoot, { recursive: true, force: true });
  }
  let tileCount = 0;
  for (let z = GENPLAN_TILE_MIN_Z; z <= GENPLAN_TILE_MAX_Z; z++) {
    const imgWx0 = lngToWorldPx(west, z);
    const imgWx1 = lngToWorldPx(east, z);
    const imgWy0 = latToWorldPx(north, z);
    const imgWy1 = latToWorldPx(south, z);
    const imgW = imgWx1 - imgWx0;
    const imgH = imgWy1 - imgWy0;
    if (imgW <= 0 || imgH <= 0) continue;
    const x0 = Math.floor(imgWx0 / GENPLAN_TILE_SIZE);
    const x1 = Math.floor((imgWx1 - 1) / GENPLAN_TILE_SIZE);
    const y0 = Math.floor(imgWy0 / GENPLAN_TILE_SIZE);
    const y1 = Math.floor((imgWy1 - 1) / GENPLAN_TILE_SIZE);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const tWx0 = x * GENPLAN_TILE_SIZE;
        const tWy0 = y * GENPLAN_TILE_SIZE;
        const tWx1 = tWx0 + GENPLAN_TILE_SIZE;
        const tWy1 = tWy0 + GENPLAN_TILE_SIZE;
        const ix0 = Math.max(0, Math.floor(((tWx0 - imgWx0) / imgW) * info.width));
        const iy0 = Math.max(0, Math.floor(((tWy0 - imgWy0) / imgH) * info.height));
        const ix1 = Math.min(info.width, Math.ceil(((tWx1 - imgWx0) / imgW) * info.width));
        const iy1 = Math.min(info.height, Math.ceil(((tWy1 - imgWy0) / imgH) * info.height));
        if (ix1 <= ix0 || iy1 <= iy0) continue;
        const cropW = ix1 - ix0;
        const cropH = iy1 - iy0;
        const tileBuf = await im
          .clone()
          .extract({ left: ix0, top: iy0, width: cropW, height: cropH })
          .resize(GENPLAN_TILE_SIZE, GENPLAN_TILE_SIZE, { fit: "fill" })
          .png({ compressionLevel: 6 })
          .toBuffer();
        const dir = path.join(tilesRoot, String(z), String(x));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${y}.png`), tileBuf);
        tileCount++;
      }
    }
  }
  return { tilesRoot, tileCount };
}

async function writeOutputs(pngBuf, meta) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PNG, pngBuf);
  if (GENPLAN_OUT) {
    fs.mkdirSync(path.dirname(GENPLAN_OUT), { recursive: true });
    fs.writeFileSync(GENPLAN_OUT, pngBuf);
    console.log("extra out", GENPLAN_OUT);
  }
  const sharp = (await import("sharp")).default;
  await sharp(pngBuf, { limitInputPixels: false })
    .flatten({ background: "#ffffff" }) // JPG — белый фон; PNG остаётся прозрачным
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(OUT_JPG);
  const useFile = meta.source_dwg
    ? "ble-genplan.png"
    : fs.statSync(OUT_JPG).size < fs.statSync(OUT_PNG).size
      ? "ble-genplan.jpg"
      : "ble-genplan.png";
  meta.image = useFile;
  meta.version = 3;
  meta.render_width = RENDER_WIDTH;
  meta.updated_at = new Date().toISOString();
  meta.attribution = meta.source_dwg
    ? "Разбивочник СПГ (DWG, привязка по меткам BLE)"
    : "Генплан L0 (привязка по меткам BLE)";
  meta.note =
    "Автопривязка по охвату меток; для сантиметровой точности — подгонка генплана на карте.";

  if (meta.source_dwg && BUILD_TILES) {
    const { tileCount } = await buildGenplanTiles(OUT_PNG, meta);
    meta.tiles = true;
    meta.tileUrl = "data/ble-genplan-tiles/{z}/{x}/{y}.png";
    meta.tileMinZoom = GENPLAN_TILE_MIN_Z;
    meta.tileMaxZoom = GENPLAN_TILE_MAX_Z;
    meta.tileCount = tileCount;
    console.log("tiles", tileCount, "z", GENPLAN_TILE_MIN_Z, "-", GENPLAN_TILE_MAX_Z);
  }

  fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2));
  const imgPath = path.join(OUT_DIR, useFile);
  const dim = await sharp(imgPath, { limitInputPixels: false }).metadata();
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
