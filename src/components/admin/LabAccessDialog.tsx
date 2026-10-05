import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useCatalog } from "@/lib/store";
import type { Lab, LabAssignment } from "@/lib/mock-data";
import {
  evaluateAccess, formatDate, formatHours, fromDateInput, toDateInput, usedPercent,
} from "@/lib/labs/persistence";

/**
 * Grant, extend or revoke one learner's access to a persistent lab:
 * the access window (from/to) and the total hours they may spend.
 */
export function LabAccessDialog({
  lab, assignment, workspaceId, userId, userName, trigger,
}: {
  lab: Lab;
  assignment: LabAssignment | undefined;
  workspaceId: string;
  userId: string;
  userName: string;
  trigger: ReactNode;
}) {
  const { setAssignmentAccess } = useCatalog();
  const [open, setOpen] = useState(false);
  const access = assignment?.access;
  const [startsAt, setStartsAt] = useState(toDateInput(access?.accessStartsAt ?? null));
  const [endsAt, setEndsAt] = useState(toDateInput(access?.accessEndsAt ?? null));
  const [hours, setHours] = useState(String(Math.round((access?.allowedMinutes ?? lab.defaultAllowedMinutes) / 60)));

  const evaluation = access ? evaluateAccess(access, { status: assignment?.status }) : null;

  const save = () => {
    if (!startsAt || !endsAt) { toast.error("Set both a start and an end date"); return; }
    if (new Date(endsAt) < new Date(startsAt)) { toast.error("The end date must come after the start date"); return; }
    setAssignmentAccess({
      workspaceId,
      userId,
      labId: lab.id,
      accessStartsAt: fromDateInput(startsAt),
      accessEndsAt: fromDateInput(endsAt, true),
      allowedMinutes: Math.max(0, Number(hours) || 0) * 60,
      status: "assigned",
    });
    toast.success(`Access updated for ${userName}`);
    setOpen(false);
  };

  type Patch = Omit<Parameters<typeof setAssignmentAccess>[0], "workspaceId" | "userId" | "labId">;
  const quick = (patch: Patch, message: string) => {
    setAssignmentAccess({ ...patch, workspaceId, userId, labId: lab.id });
    toast.success(message);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Access to {lab.title}</DialogTitle>
          <DialogDescription>
            {userName} keeps the same machine for the whole window and spends the hours you allocate here.
          </DialogDescription>
        </DialogHeader>

        {access ? (
          <div className="space-y-2 rounded-lg border p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Hours used</span>
              <span>{formatHours(access.usedMinutes)} of {formatHours(access.allowedMinutes ?? 0)}</span>
            </div>
            <Progress value={usedPercent(access)} />
            <p className="text-muted-foreground">
              {formatDate(access.accessStartsAt)} → {formatDate(access.accessEndsAt)} · {evaluation?.message}
            </p>
            {access.persistentVmId ? (
              <p className="text-muted-foreground">A machine is reserved for this learner.</p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="access-from">Access from</Label>
            <Input id="access-from" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="access-to">Access until</Label>
            <Input id="access-to" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="access-hours">Total hours</Label>
            <Input id="access-hours" type="number" min={0} max={2000} value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => quick({ addMinutes: 300 }, "Added 5 hours")}>+5 hours</Button>
          <Button variant="outline" size="sm" onClick={() => quick({ extendDays: 7 }, "Extended by 7 days")}>+7 days</Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => quick({ reset: true }, "Machine returned to the pool; the next launch gets a fresh one")}
          >
            Reset machine
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => { quick({ status: "revoked" }, "Access revoked"); setOpen(false); }}
          >
            Revoke access
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save}>Save access</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
