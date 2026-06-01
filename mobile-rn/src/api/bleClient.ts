import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  BLE_AUTO_PASS,
  BLE_AUTO_USER,
  BLE_SUPABASE_BASE,
  BLE_TOKEN_KEY,
  BLE_WORKER_BASE,
  SUPABASE_PUBLISHABLE_KEY,
} from "../config";
import {
  isMutationPath,
  transportOrderForPath,
  WW_MOBILE_AUTH_PATH,
  type WwTransport,
} from "./wwServiceEndpoints";

const FETCH_TIMEOUT_MS = 120_000;
const LIST_TIMEOUT_MS = 55_000;
const AUTH_TIMEOUT_MS = 25_000;

const FAILOVER_STATUSES = new Set([404, 405, 422, 500, 502, 503, 504]);

type TransportId = WwTransport;

export async function getBleToken(): Promise<string | null> {
  return AsyncStorage.getItem(BLE_TOKEN_KEY);
}

async function setBleToken(token: string): Promise<void> {
  await AsyncStorage.setItem(BLE_TOKEN_KEY, token);
}

function transportOrder(path: string, method?: string): WwTransport[] {
  return [...transportOrderForPath(path, method)];
}

function shouldFailover(res: Response, path: string, method?: string): boolean {
  if (FAILOVER_STATUSES.has(res.status)) return true;
  if (res.status === 422 && isMutationPath(path, method)) return true;
  return false;
}

function defaultFetchHeaders(init: RequestInit): Headers {
  const h = new Headers(init.headers ?? {});
  if (!h.has("User-Agent")) {
    h.set(
      "User-Agent",
      "WORK-WATCH-BLE-RN/1.0 (Android; compatible; +its-helper.github.io/tabel)",
    );
  }
  if (!h.has("Origin")) h.set("Origin", "https://its-helper.github.io");
  return h;
}

function mergeSupabaseHeaders(headers: HeadersInit, bleToken: string | null): Headers {
  const h = new Headers(headers);
  h.set("apikey", SUPABASE_PUBLISHABLE_KEY);
  h.set("Authorization", `Bearer ${SUPABASE_PUBLISHABLE_KEY}`);
  if (bleToken) h.set("x-ble-token", bleToken);
  return h;
}

function buildUrl(transport: TransportId, path: string): string {
  switch (transport) {
    case "worker":
      return `${BLE_WORKER_BASE}${path}`;
    case "supabase":
      return `${BLE_SUPABASE_BASE}${path}`;
  }
}

function timeoutForPath(path: string): number {
  if (path.includes(WW_MOBILE_AUTH_PATH) || path.includes("/token")) {
    return AUTH_TIMEOUT_MS;
  }
  if (path.includes("/api/v1/ble") || path.includes("/map/ble/")) {
    return LIST_TIMEOUT_MS;
  }
  return FETCH_TIMEOUT_MS;
}

function isSslHostnameError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes("SSLPeerUnverifiedException") ||
    msg.includes("not verified") ||
    msg.includes("CERTIFICATE_VERIFY_FAILED")
  );
}

export async function bleHttpFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let lastErr: unknown = null;
  const timeoutMs = timeoutForPath(path);
  const authHeader =
    (init.headers as Record<string, string> | undefined)?.Authorization ??
    (init.headers as Record<string, string> | undefined)?.authorization;
  const bleToken =
    authHeader?.replace(/^Bearer\s+/i, "") ||
    (await getBleToken());

  const method = init.method ?? "GET";

  for (const tid of transportOrder(path, method)) {
    const url = buildUrl(tid, path);
    const headers =
      tid === "supabase"
        ? mergeSupabaseHeaders(defaultFetchHeaders(init), bleToken)
        : defaultFetchHeaders(init);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
      if (shouldFailover(res, path, method)) {
        lastErr = new Error(`${tid}_${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = isSslHostnameError(e)
        ? new Error(`${tid}_ssl_hostname`)
        : e;
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastErr instanceof Error && lastErr.name === "AbortError") {
    throw new Error(
      `Таймаут запроса (${path}). Проверьте Wi‑Fi на объекте.`,
    );
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Нет связи с API (${path}). Попробуйте Wi‑Fi или VPN.`);
}

function parseTokenPayload(data: Record<string, unknown>): string | null {
  const token =
    data.access_token ||
    data.accessToken ||
    data.token ||
    (typeof data.data === "object" &&
      data.data &&
      ((data.data as Record<string, unknown>).access_token ||
        (data.data as Record<string, unknown>).accessToken));
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** WW Service: POST /mobile/v1/auth/login { username, password }. */
export async function mobileLogin(
  username: string,
  password: string,
): Promise<string> {
  const res = await bleHttpFetch(WW_MOBILE_AUTH_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`mobile_auth_${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  const token = parseTokenPayload(data);
  if (!token) throw new Error("mobile_auth_no_token");
  await setBleToken(token);
  return token;
}

/** Резерв: form /api/v1/token (веб-учётка impl_dept). */
async function legacyTokenLogin(): Promise<string> {
  const res = await bleHttpFetch("/api/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `username=${encodeURIComponent(BLE_AUTO_USER)}&password=${encodeURIComponent(BLE_AUTO_PASS)}`,
  });
  if (!res.ok) throw new Error(`legacy_auth_${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  const token = parseTokenPayload(data);
  if (!token) throw new Error("legacy_auth_no_token");
  await setBleToken(token);
  return token;
}

let loginChain: Promise<string> | null = null;

export async function bleAutoLogin(): Promise<string> {
  if (loginChain) return loginChain;
  loginChain = (async () => {
    try {
      return await legacyTokenLogin();
    } catch (e) {
      console.warn("[bleClient] /api/v1/token failed, trying mobile login", e);
      return mobileLogin(BLE_AUTO_USER, BLE_AUTO_PASS);
    } finally {
      loginChain = null;
    }
  })();
  return loginChain;
}

async function ensureToken(): Promise<string> {
  let token = await getBleToken();
  if (!token) token = await bleAutoLogin();
  return token;
}

export async function bleApiFetch<T>(path: string, retried = false): Promise<T> {
  let token = await getBleToken();
  if (!token) {
    if (retried) throw new Error("auth_failed");
    await bleAutoLogin();
    return bleApiFetch(path, true);
  }
  const res = await bleHttpFetch(path, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401) {
    if (retried) throw new Error(`HTTP ${res.status}`);
    await AsyncStorage.removeItem(BLE_TOKEN_KEY);
    await bleAutoLogin();
    return bleApiFetch(path, true);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function bleApiMutate<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<T | null> {
  await ensureToken();
  let token = await getBleToken();
  if (!token) {
    if (retried) throw new Error("auth_failed");
    await bleAutoLogin();
    return bleApiMutate(method, path, body, true);
  }
  const res = await bleHttpFetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    if (retried) throw new Error(`HTTP ${res.status}`);
    await AsyncStorage.removeItem(BLE_TOKEN_KEY);
    await bleAutoLogin();
    return bleApiMutate(method, path, body, true);
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (res.status === 204 || !ct.includes("json")) return null;
  return res.json() as Promise<T>;
}

export async function ensureBleTokenForField(): Promise<boolean> {
  if (await getBleToken()) return true;
  try {
    await bleAutoLogin();
    return !!(await getBleToken());
  } catch {
    return false;
  }
}

/** Сброс токена — только при явной ошибке 401, не перед каждым запросом. */
export async function bleForceRelogin(): Promise<void> {
  await AsyncStorage.removeItem(BLE_TOKEN_KEY);
  await bleAutoLogin();
}
