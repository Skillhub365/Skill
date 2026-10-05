import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Boxes, Cpu, Layers, MonitorPlay, ShieldCheck, Users } from "lucide-react";
import { Brand } from "@/components/layout/Brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SkillTrack Labs — Browser-Based Cloud Labs" },
      {
        name: "description",
        content:
          "Deliver hands-on cloud labs from the browser. Build workspaces, publish labs, manage VMs and track live sessions.",
      },
      { property: "og:title", content: "SkillTrack Labs — Browser-Based Cloud Labs" },
      {
        property: "og:description",
        content: "Enterprise cloud lab delivery: workspaces, templates, virtual machines and sessions.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  { icon: Layers, title: "Workspaces", body: "One container per customer engagement — labs, users, templates and sessions together." },
  { icon: Cpu, title: "VM environments", body: "Template-driven machine specs so every learner gets an identical, ready environment." },
  { icon: MonitorPlay, title: "Browser delivery", body: "Learners open a workspace URL, sign in and land straight in their lab session." },
  { icon: ShieldCheck, title: "Access control", body: "Session links identify a workspace — they never grant access on their own." },
];

function Landing() {
  return (
    <div className="min-h-screen" style={{ backgroundImage: "var(--gradient-surface)" }}>
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 md:px-6">
        <Brand />
        <Button asChild size="sm">
          <Link to="/login">Sign in</Link>
        </Button>
      </header>

      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:px-6 md:py-24">
        <div>
          <Badge variant="secondary" className="mb-4">Enterprise cloud labs</Badge>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
            Cloud labs your learners open in a browser tab
          </h1>
          <p className="mt-5 max-w-lg text-base text-muted-foreground">
            SkillTrack Labs gives administrators a single console for workspaces, lab templates, virtual machines
            and live sessions — and gives learners a focused place to run them.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/login">
                Open the console <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/workspace/$slug" params={{ slug: "abc-training" }}>
                Try a workspace URL
              </Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Sign in with your organisation account. Access is granted by your workspace administrator.
          </p>
        </div>

        <Card className="border-border shadow-[var(--shadow-elevated)]">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Boxes className="size-4 text-primary" /> Azure AI Training - ABC Corp
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4">
              {[
                { k: "Published labs", v: "6" },
                { k: "Enrolled users", v: "48" },
                { k: "Running VMs", v: "12" },
                { k: "Active sessions", v: "12" },
              ].map((s) => (
                <div key={s.k} className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground">{s.k}</p>
                  <p className="mt-1 text-2xl font-bold">{s.v}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-xl bg-accent p-4 text-xs text-accent-foreground">
              <Users className="size-4" /> labs.skilltracklabs.com/workspace/abc-training
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-4 px-4 pb-24 sm:grid-cols-2 lg:grid-cols-4 md:px-6">
        {features.map((f) => (
          <Card key={f.title} className="border-border">
            <CardContent className="p-5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <f.icon className="size-5" />
              </span>
              <h2 className="mt-4 text-sm font-semibold">{f.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
