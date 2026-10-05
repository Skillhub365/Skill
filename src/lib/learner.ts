import { useCatalog } from "./store";
import type { AuthUser } from "./auth";
import type { Lab, Workspace } from "./mock-data";

/** Labs a learner may see: published to their workspace AND assigned to them. */
export function useLearnerView(user: AuthUser | null, slug?: string) {
  const { workspaces, labs, labAssignments, workspaceUsers, sessions } = useCatalog();
  const workspace: Workspace | undefined =
    workspaces.find((w) => w.slug === (slug ?? user?.workspaceSlug)) ?? workspaces[0];

  const isMember = Boolean(
    user && workspace && (user.role === "admin" || workspaceUsers.some((wu) => wu.workspaceId === workspace.id && wu.userId === user.id)),
  );

  const published = workspace ? labs.filter((l) => l.workspaceId === workspace.id && l.status === "published") : [];
  const myLabs: Lab[] = user
    ? published.filter(
        (l) => user.role === "admin" || labAssignments.some((a) => a.userId === user.id && a.labId === l.id),
      )
    : [];

  const activeSession = user
    ? sessions.find((s) => s.status === "active" && s.user === user.name)
    : undefined;

  return { workspace, isMember, publishedLabs: published, myLabs, activeSession };
}

export function assignmentStatus(
  assignments: { userId: string; labId: string; status: string }[],
  userId: string,
  labId: string,
) {
  return assignments.find((a) => a.userId === userId && a.labId === labId)?.status ?? "assigned";
}
