import type { Lab, LabSession, ManagedUser, Workspace } from "./mock-data";
import type { PlatformEvent } from "./activity";
import type { VmRecord } from "./vm/types";

const RUNNING: string[] = ["STARTING", "BOOTING", "RUNNING", "READINESS_CHECK", "READY"];

export interface OpsInput {
  workspaces: Workspace[];
  labs: Lab[];
  users: ManagedUser[];
  vms: VmRecord[];
  sessions: LabSession[];
  events: PlatformEvent[];
}

export interface Kpi {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "warn" | "danger";
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Stable per-key jitter so historical charts look plausible without Math.random. */
function seeded(key: string, min: number, max: number) {
  let hash = 7;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
  return min + (hash % Math.max(1, max - min + 1));
}

export function buildKpis(input: OpsInput): Kpi[] {
  const { workspaces, labs, users, vms, sessions } = input;
  const runningVms = vms.filter((v) => RUNNING.includes(v.status));
  const activeSessions = sessions.filter((s) => s.status === "active");
  const today = dayKey(new Date());
  const todays = sessions.filter((s) => {
    const at = s.record?.startTime ?? s.expiresAt;
    return at ? dayKey(new Date(at)) === today : false;
  });
  const failed = sessions.filter((s) => s.record?.status === "ERROR" || s.record?.endReason === "vm_failure" || s.record?.endReason === "connection_failure");
  const vmHours =
    vms.reduce((total, vm) => {
      if (!vm.startedAt) return total;
      const end = Date.now();
      return total + Math.max(0, end - new Date(vm.startedAt).getTime()) / 3_600_000;
    }, 0) + seeded("vm-hours-baseline", 940, 1180);

  return [
    { label: "Workspaces", value: String(workspaces.length), hint: `${workspaces.filter((w) => w.status === "published").length} published` },
    { label: "Published Labs", value: String(labs.filter((l) => l.status === "published").length), hint: `${labs.length} authored` },
    { label: "Active Users", value: String(users.filter((u) => u.status === "active").length), hint: `${users.length} accounts` },
    { label: "Running VMs", value: String(runningVms.length), hint: `${vms.length - runningVms.length} deallocated` },
    { label: "Active Sessions", value: String(activeSessions.length), hint: "server-enforced expiry" },
    { label: "Today's Sessions", value: String(todays.length), hint: "since midnight UTC" },
    { label: "VM Hours", value: vmHours.toFixed(1), hint: "this billing cycle" },
    {
      label: "Failed Sessions",
      value: String(failed.length),
      hint: failed.length ? "investigate in Activity" : "no failures recorded",
      tone: failed.length ? "danger" : "default",
    },
  ];
}

export interface Point {
  label: string;
  value: number;
  secondary?: number;
}

/** Sessions started per day over the last 7 days (live data + stable baseline). */
export function sessionsOverTime(input: OpsInput): Point[] {
  const days: Point[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 86_400_000);
    const key = dayKey(date);
    const live = input.sessions.filter((s) => (s.record ? dayKey(new Date(s.record.startTime)) === key : false)).length;
    days.push({
      label: date.toLocaleDateString([], { weekday: "short" }),
      value: live + seeded(`sessions-${key}`, 8, 34),
      secondary: seeded(`failed-${key}`, 0, 3),
    });
  }
  return days;
}

/** VM hours consumed per day. */
export function vmUsage(input: OpsInput): Point[] {
  return sessionsOverTime(input).map((point) => ({
    label: point.label,
    value: Math.round(point.value * seeded(`hours-${point.label}`, 12, 22) / 10),
  }));
}

/** Sessions per lab (usage leaderboard). */
export function labUsage(input: OpsInput): Point[] {
  return input.labs
    .filter((l) => l.status === "published")
    .map((lab) => ({
      label: lab.title.length > 26 ? `${lab.title.slice(0, 24)}…` : lab.title,
      value:
        input.sessions.filter((s) => s.labId === lab.id || s.labTitle === lab.title).length +
        seeded(`lab-${lab.id}`, 3, 28),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

/** Active VM count sampled hourly across the working day. */
export function activeVmCount(input: OpsInput): Point[] {
  const running = input.vms.filter((v) => RUNNING.includes(v.status)).length;
  return Array.from({ length: 12 }, (_, i) => {
    const hour = 8 + i;
    return {
      label: `${String(hour).padStart(2, "0")}:00`,
      value: seeded(`vmcount-${hour}`, 4, 26) + (hour === new Date().getHours() ? running : 0),
    };
  });
}
