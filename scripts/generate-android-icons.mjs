#!/usr/bin/env node
/**
 * Иконка Android из фирменного знака WW (assets/workwatch-icon*.svg).
 * Также: assets/workwatch-mark.png для шапки сайта/APK.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RES = path.join(ROOT, "android", "app", "src", "main", "res");

const ICON_SVG = path.join(ROOT, "assets", "workwatch-icon.svg");
const FG_SVG = path.join(ROOT, "assets", "workwatch-icon-foreground.svg");
const MARK_OUT = path.join(ROOT, "assets", "workwatch-mark.png");

/** @type {Record<string, { launcher: number; foreground: number }>} */
const DENSITIES = {
  "mipmap-mdpi": { launcher: 48, foreground: 108 },
  "mipmap-hdpi": { launcher: 72, foreground: 162 },
  "mipmap-xhdpi": { launcher: 96, foreground: 216 },
  "mipmap-xxhdpi": { launcher: 144, foreground: 324 },
  "mipmap-xxxhdpi": { launcher: 192, foreground: 432 },
};

function renderSvg(svgPath, size) {
  const svg = fs.readFileSync(svgPath, "utf8");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
  });
  return resvg.render().asPng();
}

async function writePng(dir, name, png) {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name);
  fs.writeFileSync(dest, png);
  return dest;
}

async function buildMarkPng() {
  const fg = renderSvg(FG_SVG, 256);
  const { data, info } = await sharp(fg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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

async function main() {
  if (!fs.existsSync(ICON_SVG) || !fs.existsSync(FG_SVG)) {
    throw new Error("Missing assets/workwatch-icon.svg or workwatch-icon-foreground.svg");
  }

  for (const [folder, sizes] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, folder);
    const launcher = renderSvg(ICON_SVG, sizes.launcher);
    const foreground = renderSvg(FG_SVG, sizes.foreground);
    await writePng(dir, "ic_launcher.png", launcher);
    await writePng(dir, "ic_launcher_round.png", launcher);
    await writePng(dir, "ic_launcher_foreground.png", foreground);
    console.log(`[icons] ${folder} → ${sizes.launcher}px / fg ${sizes.foreground}px`);
  }

  await buildMarkPng();
  console.log("[icons] done");
}

main().catch((e) => {
  console.error("[icons]", e?.message || e);
  process.exit(1);
});
