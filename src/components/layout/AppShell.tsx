import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type ComponentType, type ReactNode } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { Brand } from "./Brand";
import { DegradedModeBanner } from "@/components/admin/DegradedModeBanner";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
}

export function AppShell({
  nav,
  subtitle,
  children,
}: {
  nav: NavItem[];
  subtitle: string;
  children: ReactNode;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const initials = (user?.name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);

  const links = (
    <nav className="flex flex-col gap-1">
      {nav.map((item) => {
        const active = pathname === item.to || (item.to !== "/admin" && item.to !== "/app" && pathname.startsWith(item.to));
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60",
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar p-4 lg:flex">
        <Brand subtitle={subtitle} />
        <div className="mt-6 flex-1">{links}</div>
        <div className="rounded-xl border border-sidebar-border p-3">
          <p className="text-xs text-muted-foreground">Signed in as</p>
          <p className="truncate text-sm font-semibold">{user?.name}</p>
          <Badge variant="secondary" className="mt-2 capitalize">
            {user?.role}
          </Badge>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              {open ? <Menu className="size-5" /> : <Menu className="size-5" />}
            </Button>
            <div className="lg:hidden">
              <Brand subtitle={subtitle} />
            </div>
            <p className="hidden text-sm text-muted-foreground lg:block">{subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              <AvatarFallback className="bg-accent text-xs text-accent-foreground">{initials}</AvatarFallback>
            </Avatar>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                signOut();
                navigate({ to: "/login", replace: true });
              }}
            >
              <LogOut className="size-4" /> Sign out
            </Button>
          </div>
        </header>

        {open ? (
          <div className="border-b border-border bg-sidebar p-4 lg:hidden">
            <div className="mb-2 flex justify-end">
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close navigation">
                <X className="size-4" />
              </Button>
            </div>
            {links}
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">
          <DegradedModeBanner />
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
