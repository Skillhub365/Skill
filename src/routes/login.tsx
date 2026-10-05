import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Brand } from "@/components/layout/Brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCatalog } from "@/lib/store";
import { useAuth, homeFor } from "@/lib/auth";
import { friendlyFrom } from "@/lib/errors";

export const Route = createFileRoute("/login")({
  /** `next` carries a same-origin return path (agent consent, deep links). */
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search["next"] === "string" ? { next: search["next"] as string } : {},
  head: () => ({
    meta: [
      { title: "Sign in — SkillTrack Labs" },
      { name: "description", content: "Sign in to the SkillTrack Labs cloud lab console." },
      { property: "og:title", content: "Sign in — SkillTrack Labs" },
      { property: "og:description", content: "Access your SkillTrack Labs workspace, labs and sessions." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { next } = Route.useSearch();
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between p-10 text-primary-foreground lg:flex" style={{ backgroundImage: "var(--gradient-brand)" }}>
        <span className="text-sm font-bold tracking-tight">SkillTrack Labs</span>
        <div>
          <h2 className="max-w-sm text-3xl font-bold leading-tight">
            Every lab, every VM, every session — in one console.
          </h2>
          <p className="mt-4 max-w-sm text-sm opacity-85">
            Administrators publish workspaces. Learners open them in a browser and get to work.
          </p>
        </div>
        <span className="text-xs opacity-75">Secured by Microsoft Entra ID</span>
      </div>
      <div className="flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm">
          <Brand />
          <h1 className="mt-8 text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use your SkillTrack Labs account.</p>
          <LoginForm redirectTo={safeNext} />
          <p className="mt-6 text-center text-xs text-muted-foreground">
            <Link to="/" className="underline underline-offset-4">Back to home</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export function LoginForm({ workspaceName, redirectTo }: { workspaceName?: string | undefined; redirectTo?: string | undefined }) {
  const { signIn, signInWithMicrosoft, providers, user, ready } = useAuth();
  const { logEvent } = useCatalog();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (ready && user) navigate({ to: redirectTo ?? homeFor(user.role), replace: true });
  }, [ready, user, navigate, redirectTo]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const session = await signIn(email, password);
      logEvent("LOGIN", session.name, session.email, `Signed in as ${session.role === "admin" ? "administrator" : "learner"}`);
      navigate({ to: redirectTo ?? homeFor(session.role), replace: true });
    } catch (err) {
      setError(friendlyFrom(err).message);
    } finally {
      setLoading(false);
    }
  }

  async function onMicrosoft() {
    setError(null);
    try {
      await signInWithMicrosoft(redirectTo);
    } catch (err) {
      setError(friendlyFrom(err).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {workspaceName ? (
        <div className="rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Workspace: <span className="font-medium text-foreground">{workspaceName}</span>
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </Button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="outline" className="w-full" onClick={onMicrosoft}>
        Continue with Microsoft Entra ID
      </Button>
      {providers && !providers.entra.enabled ? (
        <p className="text-center text-[11px] text-muted-foreground">
          Single sign-on is ready to enable — your administrator configures the tenant.
        </p>
      ) : null}

    </form>
  );
}
