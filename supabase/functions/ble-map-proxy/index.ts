/**
 * Прокси API карты BLE → Cloudflare Worker (workers.dev).
 */
const UPSTREAM = "https://raspy-sound-6f18.kejexu8hem1.workers.dev/proxy";
const FN = "ble-map-proxy";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-ble-path, x-ble-token",
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

function buildUpstreamRequestHeaders(req: Request): Headers {
  const h = new Headers();
  const bleToken = req.headers.get("x-ble-token");
  if (bleToken) {
    h.set("Authorization", `Bearer ${bleToken}`);
  } else {
    const auth = req.headers.get("authorization");
    if (auth) h.set("Authorization", auth);
  }
  const ct = req.headers.get("content-type");
  if (ct) h.set("Content-Type", ct);
  return h;
}

function jsonError(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const path = apiPathFromRequest(req);
    const url = new URL(req.url);
    const target = `${UPSTREAM}${path}${url.search}`;

    const body =
      req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

    const upstreamRes = await fetch(target, {
      method: req.method,
      headers: buildUpstreamRequestHeaders(req),
      body,
    });

    const buf = await upstreamRes.arrayBuffer();
    const out = new Headers(cors);
    const ct = upstreamRes.headers.get("content-type");
    out.set("Content-Type", ct || "application/json");

    return new Response(buf, { status: upstreamRes.status, headers: out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("ble-map-proxy error:", msg, "path:", apiPathFromRequest(req));
    return jsonError(502, { error: "proxy_error", detail: msg });
  }
});
