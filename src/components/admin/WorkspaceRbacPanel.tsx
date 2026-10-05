import { useMemo, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/security/types";
import {
  CAPABILITY_PRESETS,
  WORKSPACE_CAPABILITIES,
  type WorkspaceCapability,
} from "@/lib/security/workspace-capabilities";
import { useCatalog } from "@/lib/store";

/**
 * Cloud and VM permissions for individual members of one workspace.
 * Grants are additive on top of the platform role and never widen what a role
 * is allowed to do elsewhere.
 */
export function WorkspaceRbacPanel({ workspaceId }: { workspaceId: string }) {
  const { user } = useAuth();
  const { workspaceUsers, users, capabilityGrants, setUserCapabilities, toggleUserCapability } = useCatalog();
  const canManage = can(user?.role, "user:manage");
  const [preset, setPreset] = useState<Record<string, string>>({});

  const members = useMemo(
    () => workspaceUsers.filter((wu) => wu.workspaceId === workspaceId),
    [workspaceUsers, workspaceId],
  );

  const grantFor = (userId: string) =>
    capabilityGrants.find((g) => g.workspaceId === workspaceId && g.userId === userId) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cloud &amp; VM permissions</CardTitle>
        <CardDescription>
          Grant specific members the right to read cloud resources, power virtual machines or read the audit trail —
          scoped to this workspace only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {members.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Add users to this workspace before assigning permissions.
          </p>
        ) : null}

        {members.map((member) => {
          const account = users.find((u) => u.id === member.userId);
          const grant = grantFor(member.userId);
          const granted = grant?.capabilities ?? [];
          return (
            <div key={member.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{account?.name ?? member.userId}</p>
                  <p className="text-xs text-muted-foreground">
                    {account?.email ?? "—"} · platform role {account?.role ?? member.role}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={granted.length ? "secondary" : "outline"}>
                    {granted.length} permission{granted.length === 1 ? "" : "s"}
                  </Badge>
                  <Select
                    value={preset[member.userId] ?? ""}
                    onValueChange={(id) => {
                      const found = CAPABILITY_PRESETS.find((p) => p.id === id);
                      if (!found) return;
                      setPreset((p) => ({ ...p, [member.userId]: id }));
                      setUserCapabilities(workspaceId, member.userId, found.capabilities, user?.name ?? "Admin console");
                      toast.success(`${found.label} preset applied to ${account?.name ?? member.userId}.`);
                    }}
                    disabled={!canManage}
                  >
                    <SelectTrigger className="h-8 w-44 text-xs">
                      <SelectValue placeholder="Apply preset" />
                    </SelectTrigger>
                    <SelectContent>
                      {CAPABILITY_PRESETS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canManage || granted.length === 0}
                    onClick={() => {
                      setUserCapabilities(workspaceId, member.userId, [], user?.name ?? "Admin console");
                      toast.success("Permissions revoked.");
                    }}
                  >
                    <ShieldOff className="mr-1 size-3.5" /> Revoke all
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {WORKSPACE_CAPABILITIES.map((capability) => {
                  const checked = granted.includes(capability.id);
                  return (
                    <label
                      key={capability.id}
                      className={`flex items-start gap-3 rounded-lg border p-3 text-xs ${
                        checked ? "border-primary/40 bg-primary/5" : "border-border"
                      }`}
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={checked}
                        disabled={!canManage}
                        onCheckedChange={() =>
                          toggleUserCapability(
                            workspaceId,
                            member.userId,
                            capability.id as WorkspaceCapability,
                            user?.name ?? "Admin console",
                          )
                        }
                      />
                      <span>
                        <span className="flex items-center gap-1.5 font-medium text-foreground">
                          {capability.label}
                          {capability.privileged ? (
                            <ShieldCheck className="size-3 text-amber-600" aria-label="Privileged" />
                          ) : null}
                        </span>
                        <span className="text-muted-foreground">{capability.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {grant ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Last changed by {grant.grantedBy} · {new Date(grant.grantedAt).toLocaleString()}
                </p>
              ) : null}
            </div>
          );
        })}

        {!canManage && members.length ? (
          <p className="text-xs text-muted-foreground">Your role cannot change workspace permissions.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
