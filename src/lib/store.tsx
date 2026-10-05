import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ManagedUser,
  Lab,
  LabAssignment,
  LabSession,
  LabStatus,
  Template,
  Workspace,
  WorkspaceTemplate,
  WorkspaceUser,
  SessionAuditEvent,
} from "./mock-data";
import type { PlatformEvent, PlatformEventType } from "./activity";
import type { SessionRecord } from "./session/types";
import type { LabMode, PersistencePolicy } from "./labs/persistence";
import type { WorkspaceCapability, WorkspaceCapabilityGrant } from "./security/workspace-capabilities";
import type { VmRecord } from "./vm/types";
import { authHeaders } from "./security/token-store";
import { useAuth } from "./auth";
import { useLiveRefresh, type LiveRefreshState } from "./realtime/hooks";
import { slugify, uniqueSlug, workspaceSlugFor } from "./slug";

export { slugify, uniqueSlug, workspaceSlugFor, WORKSPACE_URL_BASE, SESSION_URL_BASE } from "./slug";

/**
 * Catalogue access for the console.
 *
 * Phase 1 moved every authoritative record into the database. This provider is
 * now a thin cache over `/api/catalog`: reads come from one server-resolved
 * snapshot and writes go through tenant-scoped API routes, then refetch. The
 * browser no longer persists workspaces, labs, users, templates, assignments
 * or sessions — localStorage holds nothing but UI preferences elsewhere.
 */

interface CatalogState {
  workspaces: Workspace[];
  templates: Template[];
  workspaceTemplates: WorkspaceTemplate[];
  labs: Lab[];
  workspaceUsers: WorkspaceUser[];
  labAssignments: LabAssignment[];
  capabilityGrants: WorkspaceCapabilityGrant[];
  sessions: LabSession[];
  vms: VmRecord[];
  sessionAudit: SessionAuditEvent[];
  users: ManagedUser[];
  events: PlatformEvent[];
}

export type ManagedUserInput = {
  name: string;
  email: string;
  role: ManagedUser["role"];
  workspace: string;
  status: ManagedUser["status"];
};

export type LabInput = {
  title: string;
  description: string;
  objectives: string[];
  workspaceId: string;
  templateId: string;
  durationMinutes: number;
  level: Lab["level"];
  status: LabStatus;
  tags: string[];
  /** Session-based (disposable) or persistent (multi-day) lab. */
  labMode?: LabMode;
  defaultAccessDays?: number;
  defaultAllowedMinutes?: number;
  idleShutdownMinutes?: number;
  persistencePolicy?: PersistencePolicy;
  resetOnAccessEnd?: boolean;
};

/** Admin adjustment of one learner's persistent-lab grant. */
export type AssignmentAccessInput = {
  workspaceId: string;
  userId: string;
  labId: string;
  accessStartsAt?: string | null;
  accessEndsAt?: string | null;
  allowedMinutes?: number | null;
  addMinutes?: number;
  extendDays?: number;
  status?: "assigned" | "revoked";
  reset?: boolean;
};

interface CatalogContextValue extends CatalogState {
  loading: boolean;
  /** Supabase Realtime connection state backing the shared catalog snapshot. */
  realtime: LiveRefreshState;
  refresh: () => Promise<void>;
  createWorkspace: (input: Omit<Workspace, "id" | "createdAt" | "labs" | "users" | "activeSessions" | "template">) => Workspace;
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void;
  toggleWorkspace: (id: string) => void;
  createTemplate: (input: Omit<Template, "id" | "usedBy">) => Template;
  updateTemplate: (id: string, patch: Partial<Template>) => void;
  toggleTemplate: (id: string) => void;
  createLab: (input: LabInput) => Lab;
  updateLab: (id: string, input: Partial<LabInput>) => void;
  setLabStatus: (id: string, status: LabStatus) => void;
  addWorkspaceUser: (workspaceId: string, userId: string) => void;
  removeWorkspaceUser: (id: string) => void;
  setWorkspaceUserStatus: (id: string, status: WorkspaceUser["status"]) => void;
  toggleAssignment: (workspaceId: string, userId: string, labId: string) => void;
  setAssignmentAccess: (input: AssignmentAccessInput) => void;
  setUserCapabilities: (workspaceId: string, userId: string, capabilities: WorkspaceCapability[], actor?: string) => void;
  toggleUserCapability: (workspaceId: string, userId: string, capability: WorkspaceCapability, actor?: string) => void;
  capabilitiesFor: (workspaceId: string, userId: string) => WorkspaceCapability[];
  publishWorkspace: (id: string, published: boolean) => void;
  regenerateSlug: (id: string, custom?: string) => string;
  setPublicLanding: (id: string, enabled: boolean) => void;
  launchSession: (labId: string, userName: string) => LabSession;
  registerSession: (session: LabSession, vm: VmRecord) => void;
  upsertVm: (vm: VmRecord) => void;
  endSession: (sessionId: string) => void;
  syncSessionRecord: (record: SessionRecord) => void;
  logSessionEvent: (sessionId: string, actor: string, action: string, detail: string) => void;
  logEvent: (type: PlatformEventType, actor: string, target: string, detail: string, workspaceId?: string) => void;
  createUser: (input: ManagedUserInput) => ManagedUser;
  updateUser: (id: string, patch: Partial<ManagedUser>) => void;
  removeUser: (id: string) => void;
  toggleUser: (id: string) => void;
  reset: () => void;
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

const emptyState: CatalogState = {
  workspaces: [],
  templates: [],
  workspaceTemplates: [],
  labs: [],
  workspaceUsers: [],
  labAssignments: [],
  capabilityGrants: [],
  sessions: [],
  vms: [],
  sessionAudit: [],
  users: [],
  events: [],
};

type Snapshot = Omit<CatalogState, "vms" | "sessionAudit" | "workspaceTemplates">;

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string; code?: string };
    throw new Error(body.detail ?? body.code ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const [state, setState] = useState<CatalogState>(emptyState);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const snapshot = (await api("/api/catalog")) as Snapshot;
      setState((prev) => ({
        ...prev,
        ...snapshot,
        // Derived link table kept for components that still read it.
        workspaceTemplates: snapshot.workspaces
          .filter((w) => w.templateId)
          .map((w) => ({ workspaceId: w.id, templateId: w.templateId })),
      }));
    } catch (error) {
      console.error("[catalog] snapshot load failed", error);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setState(emptyState);
      return;
    }
    void refresh();
  }, [ready, user, refresh]);

  // Realtime first: Supabase pushes row changes for the tables that back the
  // shared catalog snapshot (sessions, VM records, audit trail, assignments)
  // and we re-read the authorised /api/catalog snapshot. RLS decides which
  // rows reach this browser; polling stays only as a fallback.
  const realtime = useLiveRefresh({
    tables: ["sessions", "session_events", "vm_records", "activity_logs", "lab_assignments"],
    refresh,
    fallbackMs: 30_000,
    liveHeartbeatMs: 180_000,
    debounceMs: 600,
    enabled: Boolean(ready && user),
  });

  const value = useMemo<CatalogContextValue>(() => {
    /** Fire a mutation, then resync from the server so state stays authoritative. */
    const mutate = (path: string, method: "POST" | "PATCH", body: unknown) => {
      void api(path, { method, body: JSON.stringify(body) })
        .then(() => refresh())
        .catch((error) => console.error(`[catalog] ${method} ${path} failed`, error));
    };

    const localVms = (updater: (vms: VmRecord[]) => VmRecord[]) =>
      setState((prev) => ({ ...prev, vms: updater(prev.vms) }));

    return {
      ...state,
      loading,
      realtime,
      refresh,

      createWorkspace: (input) => {
        mutate("/api/catalog/workspaces", "POST", {
          name: input.name,
          description: input.description,
          org: input.org,
          templateId: input.templateId,
          accessType: input.accessType,
          publicLanding: input.publicLanding,
          enabled: input.enabled,
          status: input.status,
          slug: input.slug,
        });
        return {
          ...input,
          id: `pending-${Date.now()}`,
          template: state.templates.find((t) => t.id === input.templateId)?.name ?? "Unassigned",
          labs: 0,
          users: 0,
          activeSessions: 0,
          createdAt: new Date().toISOString().slice(0, 10),
        } as Workspace;
      },

      updateWorkspace: (id, patch) => {
        mutate("/api/catalog/workspaces", "PATCH", { id, ...patch });
      },

      toggleWorkspace: (id) => {
        const target = state.workspaces.find((w) => w.id === id);
        mutate("/api/catalog/workspaces", "PATCH", {
          id,
          enabled: !target?.enabled,
          status: target?.enabled ? "archived" : "published",
        });
      },

      publishWorkspace: (id, published) => {
        mutate("/api/catalog/workspaces", "PATCH", {
          id,
          status: published ? "published" : "draft",
          ...(published ? { enabled: true } : {}),
        });
      },

      regenerateSlug: (id, custom) => {
        const ws = state.workspaces.find((w) => w.id === id);
        if (!ws) return "";
        const base = slugify(custom ?? "") || workspaceSlugFor(ws.org, ws.name);
        const next = uniqueSlug(base, state.workspaces.filter((w) => w.id !== id).map((w) => w.slug));
        mutate("/api/catalog/workspaces", "PATCH", { id, slug: next });
        return next;
      },

      setPublicLanding: (id, enabled) => {
        mutate("/api/catalog/workspaces", "PATCH", { id, publicLanding: enabled });
      },

      createTemplate: (input) => {
        mutate("/api/catalog/templates", "POST", input);
        return { ...input, id: `pending-${Date.now()}`, usedBy: 0 };
      },

      updateTemplate: (id, patch) => {
        mutate("/api/catalog/templates", "PATCH", { id, ...patch });
      },

      toggleTemplate: (id) => {
        const target = state.templates.find((t) => t.id === id);
        mutate("/api/catalog/templates", "PATCH", { id, enabled: !target?.enabled });
      },

      createLab: (input) => {
        mutate("/api/catalog/labs", "POST", input);
        const ws = state.workspaces.find((w) => w.id === input.workspaceId);
        const tpl = state.templates.find((t) => t.id === input.templateId);
        return {
          ...input,
          id: `pending-${Date.now()}`,
          workspaceSlug: ws?.slug ?? "",
          duration: input.durationMinutes,
          publishedAt: input.status === "published" ? new Date().toISOString().slice(0, 10) : null,
          vmSize: tpl?.vmSize ?? "Standard_D2s_v5",
        } as Lab;
      },

      updateLab: (id, input) => {
        mutate("/api/catalog/labs", "PATCH", { id, ...input });
      },

      setLabStatus: (id, status) => {
        mutate("/api/catalog/labs", "PATCH", { id, status });
      },

      addWorkspaceUser: (workspaceId, userId) => {
        mutate("/api/catalog/workspace-users", "POST", { action: "add", workspaceId, userId });
      },

      removeWorkspaceUser: (id) => {
        mutate("/api/catalog/workspace-users", "POST", { action: "remove", membershipId: id });
      },

      setWorkspaceUserStatus: (id, status) => {
        mutate("/api/catalog/workspace-users", "POST", { action: "status", membershipId: id, status });
      },

      toggleAssignment: (workspaceId, userId, labId) => {
        mutate("/api/catalog/assignments", "POST", { workspaceId, userId, labId });
      },

      setAssignmentAccess: (input) => {
        mutate("/api/catalog/assignments", "PATCH", input);
      },

      setUserCapabilities: (workspaceId, userId, capabilities) => {
        mutate("/api/catalog/workspace-users", "POST", { action: "capabilities", workspaceId, userId, capabilities });
      },

      toggleUserCapability: (workspaceId, userId, capability) => {
        const current =
          state.capabilityGrants.find((g) => g.workspaceId === workspaceId && g.userId === userId)?.capabilities ?? [];
        const capabilities = current.includes(capability)
          ? current.filter((c) => c !== capability)
          : [...current, capability];
        mutate("/api/catalog/workspace-users", "POST", { action: "capabilities", workspaceId, userId, capabilities });
      },

      capabilitiesFor: (workspaceId, userId) =>
        state.capabilityGrants.find((g) => g.workspaceId === workspaceId && g.userId === userId)?.capabilities ?? [],

      createUser: (input) => {
        mutate("/api/catalog/users", "POST", {
          action: "create",
          name: input.name,
          email: input.email,
          role: input.role,
          status: input.status,
        });
        return { ...input, id: `pending-${Date.now()}`, lastActive: "Never" };
      },

      updateUser: (id, patch) => {
        mutate("/api/catalog/users", "POST", {
          action: "update",
          id,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.role !== undefined ? { role: patch.role } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        });
      },

      removeUser: (id) => {
        mutate("/api/catalog/users", "POST", { action: "remove", id });
      },

      toggleUser: (id) => {
        const user = state.users.find((u) => u.id === id);
        mutate("/api/catalog/users", "POST", {
          action: "update",
          id,
          status: user?.status === "suspended" ? "active" : "suspended",
        });
      },

      /* ---- runtime state below is owned by the orchestrator, not the browser ---- */

      launchSession: (labId, userName) => {
        const lab = state.labs.find((l) => l.id === labId);
        const ws = state.workspaces.find((w) => w.id === lab?.workspaceId);
        return {
          id: `pending-${Date.now()}`,
          labTitle: lab?.title ?? "Lab",
          workspace: ws?.name ?? "",
          user: userName,
          status: "active",
          startedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          remainingMinutes: lab?.durationMinutes ?? 60,
          vm: "provisioning",
        };
      },

      registerSession: (session, vm) => {
        setState((prev) => ({
          ...prev,
          sessions: [session, ...prev.sessions.filter((s) => s.id !== session.id)],
          vms: [vm, ...prev.vms.filter((v) => v.id !== vm.id)],
        }));
        void refresh();
      },

      upsertVm: (vm) => {
        localVms((vms) => {
          const existing = vms.find((v) => v.id === vm.id);
          if (existing && JSON.stringify(existing) === JSON.stringify(vm)) return vms;
          return [vm, ...vms.filter((v) => v.id !== vm.id)];
        });
      },

      endSession: (sessionId) => {
        setState((prev) => ({
          ...prev,
          sessions: prev.sessions.map((s) => (s.id === sessionId ? { ...s, status: "completed", remainingMinutes: 0 } : s)),
          vms: prev.vms.map((v) =>
            v.sessionId === sessionId
              ? { ...v, status: "STOPPED", startedAt: null, expiresAt: null, readiness: { checked: false, ready: false, detail: "Not started" } }
              : v,
          ),
        }));
        void refresh();
      },

      syncSessionRecord: (record) => {
        const uiStatus: LabSession["status"] =
          record.status === "EXPIRED" ? "expired" : record.status === "STOPPED" || record.status === "ERROR" ? "completed" : "active";
        const remainingMinutes =
          uiStatus === "active" ? Math.max(0, Math.round((new Date(record.expiryTime).getTime() - Date.now()) / 60_000)) : 0;
        setState((prev) => {
          const existing = prev.sessions.find((s) => s.id === record.id);
          const next: LabSession = {
            id: record.id,
            labTitle: record.labName,
            workspace: record.workspaceName,
            user: record.userName,
            userId: record.userId,
            labId: record.labId,
            vm: record.vmName,
            vmId: record.vmId,
            status: uiStatus,
            startedAt: existing?.startedAt ?? new Date(record.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            remainingMinutes,
            expiresAt: record.expiryTime,
            record,
          };
          if (existing && JSON.stringify(existing) === JSON.stringify(next)) return prev;
          return { ...prev, sessions: [next, ...prev.sessions.filter((s) => s.id !== record.id)] };
        });
      },

      logSessionEvent: (sessionId, actor, action, detail) => {
        setState((prev) => {
          if (prev.sessionAudit.some((e) => e.sessionId === sessionId && e.action === action)) return prev;
          const event: SessionAuditEvent = {
            id: `sev-${Math.random().toString(16).slice(2, 10)}`,
            sessionId,
            actor,
            action,
            detail,
            at: new Date().toISOString(),
          };
          return { ...prev, sessionAudit: [event, ...prev.sessionAudit].slice(0, 100) };
        });
      },

      // Audit records are written server-side by the repositories; the console
      // just re-reads the durable feed.
      logEvent: () => {
        void refresh();
      },

      reset: () => {
        void refresh();
      },
    };
  }, [state, loading, realtime, refresh]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalog must be used inside CatalogProvider");
  return ctx;
}
