import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Lock, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  VALIDATION_STEP_LABEL,
  type CloudConnection,
  type ValidationResult,
  type ValidationStepId,
} from "@/lib/cloud/connections/types";
import { createConnection, updateConnection, validateDraft, type ConnectionDraft } from "@/lib/cloud/connections/client";
import { ApiError } from "@/lib/errors";

const STEP_ORDER: ValidationStepId[] = ["authenticate", "connect", "subscription", "resource-groups", "permissions"];

const emptyDraft: ConnectionDraft = {
  name: "",
  tenantId: "",
  subscriptionId: "",
  clientId: "",
  clientSecret: "",
  defaultResourceGroup: "",
  defaultRegion: "",
  description: "",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection?: CloudConnection | null;
  onSaved: (connection: CloudConnection) => void;
}

/**
 * Connect Azure Subscription.
 *
 * The credentials are posted straight to the server, which performs a REAL
 * Azure authentication and permission check before anything is saved. The
 * client secret is write-only: it is never sent back to the browser.
 */
export function AzureConnectionDialog({ open, onOpenChange, connection, onSaved }: Props) {
  const editing = Boolean(connection);
  const [draft, setDraft] = useState<ConnectionDraft>(emptyDraft);
  const [busy, setBusy] = useState<"idle" | "validating" | "saving">("idle");
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setBusy("idle");
    setDraft(
      connection
        ? {
            name: connection.name,
            tenantId: connection.tenantId,
            subscriptionId: connection.subscriptionId,
            clientId: connection.clientId,
            clientSecret: "",
            defaultResourceGroup: connection.defaultResourceGroup ?? "",
            defaultRegion: connection.defaultRegion ?? "",
            description: connection.description,
          }
        : emptyDraft,
    );
  }, [open, connection]);

  const set = (key: keyof ConnectionDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const requiredFilled =
    draft.name.trim() && draft.tenantId.trim() && draft.subscriptionId.trim() && draft.clientId.trim() &&
    (editing || draft.clientSecret.trim());

  async function runTest() {
    setBusy("validating");
    setError(null);
    setResult(null);
    try {
      const { result: outcome } = await validateDraft({ ...draft, ...(connection ? { connectionId: connection.id } : {}) });
      setResult(outcome);
      if (!outcome.ok) setError(outcome.message);
    } catch (caught) {
      const api = caught as ApiError & { result?: ValidationResult };
      if (api.result) setResult(api.result);
      setError(api.message);
    } finally {
      setBusy("idle");
    }
  }

  async function save() {
    setBusy("saving");
    setError(null);
    try {
      if (editing && connection) {
        const patch: Partial<ConnectionDraft> = { ...draft };
        if (!draft.clientSecret.trim()) delete patch.clientSecret;
        const { connection: saved } = await updateConnection(connection.id, patch);
        onSaved(saved);
      } else {
        const { connection: saved, result: outcome } = await createConnection(draft);
        setResult(outcome);
        onSaved(saved);
      }
      onOpenChange(false);
    } catch (caught) {
      const api = caught as ApiError & { result?: ValidationResult };
      if (api.result) setResult(api.result);
      setError(api.message);
    } finally {
      setBusy("idle");
    }
  }

  const stepState = (id: ValidationStepId) => {
    const step = result?.steps.find((s) => s.id === id);
    if (step) return step;
    if (busy === "validating") {
      const done = result?.steps.length ?? 0;
      return STEP_ORDER.indexOf(id) === done ? { id, state: "running" as const, detail: "", durationMs: 0 } : null;
    }
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Azure connection" : "Connect Azure subscription"}</DialogTitle>
          <DialogDescription>
            SkillTrack authenticates to Azure with this service principal from the backend only. Your browser never
            talks to Azure.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Connection name" className="sm:col-span-2">
            <Input value={draft.name} onChange={(e) => set("name")(e.target.value)} placeholder="Production — East US" />
          </Field>
          <Field label="Tenant ID (Directory ID)">
            <Input value={draft.tenantId} onChange={(e) => set("tenantId")(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
          </Field>
          <Field label="Subscription ID">
            <Input value={draft.subscriptionId} onChange={(e) => set("subscriptionId")(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
          </Field>
          <Field label="Client ID (Application ID)">
            <Input value={draft.clientId} onChange={(e) => set("clientId")(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
          </Field>
          <Field label={editing ? "Client secret (leave blank to keep)" : "Client secret"}>
            <Input
              type="password"
              autoComplete="new-password"
              value={draft.clientSecret}
              onChange={(e) => set("clientSecret")(e.target.value)}
              placeholder="••••••••••••••••"
            />
          </Field>
          <Field label="Default resource group (optional)">
            <Input value={draft.defaultResourceGroup} onChange={(e) => set("defaultResourceGroup")(e.target.value)} placeholder="rg-skilltrack-labs" />
          </Field>
          <Field label="Default region (optional)">
            <Input value={draft.defaultRegion} onChange={(e) => set("defaultRegion")(e.target.value)} placeholder="eastus" />
          </Field>
          <Field label="Notes (optional)" className="sm:col-span-2">
            <Textarea rows={2} value={draft.description} onChange={(e) => set("description")(e.target.value)} />
          </Field>
        </div>

        <p className="flex items-start gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The client secret is stored in the platform secret vault and replaced by a reference in the database. It is
          never written to logs and never returned to any browser.
        </p>

        {(result || busy === "validating") && (
          <div className="rounded-md border p-3">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" /> Live Azure validation
            </p>
            <ul className="space-y-1.5">
              {STEP_ORDER.map((id) => {
                const step = stepState(id);
                return (
                  <li key={id} className="flex items-start gap-2 text-sm">
                    {step?.state === "ok" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                    ) : step?.state === "failed" ? (
                      <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                    ) : step?.state === "running" ? (
                      <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                    )}
                    <span className={cn("flex-1", !step && "text-muted-foreground")}>
                      {VALIDATION_STEP_LABEL[id]}
                      {step?.detail ? <span className="block text-xs text-muted-foreground">{step.detail}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            {result?.permissions.length ? (
              <ul className="mt-3 grid gap-1 border-t pt-2 text-xs sm:grid-cols-2">
                {result.permissions.map((p) => (
                  <li key={p.action} className="flex items-center gap-1.5">
                    {p.allowed ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <XCircle className="h-3 w-3 text-destructive" />
                    )}
                    <span className={p.allowed ? "text-muted-foreground" : "text-destructive"}>{p.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={runTest} disabled={!requiredFilled || busy !== "idle"}>
            {busy === "validating" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Test connection
          </Button>
          <Button onClick={save} disabled={!requiredFilled || busy !== "idle"}>
            {busy === "saving" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {editing ? "Save changes" : "Validate & connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}
