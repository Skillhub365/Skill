import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, TimerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { SessionRecord } from "@/lib/session/types";

const COPY: Record<string, { title: string; body: string }> = {
  EXPIRED: {
    title: "Session expired",
    body: "Your allotted lab time has elapsed. The remote connection was closed and the virtual machine was deallocated.",
  },
  STOPPED: {
    title: "Session stopped",
    body: "This lab session has ended and the virtual machine was deallocated.",
  },
  ERROR: {
    title: "Session ended with an error",
    body: "The lab environment reported a failure. No virtual machine is left running.",
  },
};

export function SessionEndedScreen({ session, workspaceSlug }: { session: SessionRecord; workspaceSlug: string }) {
  const copy = COPY[session.status] ?? COPY["STOPPED"]!;
  const expired = session.status === "EXPIRED";
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <Card className="w-full max-w-lg text-center shadow-[var(--shadow-elevated)]">
        <CardContent className="p-10">
          {expired ? (
            <TimerOff className="mx-auto size-10 text-destructive" />
          ) : (
            <AlertTriangle className="mx-auto size-10 text-muted-foreground" />
          )}
          <h1 className="mt-4 text-xl font-bold tracking-tight">{copy.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
          <dl className="mx-auto mt-6 grid max-w-sm grid-cols-2 gap-x-4 gap-y-2 text-left text-xs">
            <dt className="text-muted-foreground">Lab</dt>
            <dd className="font-medium">{session.labName}</dd>
            <dt className="text-muted-foreground">Machine</dt>
            <dd className="font-medium">{session.vmName} · stopped</dd>
            <dt className="text-muted-foreground">Started</dt>
            <dd className="font-medium">{new Date(session.startTime).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Ended</dt>
            <dd className="font-medium">{session.endedAt ? new Date(session.endedAt).toLocaleString() : "—"}</dd>
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="font-medium">
              {session.durationMinutes + session.extendedMinutes} min
              {session.extendedMinutes ? ` (incl. ${session.extendedMinutes} min extension)` : ""}
            </dd>
          </dl>
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link to="/workspace/$slug" params={{ slug: workspaceSlug }}>
                <ArrowLeft className="size-4" /> Back to workspace
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/app/labs">My labs</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
