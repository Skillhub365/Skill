import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Globe, KeyRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { CopyField } from "@/components/admin/CopyField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  SESSION_URL_BASE,
  WORKSPACE_URL_BASE,
  useCatalog,
  workspaceSlugFor,
} from "@/lib/store";
import type { AccessType, Workspace } from "@/lib/mock-data";

export function WorkspaceAccessPanel({ workspace }: { workspace: Workspace }) {
  const { sessions, updateWorkspace, regenerateSlug, setPublicLanding } = useCatalog();
  const [customSlug, setCustomSlug] = useState("");
  const navigate = useNavigate();

  const liveSession = sessions.find((s) => s.workspace === workspace.name && s.status === "active");
  const workspaceUrl = `${WORKSPACE_URL_BASE}/${workspace.slug}`;
  const sessionUrl = `${SESSION_URL_BASE}/${liveSession?.id ?? "<session-id>"}`;
  const suggested = workspaceSlugFor(workspace.org, workspace.name);

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Access &amp; URLs</CardTitle>
        <Badge variant="secondary">Authentication always required</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Access model</Label>
          <RadioGroup
            value={workspace.accessType}
            onValueChange={(v) => {
              updateWorkspace(workspace.id, { accessType: v as AccessType });
              toast.success("Access model updated");
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            {[
              {
                value: "WORKSPACE_URL" as AccessType,
                icon: Globe,
                title: "Workspace URL",
                body: "Learners open one shared workspace link and sign in to see their assigned labs.",
              },
              {
                value: "USER_SESSION_URL" as AccessType,
                icon: KeyRound,
                title: "User session URL",
                body: "Each learner receives a private session link. The link identifies a session — it never authorizes it.",
              },
            ].map((option) => (
              <label
                key={option.value}
                htmlFor={`access-${option.value}`}
                className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors ${
                  workspace.accessType === option.value ? "border-primary bg-accent/60" : "border-border"
                }`}
              >
                <RadioGroupItem id={`access-${option.value}`} value={option.value} className="mt-1" />
                <span>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <option.icon className="size-4 text-primary" /> {option.title}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{option.body}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label>Workspace URL</Label>
          <CopyField label="Workspace URL" value={workspaceUrl} />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground">{WORKSPACE_URL_BASE}/</span>
            <Input
              className="h-9 w-56"
              value={customSlug}
              placeholder={suggested}
              onChange={(e) => setCustomSlug(e.target.value)}
              aria-label="Custom workspace slug"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const next = regenerateSlug(workspace.id, customSlug || undefined);
                setCustomSlug("");
                toast.success(`Workspace URL is now /workspace/${next}`);
                if (next && next !== workspace.slug) {
                  void navigate({ to: "/admin/workspaces/$slug", params: { slug: next }, replace: true });
                }

              }}
            >
              <RefreshCw className="size-4" /> {customSlug ? "Apply slug" : "Regenerate slug"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Auto-generated from organization + workspace name (suggested: <span className="font-mono">{suggested}</span>).
            Existing links stop working after a change.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Session URL</Label>
          <CopyField label="Session URL" value={sessionUrl} />
          <p className="text-xs text-muted-foreground">
            Per-learner private link. The recipient must still authenticate, belong to this workspace, be assigned the lab,
            and own a valid session before any VM is reachable.
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-4">
          <div>
            <p className="text-sm font-medium">Public landing page</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Show workspace branding, description and the public lab catalogue to unauthenticated visitors. VMs and
              sessions stay locked behind sign-in.
            </p>
          </div>
          <Switch
            checked={workspace.publicLanding}
            aria-label="Toggle public landing page"
            onCheckedChange={(v) => {
              setPublicLanding(workspace.id, v);
              toast.success(v ? "Public landing page enabled" : "Public landing page disabled");
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
