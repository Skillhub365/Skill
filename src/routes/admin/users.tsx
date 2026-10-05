import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Search, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCatalog, type ManagedUserInput } from "@/lib/store";
import type { ManagedUser } from "@/lib/mock-data";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "Users — SkillTrack Labs Admin" },
      { name: "description", content: "Invite learners, assign workspaces and labs, and manage account status." },
      { property: "og:title", content: "Users — SkillTrack Labs Admin" },
      { property: "og:description", content: "Manage administrators and learners across workspaces." },
    ],
  }),
  component: UsersPage,
});

const emptyUser: ManagedUserInput = { name: "", email: "", role: "user", workspace: "", status: "invited" };

function UserDialog({
  user,
  trigger,
}: {
  user?: ManagedUser;
  trigger: React.ReactNode;
}) {
  const { workspaces, createUser, updateUser } = useCatalog();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ManagedUserInput>(
    user
      ? { name: user.name, email: user.email, role: user.role, workspace: user.workspace, status: user.status }
      : { ...emptyUser, workspace: workspaces[0]?.name ?? "" },
  );

  const submit = () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Name and email are required");
      return;
    }
    if (user) {
      updateUser(user.id, form);
      toast.success("User updated");
    } else {
      createUser(form);
      toast.success("User added");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? "Edit user" : "Add user"}</DialogTitle>
          <DialogDescription>Accounts sign in with SkillTrack Labs credentials and inherit workspace access.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="u-name">Full name</Label>
            <Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as ManagedUser["role"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="superadmin">Super Admin</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="user">Learner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as ManagedUser["status"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="invited">Invited</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Workspace</Label>
            <Select value={form.workspace} onValueChange={(v) => setForm({ ...form, workspace: v })}>
              <SelectTrigger><SelectValue placeholder="Select a workspace" /></SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.name}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit}>{user ? "Save changes" : "Add user"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentsDialog({ user }: { user: ManagedUser }) {
  const { workspaces, labs, workspaceUsers, labAssignments, addWorkspaceUser, toggleAssignment } = useCatalog();
  const [open, setOpen] = useState(false);
  const workspace = workspaces.find((w) => w.name === user.workspace);
  const memberships = workspaceUsers.filter((m) => m.userId === user.id);
  const assigned = labAssignments.filter((a) => a.userId === user.id);
  const wsLabs = workspace ? labs.filter((l) => l.workspaceId === workspace.id) : [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Labs ({assigned.length})</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user.name}</DialogTitle>
          <DialogDescription>Workspace membership and lab assignments.</DialogDescription>
        </DialogHeader>
        {!workspace ? (
          <p className="text-sm text-muted-foreground">Assign this user to a workspace first.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <div>
                <p className="text-sm font-medium">{workspace.name}</p>
                <p className="text-xs text-muted-foreground">
                  {memberships.some((m) => m.workspaceId === workspace.id) ? "Member" : "Not a member yet"}
                </p>
              </div>
              {memberships.some((m) => m.workspaceId === workspace.id) ? (
                <Badge variant="secondary">Enrolled</Badge>
              ) : (
                <Button size="sm" onClick={() => { addWorkspaceUser(workspace.id, user.id); toast.success("User enrolled"); }}>
                  Enroll
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {wsLabs.length === 0 ? <p className="text-sm text-muted-foreground">No labs in this workspace.</p> : null}
              {wsLabs.map((lab) => {
                const on = assigned.some((a) => a.labId === lab.id);
                return (
                  <div key={lab.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">{lab.title}</p>
                      <p className="text-xs capitalize text-muted-foreground">{lab.status} · {lab.durationMinutes} min</p>
                    </div>
                    <Switch checked={on} onCheckedChange={() => toggleAssignment(workspace.id, user.id, lab.id)} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UsersPage() {
  const { users, labAssignments, removeUser, toggleUser } = useCatalog();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => [u.name, u.email, u.workspace, u.role].join(" ").toLowerCase().includes(q));
  }, [users, query]);

  return (
    <>
      <PageHeader
        title="Users"
        description="Administrators and learners across all workspaces."
        action={<UserDialog trigger={<Button><UserPlus className="size-4" /> Add user</Button>} />}
      />

      <div className="mb-4 flex max-w-sm items-center gap-2">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search users…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Assigned labs</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell>{u.role === "superadmin" ? "Super Admin" : u.role === "admin" ? "Admin" : "Learner"}</TableCell>
                  <TableCell className="text-muted-foreground">{u.workspace || "—"}</TableCell>
                  <TableCell>{labAssignments.filter((a) => a.userId === u.id).length}</TableCell>
                  <TableCell>
                    <Badge variant={u.status === "active" ? "default" : u.status === "suspended" ? "destructive" : "secondary"} className="capitalize">
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.lastActive}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <AssignmentsDialog user={u} />
                      <UserDialog user={u} trigger={<Button variant="outline" size="sm">Edit</Button>} />
                      <Switch
                        checked={u.status !== "suspended"}
                        onCheckedChange={() => { toggleUser(u.id); toast.success("Account status updated"); }}
                        aria-label={`Toggle ${u.name}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${u.name}`}
                        onClick={() => { removeUser(u.id); toast.success("User removed"); }}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No users match that search.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
