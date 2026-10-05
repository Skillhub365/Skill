import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import type { Role } from "./mock-data";
import { ApiError } from "./errors";
import { setAccessToken } from "./security/token-store";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  org: string;
  workspaceSlug: string;
  workspaceName: string;
}

export interface IdentityProviders {
  password: { enabled: boolean };
  entra: { enabled: boolean; label: string; authority: string | null };
}

interface AuthContextValue {
  user: AuthUser | null;
  ready: boolean;
  token: string | null;
  providers: IdentityProviders | null;
  /** Bearer header for every authenticated API call. */
  authHeaders: () => Record<string, string>;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signInWithMicrosoft: (redirectTo?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Ask the server who this token belongs to. Role and org are never trusted from the client. */
async function fetchProfile(token: string): Promise<AuthUser> {
  const res = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
  const data = (await res.json().catch(() => ({}))) as { user?: AuthUser; code?: string; detail?: string };
  if (!res.ok || !data.user) throw new ApiError((data.code as never) ?? "AUTH_INVALID", data.detail, res.status);
  return data.user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [providers, setProviders] = useState<IdentityProviders | null>(null);
  const [ready, setReady] = useState(false);
  const tokenRef = useRef<string | null>(null);

  const applySession = useCallback(async (session: Session | null) => {
    tokenRef.current = session?.access_token ?? null;
    setAccessToken(
      session?.access_token
        ? { token: session.access_token, expiresAt: (session.expires_at ?? 0) * 1000 }
        : null,
    );
    if (!session?.access_token) {
      setUser(null);
      return;
    }
    try {
      setUser(await fetchProfile(session.access_token));
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Session restore, refresh-token rotation, revocation and expiry are all
    // handled by the platform identity service — no home-grown refresh here.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });

    void supabase.auth.getSession().then(async ({ data }) => {
      await applySession(data.session);
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [applySession]);

  useEffect(() => {
    fetch("/api/auth/token")
      .then((r) => r.json())
      .then((d: { providers?: IdentityProviders }) => setProviders(d.providers ?? null))
      .catch(() => setProviders(null));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.session) throw new ApiError("AUTH_INVALID", error?.message, 401);
    const profile = await fetchProfile(data.session.access_token);
    tokenRef.current = data.session.access_token;
    setUser(profile);
    return profile;
  }, []);

  const signInWithMicrosoft = useCallback(async (redirectTo?: string) => {
    // A relative, same-origin return path is preserved across the provider
    // round-trip (used by the agent-integration consent flow).
    const target =
      redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
        ? `${window.location.origin}${redirectTo}`
        : window.location.origin;
    const result = await lovable.auth.signInWithOAuth("microsoft", {
      redirect_uri: target,
    });
    if (result.error) throw new ApiError("AUTH_INVALID", String(result.error), 401);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    tokenRef.current = null;
    setAccessToken(null);
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      setUser(await fetchProfile(token));
    } catch {
      /* keep the current view; the next auth event will correct it */
    }
  }, []);

  const authHeaders = useCallback(
    () => (tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}),
    [],
  );

  const value = useMemo(
    () => ({
      user,
      token: tokenRef.current,
      providers,
      ready,
      authHeaders,
      signIn,
      signInWithMicrosoft,
      signOut,
      refreshProfile,
    }),
    [user, providers, ready, authHeaders, signIn, signInWithMicrosoft, signOut, refreshProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function homeFor(role: Role) {
  return role === "user" ? "/app" : "/admin";
}

export function isAdminRole(role: Role | undefined) {
  return role === "admin" || role === "superadmin";
}
