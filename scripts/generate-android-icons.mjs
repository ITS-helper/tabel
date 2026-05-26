#!/usr/bin/env node
/**
 * Toolbar mark из assets/workwatch-mark-source.png (логотип WW для шапки).
 * Иконки лаунчера Android — готовые PNG в android/.../mipmap-* (не перегенерировать из SVG).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MARK_SRC = path.join(ROOT, "assets", "workwatch-mark-source.png");
const MARK_OUT = path.join(ROOT, "assets", "workwatch-mark.png");
const LAUNCHER_MASTER = path.join(
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

async function buildMarkPng() {
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
  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .trim({ threshold: 1 })
    .png()
    .toFile(MARK_OUT);
  console.log("[icons] toolbar mark →", MARK_OUT);
}

async function resizeLauncherFromMaster() {
  if (!fs.existsSync(LAUNCHER_MASTER)) {
    throw new Error(`Missing launcher master: ${LAUNCHER_MASTER}`);
  }
  for (const [folder, size] of Object.entries(LAUNCHER_SIZES)) {
    const dir = path.join(ROOT, "android", "app", "src", "main", "res", folder);
    const png = await sharp(LAUNCHER_MASTER).resize(size, size, { fit: "fill" }).png().toBuffer();
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
      fs.writeFileSync(path.join(dir, name), png);
    }
    const fgSize = Math.round(size * (108 / 48));
    const fg = await sharp(LAUNCHER_MASTER)
      .resize(fgSize, fgSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    fs.writeFileSync(path.join(dir, "ic_launcher_foreground.png"), fg);
    console.log(`[icons] ${folder} ← master ${size}px`);
  }
}

async function buildWebFavicons() {
  if (!fs.existsSync(LAUNCHER_MASTER)) {
    console.warn("[icons] нет launcher master — пропуск favicon для сайта");
    return;
  }
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
  const launcher = process.argv.includes("--launcher");
  await buildMarkPng();
  await buildWebFavicons();
  if (launcher) {
    await resizeLauncherFromMaster();
  } else {
    console.log("[icons] launcher PNGs не тронуты (добавьте --launcher для масштабирования из xxxhdpi)");
  }
  console.log("[icons] done");
}

main().catch((e) => {
  console.error("[icons]", e?.message || e);
  process.exit(1);
});
