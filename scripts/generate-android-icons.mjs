#!/usr/bin/env node
/**
 * Иконки WORK WATCH из assets/workwatch-mark-source.png (WW-монограмма в шапке карты).
 * — assets/workwatch-mark.png (toolbar)
 * — assets/favicon-*.png, apple-touch-icon.png (сайт)
 * — android mipmap ic_launcher PNG (APK)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MARK_SRC = path.join(ROOT, "assets", "workwatch-mark-source.png");
const MARK_OUT = path.join(ROOT, "assets", "workwatch-mark.png");
const LAUNCHER_MASTER = path.join(ROOT, "assets", "app-icon-master.png");
const LAUNCHER_XXX = path.join(
  ROOT,
  "android",
  "app",
  "src",
  "main",
  "res",
  "mipmap-xxxhdpi",
  "ic_launcher.png"
);

/** @type {Record<string, number>} */
const LAUNCHER_SIZES = {
  "mipmap-mdpi": 48,
  "mipmap-hdpi": 72,
  "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144,
  "mipmap-xxxhdpi": 192,
};

const MASTER_SIZE = 512;
const LOGO_SCALE = 0.72;

async function loadTrimmedMark() {
  if (!fs.existsSync(MARK_SRC)) {
    throw new Error("Missing assets/workwatch-mark-source.png");
  }
  const { data, info } = await sharp(MARK_SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r >= 248 && g >= 248 && b >= 248) data[i + 3] = 0;
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).trim({ threshold: 1 });
}

async function buildMarkPng() {
  await (await loadTrimmedMark()).png().toFile(MARK_OUT);
  console.log("[icons] toolbar mark →", MARK_OUT);
}

async function buildLauncherMaster() {
  const trimmed = await loadTrimmedMark();
  const meta = await trimmed.metadata();
  const logoMax = Math.round(MASTER_SIZE * LOGO_SCALE);
  const logoW = meta.width || logoMax;
  const logoH = meta.height || logoMax;
  const scale = Math.min(logoMax / logoW, logoMax / logoH);
  const w = Math.max(1, Math.round(logoW * scale));
  const h = Math.max(1, Math.round(logoH * scale));
  const logo = await trimmed.resize(w, h, { fit: "inside" }).png().toBuffer();
  const left = Math.round((MASTER_SIZE - w) / 2);
  const top = Math.round((MASTER_SIZE - h) / 2);
  await sharp({
    create: {
      width: MASTER_SIZE,
      height: MASTER_SIZE,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: logo, left, top }])
    .png()
    .toFile(LAUNCHER_MASTER);
  fs.copyFileSync(LAUNCHER_MASTER, LAUNCHER_XXX);
  console.log("[icons] launcher master →", LAUNCHER_MASTER);
}

async function resizeLauncherFromMaster() {
  const master = sharp(LAUNCHER_MASTER);
  for (const [folder, size] of Object.entries(LAUNCHER_SIZES)) {
    const dir = path.join(ROOT, "android", "app", "src", "main", "res", folder);
    fs.mkdirSync(dir, { recursive: true });
    const png = await master.clone().resize(size, size, { fit: "fill" }).png().toBuffer();
    for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
      fs.writeFileSync(path.join(dir, name), png);
    }
    const fgSize = Math.round(size * (108 / 48));
    const trimmed = await loadTrimmedMark();
    const meta = await trimmed.metadata();
    const logoMax = Math.round(fgSize * LOGO_SCALE);
    const logoW = meta.width || logoMax;
    const logoH = meta.height || logoMax;
    const scale = Math.min(logoMax / logoW, logoMax / logoH);
    const w = Math.max(1, Math.round(logoW * scale));
    const h = Math.max(1, Math.round(logoH * scale));
    const logo = await trimmed.resize(w, h, { fit: "inside" }).png().toBuffer();
    const fg = await sharp({
      create: {
        width: fgSize,
        height: fgSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: logo, left: Math.round((fgSize - w) / 2), top: Math.round((fgSize - h) / 2) }])
      .png()
      .toBuffer();
    fs.writeFileSync(path.join(dir, "ic_launcher_foreground.png"), fg);
    console.log(`[icons] ${folder} ← ${size}px`);
  }
}

async function buildWebFavicons() {
  const assets = path.join(ROOT, "assets");
  const sizes = [
    ["favicon-32.png", 32],
    ["favicon-192.png", 192],
    ["apple-touch-icon.png", 180],
  ];
  for (const [name, size] of sizes) {
    const dest = path.join(assets, name);
    await sharp(LAUNCHER_MASTER).resize(size, size, { fit: "fill" }).png().toFile(dest);
    console.log(`[icons] web ${name} → ${size}px`);
  }
}

async function main() {
  await buildMarkPng();
  await buildLauncherMaster();
  await buildWebFavicons();
  await resizeLauncherFromMaster();
  console.log("[icons] done");
}

main().catch((e) => {
  console.error("[icons]", e?.message || e);
  process.exit(1);
});
