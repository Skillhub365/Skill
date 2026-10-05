import { useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useAuth, homeFor, isAdminRole } from "@/lib/auth";
import type { Role } from "@/lib/mock-data";

/** Super Admin satisfies any admin-gated route; Admin never satisfies superadmin. */
function satisfies(actual: Role, required: Role) {
  if (required === "admin") return isAdminRole(actual);
  return actual === required;
}

export function RequireAuth({ role, children }: { role: Role; children: ReactNode }) {
  const { user, ready } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!ready) return;
    if (!user) navigate({ to: "/login", replace: true });
    else if (!satisfies(user.role, role)) navigate({ to: homeFor(user.role), replace: true });
  }, [ready, user, role, navigate]);

  if (!ready || !user || !satisfies(user.role, role)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Checking your access…
      </div>
    );
  }
  return <>{children}</>;
}
