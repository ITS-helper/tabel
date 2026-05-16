/**
 * Прокси API карты BLE → Cloudflare Worker (workers.dev).
 * Нужен, если в сети без VPN заблокирован *.workers.dev, а supabase.co доступен.
 *
 * Деплой (один раз, из корня репозитория с установленным Supabase CLI):
 *   supabase functions deploy ble-map-proxy --no-verify-jwt
 */
const UPSTREAM = "https://raspy-sound-6f18.kejexu8hem1.workers.dev/proxy";
const FN = "ble-map-proxy";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-ble-path",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

function apiPathFromRequest(req: Request): string {
  const url = new URL(req.url);
  const fromHeader = req.headers.get("x-ble-path");
  if (fromHeader && fromHeader.startsWith("/")) return fromHeader;

  let p = url.pathname;
  const marker = `/${FN}`;
  const i = p.indexOf(marker);
  if (i >= 0) p = p.slice(i + marker.length);
  if (!p || p === "/") {
    const q = url.searchParams.get("path");
    if (q && q.startsWith("/")) return q;
    return "/";
  }
  return p.startsWith("/") ? p : `/${p}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const path = apiPathFromRequest(req);
  const url = new URL(req.url);
  const target = `${UPSTREAM}${path}${url.search}`;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("x-ble-path");

  const body =
    req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(target, { method: req.method, headers, body });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: "upstream_unreachable", detail: msg }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const out = new Headers(upstreamRes.headers);
  for (const [k, v] of Object.entries(cors)) out.set(k, v);

  return new Response(upstreamRes.body, { status: upstreamRes.status, headers: out });
});
