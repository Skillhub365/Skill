import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Activity, BarChart3, Bot, Boxes, Cloud, Cpu, Gauge, GhostIcon, Images, LayoutDashboard, Layers, MonitorPlay, ShieldCheck, Server, Users, FlaskConical, Wallet } from "lucide-react";
import { AppShell, type NavItem } from "@/components/layout/AppShell";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { useAuth } from "@/lib/auth";

/** Items only the Super Admin persona may see: cloud connectivity + cost. */
export const superAdminOnlyRoutes = [
  "/admin/cloud/connections",
  "/admin/cloud/image-templates",
  "/admin/cloud/vm-pool",
  "/admin/cloud/orphans",
  "/admin/cost",
];

export const adminNav: NavItem[] = [
  { label: "Overview", to: "/admin", icon: LayoutDashboard },
  { label: "Workspaces", to: "/admin/workspaces", icon: Boxes },
  { label: "Templates", to: "/admin/templates", icon: Layers },
  { label: "Labs", to: "/admin/labs", icon: FlaskConical },
  { label: "Users", to: "/admin/users", icon: Users },
  { label: "Cloud Connections", to: "/admin/cloud/connections", icon: Cloud },
  { label: "Image Templates", to: "/admin/cloud/image-templates", icon: Images },
  { label: "VM Pool", to: "/admin/cloud/vm-pool", icon: Server },
  { label: "Orphaned VMs", to: "/admin/cloud/orphans", icon: GhostIcon },
  { label: "Cost Management", to: "/admin/cost", icon: Wallet },
  { label: "Virtual Machines", to: "/admin/virtual-machines", icon: Cpu },
  { label: "Sessions", to: "/admin/sessions", icon: MonitorPlay },
  { label: "Operations", to: "/admin/operations", icon: Gauge },
  { label: "Usage Reports", to: "/admin/usage", icon: BarChart3 },
  { label: "Activity", to: "/admin/activity", icon: Activity },
  { label: "Security", to: "/admin/security", icon: ShieldCheck },
  { label: "Agent Integrations", to: "/admin/mcp", icon: Bot },
];

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { user } = useAuth();
  const superAdmin = user?.role === "superadmin";
  const nav = superAdmin ? adminNav : adminNav.filter((i) => !superAdminOnlyRoutes.includes(i.to));
  return (
    <RequireAuth role="admin">
      <AppShell nav={nav} subtitle={superAdmin ? "Super Admin Console" : "Admin Console"}>
        <Outlet />
      </AppShell>
    </RequireAuth>
  );
}
