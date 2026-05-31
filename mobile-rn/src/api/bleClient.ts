import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  BLE_AUTO_PASS,
  BLE_AUTO_USER,
  BLE_SUPABASE_BASE,
  BLE_TOKEN_KEY,
  BLE_WORKER_BASE,
  SUPABASE_PUBLISHABLE_KEY,
} from "../config";

const BLE_WORKER_ONLY = ["/api/v1/map/ble/"];
const BLE_WORKER_PREF = ["/api/v1/ble_zone"];
const FETCH_TIMEOUT_MS = 120_000;
const LIST_TIMEOUT_MS = 40_000;

export async function getBleToken(): Promise<string | null> {
  return AsyncStorage.getItem(BLE_TOKEN_KEY);
}

async function setBleToken(token: string): Promise<void> {
  await AsyncStorage.setItem(BLE_TOKEN_KEY, token);
}

function transportOrder(path: string): ("supabase" | "worker")[] {
  if (BLE_WORKER_ONLY.some((p) => path.includes("/map/ble/"))) {
    return ["worker", "supabase"];
  }
  if (BLE_WORKER_PREF.some((p) => path.startsWith(p))) {
    return ["worker", "supabase"];
  }
  return ["supabase", "worker"];
}

function mergeSupabaseHeaders(headers: HeadersInit, bleToken: string | null): Headers {
  const h = new Headers(headers);
  h.set("apikey", SUPABASE_PUBLISHABLE_KEY);
  h.set("Authorization", `Bearer ${SUPABASE_PUBLISHABLE_KEY}`);
  if (bleToken) h.set("x-ble-token", bleToken);
  return h;
}

function buildUrl(transport: "supabase" | "worker", path: string): string {
  if (transport === "worker") return `${BLE_WORKER_BASE}${path}`;
  return `${BLE_SUPABASE_BASE}${path}`;
}

export async function bleHttpFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const tried: string[] = [];
  let lastErr: unknown = null;
  const authHeader =
    (init.headers as Record<string, string> | undefined)?.Authorization ??
    (init.headers as Record<string, string> | undefined)?.authorization;
  const bleToken =
    authHeader?.replace(/^Bearer\s+/i, "") ||
    (await getBleToken());

  const timeoutMs = path.includes("/map/ble/") ? LIST_TIMEOUT_MS : FETCH_TIMEOUT_MS;

  for (const tid of transportOrder(path)) {
    tried.push(tid);
    const url = buildUrl(tid, path);
    const headers =
      tid === "supabase"
        ? mergeSupabaseHeaders(init.headers ?? {}, bleToken)
        : new Headers(init.headers ?? {});

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
      if (tid === "supabase" && [404, 500, 502, 503].includes(res.status)) {
        lastErr = new Error(`supabase_proxy_${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to fetch");
}

export async function bleAutoLogin(): Promise<string> {
  const res = await bleHttpFetch("/api/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `username=${encodeURIComponent(BLE_AUTO_USER)}&password=${encodeURIComponent(BLE_AUTO_PASS)}`,
  });
  if (!res.ok) throw new Error("auto_auth_failed");
  const data = (await res.json()) as Record<string, string>;
  const token = data.accessToken || data.access_token || data.token;
  if (!token) throw new Error("no_token_in_response");
  await setBleToken(token);
  return token;
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
