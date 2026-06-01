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
  h.set("Accept", req.headers.get("accept") || "application/json,*/*");
  h.set("Accept-Encoding", "identity");
  h.set(
    "User-Agent",
    req.headers.get("user-agent") ||
      "Mozilla/5.0 (compatible; WorkWatchBleProxy/1.0; +supabase.edge)"
  );
  h.set("Origin", "https://its-helper.github.io");
  h.set("Referer", "https://its-helper.github.io/");
  return h;
}

function jsonError(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function isAllowedPhotoHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h.includes("storage.yandexcloud.net") || h.endsWith(".yandexcloud.net");
}

/** Офлайн-пакет .zip с GitHub Releases (обход CORS для its-helper.github.io). */
function isAllowedFieldPackUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "github.com") {
      return /\/ITS-helper\/tabel\/releases\/download\//i.test(u.pathname);
    }
    if (h === "objects.githubusercontent.com") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const path = apiPathFromRequest(req);
    const url = new URL(req.url);

    if (path === "/field-pack") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return jsonError(405, { error: "method_not_allowed" });
      }
      const packUrl = url.searchParams.get("url");
      if (!packUrl) return jsonError(400, { error: "missing_url" });
      if (!isAllowedFieldPackUrl(packUrl)) {
        return jsonError(403, { error: "pack_url_not_allowed" });
      }
      const packRes = await fetch(packUrl, { redirect: "follow" });
      const out = new Headers(cors);
      out.set("Content-Type", packRes.headers.get("content-type") || "application/zip");
      const cl = packRes.headers.get("content-length");
      if (cl) out.set("Content-Length", cl);
      out.set("Cache-Control", "public, max-age=3600");
      return new Response(req.method === "HEAD" ? null : packRes.body, {
        status: packRes.status,
        headers: out,
      });
    }

    if (path === "/ble-image" || path.startsWith("/ble-image/")) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return jsonError(405, { error: "method_not_allowed" });
      }
      const imgUrl = url.searchParams.get("url");
      if (!imgUrl) return jsonError(400, { error: "missing_url" });
      let parsed: URL;
      try {
        parsed = new URL(imgUrl);
      } catch {
        return jsonError(400, { error: "bad_url" });
      }
      if (parsed.protocol !== "https:" || !isAllowedPhotoHost(parsed.hostname)) {
        return jsonError(403, { error: "host_not_allowed" });
      }
      const imgRes = await fetch(imgUrl, { redirect: "follow" });
      const out = new Headers(cors);
      const ct = imgRes.headers.get("content-type");
      out.set("Content-Type", ct && ct.startsWith("image/") ? ct : "image/jpeg");
      out.set("Cache-Control", "public, max-age=600");
      return new Response(req.method === "HEAD" ? null : imgRes.body, {
        status: imgRes.status,
        headers: out,
      });
    }

    const target = `${UPSTREAM}${path}${url.search}`;

    const body =
      req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

    const upstreamRes = await fetch(target, {
      method: req.method,
      headers: buildUpstreamRequestHeaders(req),
      body,
      redirect: "follow",
    });

    const out = new Headers(cors);
    const ct = upstreamRes.headers.get("content-type");
    out.set("Content-Type", ct || "application/json");
    const cc = upstreamRes.headers.get("cache-control");
    if (cc) out.set("Cache-Control", cc);

    // Буферизуем тело целиком. Старый деплой без буфера отдавал 500 на ответах > ~1 КБ.
    const bodyBytes = new Uint8Array(await upstreamRes.arrayBuffer());
    return new Response(bodyBytes, {
      status: upstreamRes.status,
      headers: out,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("ble-map-proxy error:", msg, "path:", apiPathFromRequest(req));
    return jsonError(502, { error: "proxy_error", detail: msg });
  }
});
