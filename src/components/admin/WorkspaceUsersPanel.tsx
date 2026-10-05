import { useMemo, useState } from "react";
import { CalendarClock, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCatalog } from "@/lib/store";
import { LabAccessDialog } from "./LabAccessDialog";
import { formatDate, formatHours } from "@/lib/labs/persistence";

export function WorkspaceUsersPanel({ workspaceId }: { workspaceId: string }) {
  const { labs, users, workspaceUsers, labAssignments, addWorkspaceUser, removeWorkspaceUser, toggleAssignment } = useCatalog();
  const [pending, setPending] = useState("");

  const members = workspaceUsers.filter((wu) => wu.workspaceId === workspaceId);
  const wsLabs = labs.filter((l) => l.workspaceId === workspaceId);
  const available = useMemo(
    () => users.filter((u) => u.role === "user" && !members.some((m) => m.userId === u.id)),
    [users, members],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">Users &amp; lab assignments</CardTitle>
        <div className="flex items-center gap-2">
          <Select value={pending} onValueChange={setPending}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Select a user" /></SelectTrigger>
            <SelectContent>
              {available.length === 0
                ? <SelectItem value="none" disabled>All users added</SelectItem>
                : available.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} · {u.email}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            onClick={() => {
              if (!pending || pending === "none") { toast.error("Select a user first"); return; }
              addWorkspaceUser(workspaceId, pending);
              setPending("");
              toast.success("User added to workspace");
            }}
          >
            <UserPlus className="size-4" /> Add user
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {members.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No users yet. Add users, then assign labs to them.
          </p>
        ) : null}
        {members.map((m) => {
          const u = users.find((x) => x.id === m.userId);
          return (
            <div key={m.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{u?.name ?? m.userId}</p>
                  <p className="text-xs text-muted-foreground">{u?.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="capitalize">{m.status}</Badge>
                  <Button variant="ghost" size="icon" aria-label="Remove user"
                    onClick={() => { removeWorkspaceUser(m.id); toast.success("User removed"); }}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                {wsLabs.length === 0 ? <p className="text-xs text-muted-foreground">Create labs to assign them.</p> : null}
                {wsLabs.map((l) => {
                  const assignment = labAssignments.find((a) => a.userId === m.userId && a.labId === l.id);
                  const assigned = Boolean(assignment);
                  const persistent = l.labMode === "persistent";
                  return (
                    <label key={l.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                      <Checkbox
                        checked={assigned}
                        onCheckedChange={() => {
                          toggleAssignment(workspaceId, m.userId, l.id);
                          toast.success(assigned ? `Unassigned ${l.title}` : `Assigned ${l.title}`);
                        }}
                      />
                      <span>{l.title}</span>
                      <Badge variant="outline" className="font-normal capitalize">{l.status}</Badge>
                      {persistent ? (
                        <>
                          <Badge variant="secondary" className="font-normal">Multi-day</Badge>
                          {assigned && assignment ? (
                            <>
                              <span className="text-muted-foreground">
                                {formatHours(assignment.access.remainingMinutes)} left ·{" "}
                                {formatDate(assignment.access.accessEndsAt)}
                              </span>
                              <LabAccessDialog
                                lab={l}
                                assignment={assignment}
                                workspaceId={workspaceId}
                                userId={m.userId}
                                userName={u?.name ?? m.userId}
                                trigger={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2"
                                    onClick={(e) => e.preventDefault()}
                                  >
                                    <CalendarClock className="size-3.5" /> Access
                                  </Button>
                                }
                              />
                            </>
                          ) : null}
                        </>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
