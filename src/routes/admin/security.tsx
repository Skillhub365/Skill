import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, KeyRound, Lock, Network, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorNotice } from "@/components/layout/ErrorNotice";
import { InfrastructurePanel } from "@/components/admin/InfrastructurePanel";
import { useAuth } from "@/lib/auth";
import { capabilities } from "@/lib/security/types";

export const Route = createFileRoute("/admin/security")({
  head: () => ({
    meta: [
      { title: "Security & Compliance — SkillTrack Labs" },
      { name: "description", content: "Review authentication, authorization, secret storage and network posture for SkillTrack Labs." },
      { property: "og:title", content: "Security & Compliance — SkillTrack Labs" },
      { property: "og:description", content: "Enterprise security posture for the SkillTrack Labs cloud lab platform." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SecurityPage,
});

interface SecretItem {
  name: string;
  purpose: string;
  group: string;
  required: boolean;
  configured: boolean;
}

interface CheckResult {
  key: string;
  label: string;
  severity: "ok" | "warning" | "error";
  detail: string;
}

interface Posture {
  secrets: {
    provider: string;
    vaultConfigured: boolean;
    vaultAuthMode: string;
    vault: { configured: boolean; reachable: boolean; uriHost: string | null; detail: string };
    items: SecretItem[];
  };
  validation: { environment: string; valid: boolean; errors: CheckResult[]; warnings: CheckResult[]; checks: CheckResult[] };
  auth: {
    provider: string;
    passwordAuthEnabled: boolean;
    microsoftSignInEnabled: boolean;
    entraDirectSso: boolean;
    localTokenMinting: boolean;
  };
  fallback: { devFallbackActive: boolean; emergencyFallbackActive: boolean; degraded: boolean; reasons: string[] };
  audit: Array<{ id: string; action: string; detail: string; userName: string; at: string }>;
}

const NETWORK_PATH = [
  "Internet",
  "HTTPS 443 (TLS)",
  "SkillTrack Labs application",
  "Remote Desktop Gateway",
  "Private Azure VNet",
  "Private Azure VM (RDP 3389, never public)",
];

function SecurityPage() {
  const { authHeaders, providers } = useAuth();
  const [posture, setPosture] = useState<Posture | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    fetch("/api/security/posture", { headers: authHeaders() })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw Object.assign(new Error("posture"), { code: data.code });
        setPosture(data as Posture);
      })
      .catch(setError);
  }, [authHeaders]);

  return (
    <div className="space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Security &amp; Compliance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Authentication, authorization, secret storage and network isolation for this deployment.
        </p>
      </header>

      {error ? <ErrorNotice error={error} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <InfrastructurePanel />
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <CardTitle className="text-base">Authentication</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Username &amp; password" value={<Badge variant="secondary">Enabled</Badge>} />
            <Row
              label="Microsoft Entra ID (SSO)"
              value={
                <Badge variant={providers?.entra.enabled ? "secondary" : "outline"}>
                  {providers?.entra.enabled ? "Enabled" : "Ready — awaiting tenant configuration"}
                </Badge>
              }
            />
            <Row
              label="Direct Entra SSO"
              value={
                <Badge variant={posture?.auth.entraDirectSso ? "secondary" : "outline"}>
                  {posture?.auth.entraDirectSso ? "Enabled" : "Brokered through the platform identity service"}
                </Badge>
              }
            />
            <Row
              label="Local token minting"
              value={<Badge variant={posture?.auth.localTokenMinting ? "destructive" : "secondary"}>Disabled</Badge>}
            />
            <Row
              label="Sessions"
              value={<span className="text-muted-foreground">Issued, rotated and revoked by the identity service</span>}
            />
            <p className="pt-2 text-xs text-muted-foreground">
              Every API request is verified server-side across user → organisation → workspace → lab → session → VM.
              A workspace or session URL is an entry point, never an authorization.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Lock className="size-4 text-primary" />
            <CardTitle className="text-base">Role permissions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {(["admin", "user"] as const).map((role) => (
              <div key={role}>
                <p className="text-sm font-semibold capitalize">{role}</p>
                <ul className="mt-2 space-y-1">
                  {capabilities[role].map((cap) => (
                    <li key={cap} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="size-3.5 text-primary" />
                      {cap}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Network className="size-4 text-primary" />
            <CardTitle className="text-base">Network architecture</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {NETWORK_PATH.map((hop, i) => (
                <li key={hop} className="flex items-center gap-3 text-sm">
                  <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {i + 1}
                  </span>
                  {hop}
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">
              Lab machines have no public IP. RDP is reachable only from the gateway inside the private VNet; learners
              connect over HTTPS/WSS on port 443.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            <CardTitle className="text-base">Secret storage</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Provider: <span className="font-medium text-foreground">{posture?.secrets.provider ?? "…"}</span>
              {posture?.secrets.vault.configured
                ? ` · ${posture.secrets.vault.uriHost ?? "key vault"} · ${posture.secrets.vaultAuthMode} · ${
                    posture.secrets.vault.reachable ? "reachable" : "unreachable"
                  }`
                : " · reading from the server environment"}
            </p>
            <ul className="space-y-2">
              {(posture?.secrets.items ?? []).map((item) => (
                <li key={item.name} className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.purpose}</p>
                  </div>
                  {item.configured ? (
                    <Badge variant="secondary" className="shrink-0">Configured</Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 gap-1">
                      <CircleAlert className="size-3" />
                      {item.required ? "Pending" : "Optional"}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <CircleAlert className="size-4 text-primary" />
          <CardTitle className="text-base">
            Environment validation
            {posture ? (
              <Badge className="ml-2" variant={posture.validation.valid ? "secondary" : "destructive"}>
                {posture.validation.valid ? "Passing" : `${posture.validation.errors.length} problem(s)`}
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Environment: <span className="font-medium text-foreground">{posture?.validation.environment ?? "…"}</span>
            {posture?.fallback.emergencyFallbackActive ? " · emergency mock fallback is active" : ""}
            {posture?.fallback.degraded && posture.fallback.reasons.length
              ? ` · ${posture.fallback.reasons.join(" ")}`
              : ""}
          </p>
          <ul className="space-y-2">
            {(posture?.validation.checks ?? []).map((check) => (
              <li key={check.key} className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
                <div>
                  <p className="text-sm font-medium">{check.label}</p>
                  <p className="text-xs text-muted-foreground">{check.detail}</p>
                </div>
                <Badge
                  className="shrink-0"
                  variant={check.severity === "ok" ? "secondary" : check.severity === "warning" ? "outline" : "destructive"}
                >
                  {check.severity === "ok" ? "OK" : check.severity === "warning" ? "Warning" : "Error"}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session &amp; VM lifecycle audit</CardTitle>
        </CardHeader>
        <CardContent>
          {posture && posture.audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">No session activity recorded on this server instance yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(posture?.audit ?? []).map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(event.at).toLocaleTimeString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{event.action}</TableCell>
                    <TableCell className="text-sm">{event.userName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{event.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      {value}
    </div>
  );
}