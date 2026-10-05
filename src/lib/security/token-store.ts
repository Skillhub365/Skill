/**
 * Tiny in-memory holder so non-React API clients can attach the current bearer
 * token. The AuthProvider is the only writer.
 */
let current: { token: string; expiresAt: number } | null = null;

export function setAccessToken(next: { token: string; expiresAt: number } | null) {
  current = next;
}

export function accessToken(): string | null {
  return current?.token ?? null;
}

export function authHeaders(): Record<string, string> {
  const token = accessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}