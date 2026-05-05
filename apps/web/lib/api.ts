/**
 * URL da API no browser. NEXT_PUBLIC_* é resolvido em build; se vier vazio/undefined no bundle,
 * usamos o mesmo host da página na porta 8080 (docker compose local).
 */
export function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  const fromEnv = typeof raw === "string" && raw.trim() !== "" && raw !== "undefined" ? raw.trim().replace(/\/$/, "") : "";

  if (typeof window !== "undefined") {
    if (fromEnv) return fromEnv;
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }

  return fromEnv || "http://localhost:8080";
}

export function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") ?? "";
}

export function setToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("token", token);
}

export function clearToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("token");
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers ?? {});
  headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "request failed");
  }
  return response.json() as Promise<T>;
}

export type User = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "OPERADOR" | "AUDITOR";
  is_active: boolean;
};
