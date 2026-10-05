import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, Lock, LogOut, MonitorPlay, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/layout/Brand";
import { LabCard } from "@/components/learner/LabCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoginForm } from "@/routes/login";
import { useAuth } from "@/lib/auth";
import { useLearnerView } from "@/lib/learner";
import { useCatalog } from "@/lib/store";
import type { Workspace } from "@/lib/mock-data";

export const Route = createFileRoute("/workspace/$slug")({
  head: () => ({
    meta: [
      { title: "Workspace access — SkillTrack Labs" },
      { name: "description", content: "Open the branded cloud lab workspace shared with you and sign in to reach your assigned labs." },
      { property: "og:title", content: "Workspace access — SkillTrack Labs" },
      { property: "og:description", content: "Authenticate to enter your SkillTrack Labs workspace." },
    ],
  }),
  component: WorkspaceEntry,
});

function WorkspaceBanner({ ws }: { ws: Workspace }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{ws.org}</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">{ws.name}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{ws.description}</p>
      <p className="mt-3 font-mono text-xs text-muted-foreground">labs.skilltracklabs.com/workspace/{ws.slug}</p>
    </div>
  );
}

function WorkspaceEntry() {
  const { slug } = Route.useParams();
  const { user, ready, signOut } = useAuth();
  const { workspaces, sessions, vms } = useCatalog();
  const found = workspaces.find((w) => w.slug === slug);
  const { myLabs, publishedLabs, isMember } = useLearnerView(user, slug);

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  // ---- Unauthenticated: branded sign-in, optionally with a public catalogue.
  if (!user) {
    const showCatalogue = Boolean(found?.publicLanding && found.status === "published");
    return (
      <div className="min-h-screen" style={{ backgroundImage: "var(--gradient-surface)" }}>
        <div className={`mx-auto grid gap-8 px-6 py-12 ${showCatalogue ? "max-w-6xl lg:grid-cols-[1.2fr_minmax(360px,1fr)]" : "max-w-md"}`}>
          {showCatalogue && found ? (
            <div className="space-y-6">
              <WorkspaceBanner ws={found} />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Lab catalogue</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {publishedLabs.map((lab) => (
                    <Card key={lab.id}>
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold">{lab.title}</h3>
                          <Badge variant="secondary">{lab.durationMinutes} min</Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{lab.description}</p>
                        <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                          <Lock className="size-3" /> Sign in to launch — VM access requires authorization
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                  {publishedLabs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No labs published yet.</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <Card className="h-fit w-full shadow-[var(--shadow-elevated)]">
            <CardContent className="p-8">
              <Brand subtitle="Workspace access" />
              {found ? (
                <>
                  <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-primary">{found.org}</p>
                  <h1 className="mt-1 text-xl font-bold tracking-tight">{found.name}</h1>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">/workspace/{slug}</p>
                  {found.status === "published" ? (
                    <LoginForm workspaceName={found.name} redirectTo={`/workspace/${slug}`} />
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">
                      This workspace has not been published yet. Contact your administrator.
                    </p>
                  )}
                  <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    This URL is an entry point, not an authorization mechanism — labs and virtual machines open only for
                    authenticated, assigned users.
                  </p>
                </>
              ) : (
                <>
                  <h1 className="mt-6 text-xl font-bold tracking-tight">Workspace not found</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Check the link with your administrator — no workspace matches /workspace/{slug}.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!found) return <CenteredNotice title="Workspace not found" body={`No workspace matches /workspace/${slug}.`} />;
  if (found.status !== "published") {
    return <CenteredNotice title="Workspace not published" body="Your administrator has not published this workspace yet." />;
  }
  if (!isMember) {
    return <CenteredNotice title="You are not enrolled in this workspace" body={`Signed in as ${user.email}. Ask your administrator to add you.`} />;
  }

  const activeSession = sessions.find(
    (s) => s.status === "active" && s.workspace === found.name && (s.userId === user.id || s.user === user.name),
  );
  const activeVm = activeSession ? vms.find((v) => v.id === activeSession.vmId || v.sessionId === activeSession.id) : undefined;

  return (
    <div className="min-h-screen" style={{ backgroundImage: "var(--gradient-surface)" }}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/70 px-6 py-4 backdrop-blur">
        <Brand subtitle={found.org} />
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm"><Link to="/app">My dashboard</Link></Button>
          <Button variant="outline" size="sm" onClick={signOut}><LogOut className="size-4" /> Sign out</Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <WorkspaceBanner ws={found} />

        <p className="text-sm text-muted-foreground">
          Welcome, {user.name.split(" ")[0]} — these labs are published to this workspace and assigned to you.
        </p>

        {activeSession ? (
          <Card className="border-primary/40">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <MonitorPlay className="size-4 text-primary" /> Active session · {activeSession.labTitle}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <Clock className="mr-1 inline size-3" />
                  {activeSession.remainingMinutes} min remaining
                  {activeVm ? ` · VM ${activeVm.name} · ${activeVm.status}` : ""}
                </p>
              </div>
              <Button asChild>
                <Link to="/session/$sessionId" params={{ sessionId: activeSession.id }}>Resume session</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {myLabs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
              No labs assigned to you yet in this workspace.
            </p>
          ) : null}
          {myLabs.map((l) => <LabCard key={l.id} lab={l} />)}
        </div>
      </main>
    </div>
  );
}

function CenteredNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      <Button asChild variant="outline"><Link to="/app">Go to my dashboard</Link></Button>
    </div>
  );
}
