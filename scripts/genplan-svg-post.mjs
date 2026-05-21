/**
 * Постобработка SVG генплана: убрать стройсетку, обрезать поля, вставить подписи объектов.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

/** Расширенные названия (в DWG часто только код L03-…) */
export const GENPLAN_LABEL_TITLES = {
  "L03-93-010": "Насосная противопожарного водоснабжения",
  "L03-93-020": "Резервуар противопожарного запаса воды №1",
  "L03-93-030": "Резервуар противопожарного запаса воды №2",
  "L03-02-150_1": "Эстакада к объектам водоснабжения Участок 1",
  "L03-02-150_2": "Эстакада к объектам водоснабжения Участок 2",
};

/** Позиция подписи над объектом (dwg2SVG не выводит MTEXT с названием) */
const GENPLAN_LABEL_ANCHORS = {
  "L03-93-020": { x: 1088, y: 272 },
  "L03-93-030": { x: 1048, y: 272 },
  "L03-02-150_1": { x: 1040, y: 648 },
  "L03-02-150_2": { x: 1085, y: 648 },
  "L03-93-010": { x: 1060, y: 628 },
};

export function decodeXmlText(raw) {
  return String(raw || "")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function decodeMtextField(t) {
  return String(t || "")
    .replace(/\\P/g, "\n")
    .replace(/\\pxqc;/gi, "")
    .replace(/\{\\W[^;]*;([^}]*)\}/gi, "$1")
    .replace(/\{|\}/g, "")
    .trim();
}

function extractCode(text) {
  const m = text.match(/L03[\w-]+/i);
  return m ? m[0].replace(/_+$/, "") : "";
}

export function exportDwgMinJson(dwgPath, dwgreadExe, outPath) {
  if (fs.existsSync(outPath)) return outPath;
  const r = spawnSync(dwgreadExe, ["-O", "minJSON", "-o", outPath, dwgPath], {
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (r.status !== 0) {
    console.warn("[ble-genplan] dwgread minJSON failed", (r.stderr || "").toString().slice(0, 200));
    return null;
  }
  return outPath;
}

export function loadObjectLabels(jsonPath) {
  if (!jsonPath || !fs.existsSync(jsonPath)) return [];
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const objs = data.OBJECTS || [];
  const seen = new Set();
  const rows = [];
  for (const o of objs) {
    if (o.entity !== "MTEXT") continue;
    const code = extractCode(decodeMtextField(o.text));
    const title = GENPLAN_LABEL_TITLES[code];
    if (!title || seen.has(code)) continue;
    seen.add(code);
    const anchor = GENPLAN_LABEL_ANCHORS[code];
    const x = anchor?.x ?? o.ins_pt?.[0];
    const y = anchor?.y ?? (o.ins_pt?.[1] != null ? o.ins_pt[1] - 12 : null);
    if (x == null || y == null) continue;
    rows.push({ code, title, x, y, fontSize: 3.2 });
  }
  return rows;
}

export function isAxisOrServiceText(inner) {
  const t = decodeXmlText(inner);
  if (!t) return true;
  if (/^X=/.test(t) || /%%D/.test(t)) return true;
  if (t === "6000" || t === "3000" || t === "5300") return false;
  if (/^\d{1,2}$/.test(t)) return true;
  if (/^\d{1,2}\.\d$/.test(t)) return true;
  if (/^[A-ZА-ЯЁ]\.?\d?$/i.test(t) && t.length <= 4) return true;
  if (/^\\pxqc;/i.test(t)) return false;
  return false;
}

function pathBboxFromD(d) {
  const coords = [...String(d).matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map((m) => [
    +m[1],
    +m[2],
  ]);
  if (!coords.length) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, area: (maxX - minX) * (maxY - minY) };
}

function isGridLinePath(d, style) {
  const bb = pathBboxFromD(d);
  if (!bb) return false;
  const m = String(d).match(/^M\s*([\d.-]+),([\d.-]+)\s*L\s*([\d.-]+),([\d.-]+)\s*$/);
  if (!m) return false;
  const x1 = +m[1],
    y1 = +m[2],
    x2 = +m[3],
    y2 = +m[4];
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  if (dy < 0.05 && dx > 350) {
    const y = (y1 + y2) / 2;
    if (y < 150 || y > 870) return true;
  }
  if (dx < 0.05 && dy > 350) {
    const x = (x1 + x2) / 2;
    if (x < 150 || x > 1880) return true;
  }
  if (/stroke:black/i.test(style) && bb.area < 3 && (bb.maxX - bb.minX) < 1.5) return true;
  return false;
}

function isJunkPath(d, style) {
  if (/stroke:#414141/i.test(style)) {
    const bb = pathBboxFromD(d);
    if (bb && bb.maxX < 120 && bb.minY > 750) return true;
  }
  if (isGridLinePath(d, style)) return true;
  return false;
}

function expandBbox(b, bb, pad = 0) {
  if (!bb) return b;
  return {
    minX: Math.min(b.minX, bb.minX - pad),
    minY: Math.min(b.minY, bb.minY - pad),
    maxX: Math.max(b.maxX, bb.maxX + pad),
    maxY: Math.max(b.maxY, bb.maxY + pad),
  };
}

export function filterAndCropGenplanSvg(svg, labels, opts = {}) {
  const textColor = opts.textColor || "#16a34a";
  const lineColor = opts.lineColor || "#000000";
  let out = svg;

  out = out.replace(/<text\b[^>]*>[\s\S]*?<\/text>/gi, (chunk) => {
    const inner = chunk.replace(/<text[^>]*>/i, "").replace(/<\/text>/i, "");
    return isAxisOrServiceText(inner) ? "" : chunk;
  });

  out = out.replace(/<circle\b[^>]*\/>/gi, (chunk) => {
    const r = chunk.match(/\br="([^"]+)"/i);
    if (r && +r[1] < 1.2) return "";
    return chunk;
  });

  out = out.replace(/<path\b([^>]*)\sd="([^"]*)"([^>]*)>/gi, (full, pre, d, post) => {
    const style = `${pre}${post}`;
    if (isJunkPath(d, style)) return "";
    return full;
  });

  let bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const m of out.matchAll(/<path\b[^>]*\sd="([^"]+)"/gi)) {
    const bb = pathBboxFromD(m[1]);
    if (!bb || bb.area < 8) continue;
    if (bb.maxX < 120 || bb.minX > 1980) continue;
    if (bb.maxY < 180 || bb.minY > 980) continue;
    bbox = expandBbox(bbox, bb, 4);
  }
  for (const m of out.matchAll(/<circle\b[^>]*cx="([^"]+)"[^>]*cy="([^"]+)"[^>]*r="([^"]+)"/gi)) {
    if (+m[3] < 2) continue;
    bbox = expandBbox(bbox, {
      minX: +m[1] - +m[3],
      minY: +m[2] - +m[3],
      maxX: +m[1] + +m[3],
      maxY: +m[2] + +m[3],
    });
  }
  for (const lb of labels) {
    const titleW = (lb.title?.length || 0) * lb.fontSize * 0.55;
    bbox = expandBbox(bbox, {
      minX: lb.x - 20,
      minY: lb.y - lb.fontSize * 2.8,
      maxX: lb.x + Math.max(80, titleW),
      maxY: lb.y + 8,
    });
  }

  if (!Number.isFinite(bbox.minX)) {
    const vb = out.match(/viewBox="([^"]+)"/);
    if (vb) {
      const p = vb[1].split(/\s+/).map(Number);
      bbox = { minX: p[0], minY: p[1], maxX: p[0] + p[2], maxY: p[1] + p[3] };
    }
  }

  const pad = 35;
  const vb = `${bbox.minX - pad} ${bbox.minY - pad} ${bbox.maxX - bbox.minX + pad * 2} ${bbox.maxY - bbox.minY + pad * 2}`;
  out = out.replace(/viewBox="[^"]+"/, `viewBox="${vb}"`);

  const labelSvg = labels
    .map((lb) => {
      const lines = [lb.code];
      if (lb.title) lines.push(lb.title);
      const tspans = lines
        .map((line, i) => {
          const esc = line.replace(/&/g, "&amp;").replace(/</g, "&lt;");
          return i === 0
            ? `<tspan x="${lb.x}" y="${lb.y}">${esc}</tspan>`
            : `<tspan x="${lb.x}" dy="${lb.fontSize * 1.15}">${esc}</tspan>`;
        })
        .join("");
      return `<text font-family="Arial,sans-serif" font-size="${lb.fontSize}" fill="${textColor}" text-anchor="start">${tspans}</text>`;
    })
    .join("\n");

  out = out.replace(
    /<\/svg>\s*$/i,
    `<g id="genplan-object-labels">\n${labelSvg}\n</g>\n</svg>`
  );

  out = out.replace(/stroke:\s*green\b/gi, `stroke:${textColor}`);
  out = out.replace(/stroke:#414141\b/gi, `stroke:${lineColor}`);
  out = out.replace(/stroke:\s*black\b/gi, `stroke:${lineColor}`);
  out = out.replace(/stroke-width:\s*0(?:\.0+)?px/gi, "stroke-width:0.12px");

  return { svg: out, bbox };
}
