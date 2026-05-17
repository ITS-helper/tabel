/**
 * Сборка офлайн-пакета для карты BLE (один .zip для телефона).
 * Запуск: npm run ble-field-pack
 *   --tag-only   только фото метки (меньший архив)
 * Без VPN нужен доступ к workers.dev. Результат: data/ble-field-pack.zip + meta.json
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { zipSync, strToU8 } from "fflate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const WORKER = "https://raspy-sound-6f18.kejexu8hem1.workers.dev/proxy";
const USER = process.env.BLE_AUTO_USER || "impl_dept";
const PASS = process.env.BLE_AUTO_PASS || "impl_dept_vsm_2024";
const TAG_ONLY = process.argv.includes("--tag-only");
const CONCURRENCY = Number(process.env.BLE_PACK_CONCURRENCY || 12) || 12;
const MAX_PHOTO_BYTES = 2.5 * 1024 * 1024;

const PHOTO_TAG_KEYS = ["ble_image_url", "bleImageUrl", "ble_image"];
const PHOTO_PLACE_KEYS = ["location_image_url", "locationImageUrl", "location_image"];

function pickUrl(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function isExpired(url) {
  try {
    const u = new URL(url);
    const exp = u.searchParams.get("Expires") || u.searchParams.get("expires");
    if (!exp) return false;
    return Number(exp) * 1000 < Date.now() + 60_000;
  } catch {
    return false;
  }
}

function photoFileKey(url) {
  return createHash("sha1").update(url).digest("hex").slice(0, 20) + ".jpg";
}

function slimPoint(p) {
  if (!p) return null;
  return {
    id: p.id,
    ble_number: p.ble_number ?? p.bleNumber,
    latitude: p.latitude,
    longitude: p.longitude,
    name_extended: p.name_extended,
    charge_value: p.charge_value,
    record_dt: p.record_dt,
    location_desc: p.location_desc,
    ble_type_desc: p.ble_type_desc,
    mac_address: p.mac_address,
    ble_image_url: p.ble_image_url,
    bleImageUrl: p.bleImageUrl,
    ble_image: p.ble_image,
    location_image_url: p.location_image_url,
    locationImageUrl: p.locationImageUrl,
    location_image: p.location_image,
    bleRoute: p.bleRoute,
    ble_zone_id: p.ble_zone_id ?? p.ble_zoneId,
  };
}

function collectUrls(raw) {
  const urls = new Set();
  for (const p of raw) {
    const tag = pickUrl(p, PHOTO_TAG_KEYS);
    if (tag && !isExpired(tag)) urls.add(tag);
    if (!TAG_ONLY) {
      const place = pickUrl(p, PHOTO_PLACE_KEYS);
      if (place && !isExpired(place)) urls.add(place);
    }
  }
  return [...urls];
}

async function workerFetch(path, init = {}) {
  const res = await fetch(`${WORKER}${path}`, init);
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json();
}

async function maybeCompress(buf) {
  if (buf.length < 100 * 1024) return buf;
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(buf)
      .resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 76 })
      .toBuffer();
  } catch {
    return buf.length <= MAX_PHOTO_BYTES ? buf : null;
  }
}

async function fetchPhoto(url, token) {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_PHOTO_BYTES) {
    const smaller = await maybeCompress(buf);
    if (!smaller) throw new Error("too_large");
    buf = smaller;
  } else {
    const smaller = await maybeCompress(buf);
    if (smaller) buf = smaller;
  }
  return buf;
}

async function poolMap(items, limit, fn) {
  const queue = [...items];
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await fn(item, i++);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const tokenBody = new URLSearchParams({ username: USER, password: PASS });
  const tok = await workerFetch("/api/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });
  const token = tok.access_token || tok.accessToken || tok.token;
  if (!token) throw new Error("no_token");
  const auth = { Authorization: `Bearer ${token}` };

  const me = await workerFetch("/api/v1/user/me/", { headers: auth });
  const companyId = me.companyId ?? me.company_id ?? 1;
  const raw = await workerFetch(`/api/v1/map/ble/${companyId}`, { headers: auth });
  if (!Array.isArray(raw) || !raw.length) throw new Error("empty_ble_list");

  const slim = raw.map(slimPoint).filter(Boolean);
  const urls = collectUrls(raw);
  if (!urls.length) throw new Error("no_photo_urls_in_api");

  console.log(
    `Markers: ${slim.length}, photos to fetch: ${urls.length} (${TAG_ONLY ? "tag only" : "tag + place"})`
  );

  const photoIndex = {};
  const zipEntries = {};
  let photosOk = 0;
  let photosFail = 0;
  let bytesTotal = 0;
  let done = 0;

  await poolMap(urls, CONCURRENCY, async (url) => {
    try {
      const buf = await fetchPhoto(url, token);
      const name = `p/${photoFileKey(url)}`;
      zipEntries[name] = new Uint8Array(buf);
      photoIndex[url] = name;
      photosOk++;
      bytesTotal += buf.length;
    } catch (e) {
      photosFail++;
      console.warn("photo fail", url.slice(0, 70), e?.message || e);
    }
    done++;
    if (done % 25 === 0 || done === urls.length) {
      console.log(`  ${done}/${urls.length} (${photosOk} ok, ${(bytesTotal / (1024 * 1024)).toFixed(1)} MB)`);
    }
  });

  if (photosOk < 1) throw new Error("no_photos_downloaded");

  const savedAt = new Date().toISOString();
  const packMeta = {
    format: "ww-ble-field-zip",
    version: 3,
    companyId,
    savedAt,
    tagOnly: TAG_ONLY,
    markerCount: slim.length,
    photosOk,
    photosFail,
    bytesTotal,
    photoIndex,
  };

  zipEntries["meta.json"] = strToU8(JSON.stringify(packMeta));
  zipEntries["markers.json"] = strToU8(JSON.stringify(slim));

  const zipped = zipSync(zipEntries, { level: 6 });
  const outDir = path.join(ROOT, "data");
  fs.mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(outDir, "ble-field-pack.zip");
  fs.writeFileSync(zipPath, zipped);

  const metaPath = path.join(outDir, "ble-field-pack-meta.json");
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        packUrl: "data/ble-field-pack.zip",
        updated_at: savedAt,
        company_id: companyId,
        markerCount: slim.length,
        photosOk,
        photosFail,
        bytesTotal: zipped.length,
        zipBytes: zipped.length,
        tagOnly: TAG_ONLY,
      },
      null,
      2
    )
  );

  console.log(`Wrote ${zipPath} (${(zipped.length / (1024 * 1024)).toFixed(1)} MB zip)`);
  console.log(`Wrote ${metaPath}`);
  console.log(`Photos: ${photosOk}/${urls.length} ok, ${photosFail} failed`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
