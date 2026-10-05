/**
 * Remote-desktop readiness report for one pooled machine.
 *
 * The checklist mirrors the real learner path (gateway -> guacd -> RDP -> VM).
 * The server deliberately returns only pass/fail/skip plus a plain-language
 * reason, so nothing here can leak an address, a token or a credential.
 */
import { CheckCircle2, Loader2, MinusCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { RdpTestResult } from "@/lib/vm/pool/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vmName: string;
  running: boolean;
  result: RdpTestResult | null;
  onRerun: () => void;
}

export function VmRdpTestDialog({ open, onOpenChange, vmName, running, result, onRerun }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Remote desktop readiness — {vmName}</DialogTitle>
          <DialogDescription>
            Every step is checked from the platform server. Network addresses and sign-in details stay on the server.
          </DialogDescription>
        </DialogHeader>

        {running && !result ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Running the connection checklist…
          </p>
        ) : null}

        {result ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={result.ready ? "default" : "destructive"}>
                {result.ready ? "Ready to connect" : "Not ready"}
              </Badge>
              <Badge variant="outline">Desktop mode: {result.mode}</Badge>
              <span className="text-xs text-muted-foreground">
                Checked {new Date(result.checkedAt).toLocaleTimeString()} · {result.durationMs} ms
              </span>
            </div>
            <p className="text-sm">{result.summary}</p>
            <ul className="space-y-2">
              {result.steps.map((s) => (
                <li key={s.label} className="flex items-start gap-3 rounded-md border p-3">
                  {s.status === "pass" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                  ) : s.status === "fail" ? (
                    <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                  ) : (
                    <MinusCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{s.label}</p>
                    <p className="text-xs text-muted-foreground">{s.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={onRerun} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Run again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
