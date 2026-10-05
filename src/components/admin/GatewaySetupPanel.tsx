/**
 * Super Admin: deploy and verify the remote desktop gateway.
 *
 * The form stores where the gateway lives and which service account to use;
 * "Verify reachability" proves both legs of the path — app to gateway, and
 * gateway into the lab network — and that verdict is what unblocks learner
 * lab sessions. Nothing sensitive is ever rendered back.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MinusCircle,
  PlugZap,
  Save,
  ShieldCheck,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { fetchGatewaySetup, saveGatewaySetup, verifyGatewaySetup } from "@/lib/remote-desktop/setup-client";
import type { GatewaySetupCheck, GatewaySetupStatus } from "@/lib/remote-desktop/gateway-setup-types";
import { validateGatewaySettings } from "@/lib/remote-desktop/gateway-setup-types";

function CheckIcon({ status }: { status: GatewaySetupCheck["status"] }) {
  if (status === "pass") return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success" />;
  if (status === "fail") return <XCircle className="mt-0.5 h-3.5 w-3.5 text-destructive" />;
  if (status === "warn") return <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning" />;
  return <MinusCircle className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />;
}

export function GatewaySetupPanel({
  machines = [],
  onVerified,
}: {
  machines?: Array<{ id: string; name: string }>;
  onVerified?: () => void;
}) {
  const [status, setStatus] = useState<GatewaySetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [form, setForm] = useState({
    baseUrl: "",
    publicUrl: "",
    username: "",
    password: "",
    dataSource: "postgresql",
  });
  const [probeVmId, setProbeVmId] = useState<string>("auto");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchGatewaySetup();
      setStatus(next);
      setForm((prev) => ({
        ...prev,
        baseUrl: prev.baseUrl || (next.baseUrlHost ? `https://${next.baseUrlHost}/guacamole` : ""),
        publicUrl: prev.publicUrl || next.publicUrl || "",
        username: prev.username || next.username || "",
        dataSource: next.dataSource || "postgresql",
      }));
    } catch (error) {
      toast.error((error as Error)?.message ?? "The gateway settings could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const problem = validateGatewaySettings(form);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      setStatus(await saveGatewaySetup(form));
      setForm((prev) => ({ ...prev, password: "" }));
      toast.success("Gateway settings stored. Verify reachability to allow lab sessions.");
    } catch (error) {
      toast.error((error as Error)?.message ?? "The gateway settings could not be stored.");
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    setVerifying(true);
    try {
      const result = await verifyGatewaySetup(probeVmId === "auto" ? null : probeVmId);
      setStatus(result.status);
      if (result.verification.passed) toast.success(result.verification.summary);
      else toast.error(result.verification.summary);
      onVerified?.();
    } catch (error) {
      toast.error((error as Error)?.message ?? "The verification could not be completed.");
    } finally {
      setVerifying(false);
    }
  };

  const verification = status?.lastVerification ?? null;
  const blocked = Boolean(status?.verificationRequired && !status.verificationValid);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <PlugZap className="h-4 w-4" /> Remote desktop gateway
          {status ? (
            blocked ? (
              <Badge variant="destructive" className="gap-1">
                <ShieldAlert className="h-3 w-3" /> Lab sessions blocked
              </Badge>
            ) : status.verificationValid ? (
              <Badge variant="secondary" className="gap-1">
                <ShieldCheck className="h-3 w-3" /> Reachability verified
              </Badge>
            ) : (
              <Badge variant="outline">Verification not required in {status.environment}</Badge>
            )
          ) : null}
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Deploy the gateway stack inside (or peered to) the lab network, then point SkillTrack at it. Learner sessions
          stay blocked until reachability is verified from both the app and the lab network, and a verification stays
          valid for {status?.validForDays ?? 7} days.
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="gw-internal">Internal gateway URL</Label>
            <Input
              id="gw-internal"
              placeholder="http://guacamole:8080/guacamole"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gw-public">Browser-facing URL (HTTPS)</Label>
            <Input
              id="gw-public"
              placeholder="https://labs.example.com"
              value={form.publicUrl}
              onChange={(e) => setForm({ ...form, publicUrl: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gw-user">Service account username</Label>
            <Input
              id="gw-user"
              placeholder="skilltrack-service"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gw-pass">Service account password</Label>
            <Input
              id="gw-pass"
              type="password"
              placeholder={status?.configured ? "Stored — leave blank to keep" : "At least 12 characters"}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gw-ds">Authentication data source</Label>
            <Input
              id="gw-ds"
              placeholder="postgresql"
              value={form.dataSource}
              onChange={(e) => setForm({ ...form, dataSource: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Verify against machine</Label>
            <Select value={probeVmId} onValueChange={setProbeVmId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose automatically" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Choose automatically</SelectItem>
                {machines.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save gateway settings
          </Button>
          <Button variant="outline" onClick={() => void verify()} disabled={verifying || !status?.configured}>
            {verifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Verify reachability
          </Button>
          {status?.labCredentialsConfigured ? null : (
            <span className="text-xs text-warning">Lab image RDP credentials are not configured yet.</span>
          )}
        </div>

        {verification ? (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={verification.passed ? "secondary" : "destructive"}>
                {verification.passed ? "Verified" : "Not verified"}
              </Badge>
              {verification.gatewayHost ? <Badge variant="outline">{verification.gatewayHost}</Badge> : null}
              {verification.probeVmName ? <Badge variant="outline">Probe: {verification.probeVmName}</Badge> : null}
              <span>
                {new Date(verification.verifiedAt).toLocaleString()} · {verification.durationMs} ms
                {verification.verifiedBy ? ` · ${verification.verifiedBy}` : ""}
              </span>
            </div>
            <p className="text-sm">{verification.summary}</p>
            <ul className="space-y-1.5">
              {verification.checks.map((c) => (
                <li key={c.id} className="flex gap-2 text-xs">
                  <CheckIcon status={c.status} />
                  <span>
                    <span className="font-medium">{c.label}</span>
                    <span className="text-muted-foreground"> — {c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
