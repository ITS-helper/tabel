/**
 * Скачивает список BLE с API и сохраняет кэш для карты без VPN.
 * Запуск: node scripts/push-ble-cache.mjs
 * Транспорты (по очереди): Supabase ble-map-proxy → backend.vsm → Worker.
 * Опционально в Supabase DB (SUPABASE_SERVICE_ROLE_KEY):
 *   set SUPABASE_SERVICE_ROLE_KEY=... && node scripts/push-ble-cache.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const USER = process.env.BLE_AUTO_USER || "impl_dept";
const PASS = process.env.BLE_AUTO_PASS || "impl_dept_vsm_2024";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://owcuvcshwtivqueftiuk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const API_BASES = [
  {
    id: "supabase",
    base: `${SUPABASE_URL}/functions/v1/ble-map-proxy`,
  },
  {
    id: "backend",
    base: "https://backend.vsm.workwatch.pro",
  },
  {
    id: "worker",
    base: "https://raspy-sound-6f18.kejexu8hem1.workers.dev/proxy",
  },
];

async function apiFetch(base, apiPath, init = {}) {
  const res = await fetch(`${base}${apiPath}`, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${apiPath} HTTP ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    const text = await res.text();
    throw new Error(`${apiPath} not_json: ${text.slice(0, 80)}`);
  }
  return res.json();
}

async function fetchWithFailover(apiPath, init = {}) {
  let lastErr = null;
  for (const { id, base } of API_BASES) {
    try {
      const data = await apiFetch(base, apiPath, init);
      console.log(`[ble-cache] OK via ${id}: ${apiPath}`);
      return data;
    } catch (e) {
      lastErr = e;
      console.warn(`[ble-cache] ${id} fail:`, e.message || e);
    }
  }
  throw lastErr || new Error("all_transports_failed");
}

async function main() {
  const tokenBody = new URLSearchParams({
    username: USER,
    password: PASS,
  });
  const tok = await fetchWithFailover("/api/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });
  const token = tok.access_token || tok.accessToken || tok.token;
  if (!token) throw new Error("no_token");

  const auth = { Authorization: `Bearer ${token}` };
  const me = await fetchWithFailover("/api/v1/user/me/", { headers: auth });
  const companyId = me.companyId ?? me.company_id ?? 1;
  const payload = await fetchWithFailover(`/api/v1/map/ble/${companyId}`, { headers: auth });
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
    }),
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
