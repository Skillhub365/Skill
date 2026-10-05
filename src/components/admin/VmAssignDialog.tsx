/**
 * Reserve pool capacity: pin a machine to a workspace, and optionally hold it
 * for one learner and lab. Reserving does not start a session or bill compute.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCatalog } from "@/lib/store";
import type { PoolVm } from "@/lib/vm/pool/types";

const NONE = "__none__";

interface Props {
  vm: PoolVm | null;
  workspaces: { id: string; name: string }[];
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: { workspaceId: string | null; userId: string | null; userName: string | null; labId: string | null }) => void;
}

export function VmAssignDialog({ vm, workspaces, saving, onOpenChange, onSave }: Props) {
  const { labs, users } = useCatalog();
  const [workspaceId, setWorkspaceId] = useState(NONE);
  const [userId, setUserId] = useState(NONE);
  const [labId, setLabId] = useState(NONE);

  useEffect(() => {
    setWorkspaceId(vm?.workspaceId ?? NONE);
    setUserId(vm?.assignedUserId ?? NONE);
    setLabId(vm?.labId ?? NONE);
  }, [vm]);

  // Only labs of the chosen workspace can hold this machine.
  const scopedLabs = labs.filter((l) => workspaceId === NONE || l.workspaceId === workspaceId);

  return (
    <Dialog open={Boolean(vm)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign {vm?.name}</DialogTitle>
          <DialogDescription>
            Reserve this machine so it is only offered where you expect. Leave a field empty to keep it in the shared pool.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Workspace</Label>
            <Select value={workspaceId} onValueChange={(v) => { setWorkspaceId(v); setLabId(NONE); }}>
              <SelectTrigger><SelectValue placeholder="Shared across all workspaces" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Shared across all workspaces</SelectItem>
                {workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Learner</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="Any learner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Any learner</SelectItem>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} · {u.email}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Lab</Label>
            <Select value={labId} onValueChange={setLabId}>
              <SelectTrigger><SelectValue placeholder="Any lab" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Any lab</SelectItem>
                {scopedLabs.map((l) => <SelectItem key={l.id} value={l.id}>{l.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={saving}
            onClick={() =>
              onSave({
                workspaceId: workspaceId === NONE ? null : workspaceId,
                userId: userId === NONE ? null : userId,
                userName: userId === NONE ? null : (users.find((u) => u.id === userId)?.name ?? null),
                labId: labId === NONE ? null : labId,
              })
            }
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
