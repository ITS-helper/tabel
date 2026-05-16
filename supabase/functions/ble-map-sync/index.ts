/**
 * Обновляет ble_map_cache из Worker API (запуск с сервера Supabase, не из браузера).
 * Секреты: BLE_AUTO_USER, BLE_AUTO_PASS (как в ble-map.js).
 * Вызов: POST …/functions/v1/ble-map-sync (после деплоя с --no-verify-jwt).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const UPSTREAM = "https://raspy-sound-6f18.kejexu8hem1.workers.dev/proxy";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function workerToken(user: string, pass: string): Promise<string> {
  const res = await fetch(`${UPSTREAM}/api/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`,
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}`);
  const data = await res.json();
  const token = data.accessToken || data.access_token || data.token;
  if (!token) throw new Error("no_token");
  return token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const user = Deno.env.get("BLE_AUTO_USER") ?? "impl_dept";
    const pass = Deno.env.get("BLE_AUTO_PASS") ?? "impl_dept_vsm_2024";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const token = await workerToken(user, pass);
    const meRes = await fetch(`${UPSTREAM}/api/v1/user/me/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) throw new Error(`user/me HTTP ${meRes.status}`);
    const me = await meRes.json();
    const companyId = me.companyId ?? me.company_id ?? 1;

    const bleRes = await fetch(`${UPSTREAM}/api/v1/map/ble/${companyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!bleRes.ok) throw new Error(`map/ble HTTP ${bleRes.status}`);
    const payload = await bleRes.json();
    if (!Array.isArray(payload)) throw new Error("payload_not_array");

    const sb = createClient(supabaseUrl, serviceKey);
    const { error } = await sb.from("ble_map_cache").upsert({
      company_id: companyId,
      payload,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;

    return new Response(
      JSON.stringify({
        ok: true,
        company_id: companyId,
        count: payload.length,
        updated_at: new Date().toISOString(),
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
