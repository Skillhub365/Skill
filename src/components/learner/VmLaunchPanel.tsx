import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, CircleDot, Loader2, MonitorPlay, Power, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useCatalog } from "@/lib/store";
import { useSessionStream } from "@/lib/realtime/useSessionStream";
import { PHASE_LABEL, PHASE_PROGRESS, type LifecycleEvent } from "@/lib/cloud/types";
import { getVmStatus, startVm, stopVm } from "@/lib/vm/client";
import { VM_STEPS, stepState, type VmRecord } from "@/lib/vm/types";

const PROGRESS: Record<string, number> = {
  STOPPED: 0,
  STARTING: 25,
  BOOTING: 50,
  RUNNING: 70,
  READINESS_CHECK: 88,
  READY: 100,
  STOPPING: 10,
  ERROR: 100,
};

export function VmLaunchPanel({
  vm: initial,
  sessionId,
  onConnect,
  onVmChange,
  onStopRequest,
}: {
  vm: VmRecord;
  sessionId: string;
  onConnect?: () => void;
  onVmChange?: (vm: VmRecord) => void;
  /** Delegates stopping to the session lifecycle owner (server-authoritative). */
  onStopRequest?: () => void;
}) {
  const { upsertVm, endSession } = useCatalog();
  const [vm, setVm] = useState<VmRecord>(initial);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<LifecycleEvent | null>(null);
  const upsertRef = useRef(upsertVm);
  upsertRef.current = upsertVm;
  const changeRef = useRef(onVmChange);
  changeRef.current = onVmChange;

  useEffect(() => {
    changeRef.current?.(vm);
  }, [vm]);

  const settled = vm.status === "READY" || vm.status === "STOPPED" || vm.status === "ERROR";

  const refresh = useCallback(async (current: VmRecord) => {
    try {
      const next = await getVmStatus(current);
      setVm(next);
      upsertRef.current(next);
      return next;
    } catch {
      return current;
    }
  }, []);

  // Real-time: the backend polls the cloud provider and pushes lifecycle
  // events down this stream. The browser never contacts Azure itself.
  const { connected: streaming } = useSessionStream(sessionId, (event) => {
    setLive(event);
    // Reconcile the full machine record whenever the phase moves on.
    void refresh(vm);
  });

  // Fallback only: if the stream is unavailable we degrade to slow polling of
  // our own API (still never the provider).
  useEffect(() => {
    if (settled || streaming) return;
    const id = window.setInterval(() => {
      void refresh(vm);
    }, 2500);
    return () => window.clearInterval(id);
  }, [vm, settled, streaming, refresh]);

  const handleStart = async () => {
    setBusy(true);
    try {
      const next = await startVm(vm, 60);
      setVm(next);
      upsertVm(next);
      toast.success("Start request sent to the VM orchestrator");
    } catch {
      toast.error("Could not start the VM");
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    if (onStopRequest) {
      onStopRequest();
      return;
    }
    setBusy(true);
    try {
      const next = await stopVm(vm);
      if (next) {
        setVm(next);
        upsertVm(next);
      }
      endSession(sessionId);
      toast.success("Lab stopped", { description: "The VM has been deallocated." });
    } catch {
      toast.error("Could not stop the VM");
    } finally {
      setBusy(false);
    }
  };

  const ready = vm.status === "READY";

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardContent className="p-6">
          {ready ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">VM Status: READY</p>
                  <p className="text-xs text-muted-foreground">{vm.readiness.detail}</p>
                </div>
                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">READY</Badge>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={() => onConnect?.()}>
                  <MonitorPlay className="size-4" /> Connect to VM
                </Button>
                <Button variant="outline" onClick={() => void handleStop()} disabled={busy}>
                  <Square className="size-4" /> Stop Lab
                </Button>
                <Button variant="ghost" onClick={() => void refresh(vm)}>
                  <RefreshCw className="size-4" /> Refresh
                </Button>
              </div>
              <div className="mt-6 rounded-lg border border-dashed border-border p-10 text-center">
                <p className="text-sm text-muted-foreground">
                  Select “Connect to VM” to open the browser-based remote desktop. Your session stays inside
                  SkillTrack Labs — no RDP client, public IP or Azure credentials required.
                </p>
              </div>
            </>
          ) : vm.status === "ERROR" ? (
            <div className="text-center">
              <AlertTriangle className="mx-auto size-8 text-destructive" />
              <p className="mt-2 text-sm font-semibold">The VM failed to start</p>
              <p className="mt-1 text-sm text-muted-foreground">{vm.error ?? vm.message}</p>
              <Button className="mt-4" onClick={() => void handleStart()} disabled={busy}>
                <Power className="size-4" /> Retry start
              </Button>
            </div>
          ) : vm.status === "STOPPED" ? (
            <div className="text-center">
              <Power className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-semibold">Lab environment is stopped</p>
              <p className="mt-1 text-sm text-muted-foreground">{vm.message}</p>
              <Button className="mt-4" onClick={() => void handleStart()} disabled={busy}>
                <Power className="size-4" /> Start Lab
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-primary" />
                <p className="text-sm font-semibold">Starting your lab</p>
              </div>
              <Progress
                className="mt-4"
                value={Math.max(PROGRESS[vm.status] ?? 0, live ? PHASE_PROGRESS[live.phase] : 0)}
              />
              <ul className="mt-5 space-y-2.5">
                {VM_STEPS.map((step, i) => {
                  const s = stepState(vm.status, i);
                  return (
                    <li key={step.key} className="flex items-center gap-2.5 text-sm">
                      {s === "done" ? (
                        <Check className="size-4 text-emerald-600" />
                      ) : s === "active" ? (
                        <CircleDot className="size-4 animate-pulse text-primary" />
                      ) : (
                        <span className="size-4 rounded-full border border-muted-foreground/40" />
                      )}
                      <span className={s === "todo" ? "text-muted-foreground" : "font-medium"}>{step.label}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-5 text-xs text-muted-foreground">{live?.message ?? vm.message}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {streaming
                  ? `Live updates · ${live ? PHASE_LABEL[live.phase] : "waiting for the cloud controller"}`
                  : "Reconnecting to live updates…"}
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => void handleStop()} disabled={busy}>
                <Square className="size-4" /> Cancel and stop
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <p className="text-sm font-semibold">Machine</p>
          <dl className="mt-3 space-y-2.5 text-xs">
            <Row label="Name" value={vm.name} />
            <Row label="Provider" value={vm.provider} />
            <Row label="Region" value={vm.region} />
            <Row label="Size" value={vm.size} />
            <Row label="Image" value={vm.image} />
            <Row label="Status" value={vm.status} />
            <Row label="Started" value={vm.startedAt ? new Date(vm.startedAt).toLocaleTimeString() : "—"} />
            <Row label="Expires" value={vm.expiresAt ? new Date(vm.expiresAt).toLocaleTimeString() : "—"} />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="max-w-[60%] break-words text-right font-medium">{value}</dd>
    </div>
  );
}