import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Boxes, FlaskConical, Home, MonitorPlay, User } from "lucide-react";
import { AppShell, type NavItem } from "@/components/layout/AppShell";
import { RequireAuth } from "@/components/layout/RequireAuth";

export const userNav: NavItem[] = [
  { label: "Home", to: "/app", icon: Home },
  { label: "My Workspace", to: "/app/workspace", icon: Boxes },
  { label: "My Labs", to: "/app/labs", icon: FlaskConical },
  { label: "Sessions", to: "/app/sessions", icon: MonitorPlay },
  { label: "Profile", to: "/app/profile", icon: User },
];

export const Route = createFileRoute("/app")({
  component: UserLayout,
});

function UserLayout() {
  return (
    <RequireAuth role="user">
      <AppShell nav={userNav} subtitle="Learner Workspace">
        <Outlet />
      </AppShell>
    </RequireAuth>
  );
}
