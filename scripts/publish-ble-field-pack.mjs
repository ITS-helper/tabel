import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ZIP_PATH = path.join(ROOT, "data", "ble-field-pack.zip");
const META_PATH = path.join(ROOT, "data", "ble-field-pack-meta.json");
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const TAG = process.env.BLE_FIELD_PACK_RELEASE_TAG || "ble-pack-latest";
const RELEASE_NAME = process.env.BLE_FIELD_PACK_RELEASE_NAME || "BLE field pack (latest)";
const ASSET_NAME = process.env.BLE_FIELD_PACK_ASSET_NAME || "ble-field-pack.zip";

function requireEnv(value, name) {
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function gh(pathname, init = {}) {
  const repo = requireEnv(REPO, "GITHUB_REPOSITORY");
  const token = requireEnv(TOKEN, "GITHUB_TOKEN");
  const res = await fetch(`https://api.github.com/repos/${repo}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "workwatch-ble-field-pack",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GitHub API ${pathname} HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

async function getOrCreateRelease() {
  try {
    const res = await gh(`/releases/tags/${encodeURIComponent(TAG)}`);
    return res.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("HTTP 404")) throw e;
  }

  const res = await gh("/releases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: TAG,
      name: RELEASE_NAME,
      draft: false,
      prerelease: false,
      generate_release_notes: false,
      body: "Auto-refreshed BLE offline field pack for site/APK bootstrap.",
    }),
  });
  return res.json();
}

async function deleteExistingAsset(release, name) {
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item?.name === name)
    : null;
  if (!asset?.id) return;
  await gh(`/releases/assets/${asset.id}`, { method: "DELETE" });
}

async function uploadAsset(release) {
  const token = requireEnv(TOKEN, "GITHUB_TOKEN");
  const zip = fs.readFileSync(ZIP_PATH);
  const uploadUrl = String(release.upload_url || "").replace(/\{.*$/, "");
  if (!uploadUrl) throw new Error("Release has no upload_url");

  const res = await fetch(`${uploadUrl}?name=${encodeURIComponent(ASSET_NAME)}`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "workwatch-ble-field-pack",
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
    },
    body: zip,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GitHub asset upload HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

function updateMeta(packUrl) {
  const meta = readJson(META_PATH);
  meta.packUrl = packUrl;
  meta.releaseTag = TAG;
  fs.writeFileSync(META_PATH, `${JSON.stringify(meta, null, 2)}\n`);
}

async function main() {
  if (!fs.existsSync(ZIP_PATH)) throw new Error(`Missing zip: ${ZIP_PATH}`);
  if (!fs.existsSync(META_PATH)) throw new Error(`Missing meta: ${META_PATH}`);

  const release = await getOrCreateRelease();
  await deleteExistingAsset(release, ASSET_NAME);
  const asset = await uploadAsset(release);
  const packUrl = asset.browser_download_url || asset.url;
  if (!packUrl) throw new Error("Upload succeeded but browser_download_url is missing");
  updateMeta(packUrl);
  console.log(`Field pack uploaded: ${packUrl}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
