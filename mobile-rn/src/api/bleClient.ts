import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  BLE_AUTO_PASS,
  BLE_AUTO_USER,
  BLE_BACKEND_BASE,
  BLE_PROXY_BACKEND_BASE,
  BLE_TOKEN_KEY,
} from "../config";
import {
  WW_MOBILE_AUTH_PATH,
  WW_NATIVE_TRANSPORTS,
  type WwNativeTransport,
} from "./wwServiceEndpoints";

const FETCH_TIMEOUT_MS = 120_000;
const LIST_TIMEOUT_MS = 55_000;
const AUTH_TIMEOUT_MS = 25_000;

const FAILOVER_STATUSES = new Set([404, 405, 500, 502, 503, 504]);

export async function getBleToken(): Promise<string | null> {
  return AsyncStorage.getItem(BLE_TOKEN_KEY);
}

async function setBleToken(token: string): Promise<void> {
  await AsyncStorage.setItem(BLE_TOKEN_KEY, token);
}

function transportOrder(): WwNativeTransport[] {
  return [...WW_NATIVE_TRANSPORTS];
}

function buildUrl(transport: WwNativeTransport, path: string): string {
  const base =
    transport === "backend" ? BLE_BACKEND_BASE : BLE_PROXY_BACKEND_BASE;
  return `${base}${path}`;
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

function shouldFailover(res: Response): boolean {
  return FAILOVER_STATUSES.has(res.status);
}

export async function bleHttpFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let lastErr: unknown = null;
  const timeoutMs = timeoutForPath(path);

  for (const tid of transportOrder()) {
    const url = buildUrl(tid, path);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        headers: new Headers(init.headers ?? {}),
        signal: ctrl.signal,
      });
      if (shouldFailover(res)) {
        lastErr = new Error(`${tid}_${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastErr instanceof Error && lastErr.name === "AbortError") {
    throw new Error(
      `Таймаут запроса (${BLE_BACKEND_BASE}). Проверьте Wi‑Fi на объекте.`,
    );
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(
        `Нет связи с backend.vsm / proxy.backend.vsm (${BLE_BACKEND_BASE}).`,
      );
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

export async function bleAutoLogin(): Promise<string> {
  try {
    return await mobileLogin(BLE_AUTO_USER, BLE_AUTO_PASS);
  } catch (e) {
    console.warn("[bleClient] mobile login failed, trying /api/v1/token", e);
    return legacyTokenLogin();
  }
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

export async function ensureBleTokenForField(): Promise<void> {
  await ensureToken();
}
