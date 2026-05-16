/**
 * Скачивает список BLE с Worker и сохраняет кэш для карты без VPN.
 * Запуск: node scripts/push-ble-cache.mjs
 * Опционально в Supabase (нужен SUPABASE_SERVICE_ROLE_KEY в env):
 *   set SUPABASE_SERVICE_ROLE_KEY=... && node scripts/push-ble-cache.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const WORKER = "https://raspy-sound-6f18.kejexu8hem1.workers.dev/proxy";
const USER = process.env.BLE_AUTO_USER || "impl_dept";
const PASS = process.env.BLE_AUTO_PASS || "impl_dept_vsm_2024";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://owcuvcshwtivqueftiuk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function workerFetch(path, init = {}) {
  const res = await fetch(`${WORKER}${path}`, init);
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const tokenBody = new URLSearchParams({
    username: USER,
    password: PASS,
  });
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
  const payload = await workerFetch(`/api/v1/map/ble/${companyId}`, { headers: auth });
  if (!Array.isArray(payload)) throw new Error("payload_not_array");

  const record = {
    company_id: companyId,
    updated_at: new Date().toISOString(),
    payload,
  };

  const outDir = path.join(ROOT, "data");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "ble-map-cache.json");
  fs.writeFileSync(outPath, JSON.stringify(record));
  console.log(`Wrote ${outPath} (${payload.length} markers, ${fs.statSync(outPath).size} bytes)`);

  const metaPath = path.join(outDir, "ble-map-cache-meta.json");
  fs.writeFileSync(
    metaPath,
    JSON.stringify({
      company_id: companyId,
      updated_at: record.updated_at,
      count: payload.length,
    })
  );
  console.log(`Wrote ${metaPath}`);

  if (SERVICE_KEY) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ble_map_cache`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Supabase upsert HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    console.log("Supabase ble_map_cache updated");
  } else {
    console.log("SUPABASE_SERVICE_ROLE_KEY not set — DB cache skipped");
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
