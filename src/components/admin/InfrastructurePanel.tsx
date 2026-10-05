import { useEffect, useState } from "react";
import { Cloud, MonitorSmartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

interface InfraStatus {
  environment: "development" | "staging" | "production";
  vm: "mock" | "azure";
  remoteDesktop: "simulated" | "guacamole";
  azureConfigured: boolean;
  azureAuthMode: "managed-identity" | "service-principal" | null;
  readinessTimeoutMs: number;
  guacamoleConfigured: boolean;
  gateway?: { configured: boolean; reachable: boolean; detail: string };
  supabaseConfigured: boolean;
  keyVaultConfigured: boolean;
  keyVaultReachable: boolean;
  keyVaultAuthMode: string;
  rdpCredentialConfigured: boolean;
  reaperConfigured: boolean;
  signingKeyConfigured: boolean;
  environmentValid: boolean;
  degraded: boolean;
  degradedReasons: string[];
  emergencyFallbackActive: boolean;
}

const ENV_COPY: Record<InfraStatus["environment"], string> = {
  development: "Mock Azure and a simulated desktop — no cloud resources are created.",
  staging: "Azure test subscription with the Guacamole gateway.",
  production: "Live Azure subscription with the Guacamole gateway.",
};

/** Shows which cloud and remote-desktop implementations this deployment uses. */
export function InfrastructurePanel() {
  const { authHeaders } = useAuth();
  const [status, setStatus] = useState<InfraStatus | null>(null);

  useEffect(() => {
    fetch("/api/infra/status", { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [authHeaders]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <Cloud className="size-4 text-primary" />
        <CardTitle className="text-base">Infrastructure</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span>Environment</span>
          <Badge variant="secondary" className="capitalize">{status?.environment ?? "…"}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{status ? ENV_COPY[status.environment] : ""}</p>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
          <span className="flex items-center gap-2">
            <Cloud className="size-4 text-muted-foreground" /> Cloud provider
          </span>
          <Badge variant={status?.vm === "azure" ? "secondary" : "outline"}>
            {status?.vm === "azure" ? "Azure Compute (live)" : "Mock Azure"}
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <MonitorSmartphone className="size-4 text-muted-foreground" /> Remote desktop
          </span>
          <Badge variant={status?.remoteDesktop === "guacamole" ? "secondary" : "outline"}>
            {status?.remoteDesktop === "guacamole" ? "Apache Guacamole" : "Simulated desktop"}
          </Badge>
        </div>

        {status?.degraded ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            <p className="font-semibold">Degraded configuration</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {status.degradedReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-1 border-t border-border/60 pt-3 text-xs text-muted-foreground sm:grid-cols-2">
          {[
            ["Database", status?.supabaseConfigured],
            ["Key Vault", status?.keyVaultConfigured && status?.keyVaultReachable],
            ["Signing key", status?.signingKeyConfigured],
            ["RDP credential", status?.rdpCredentialConfigured],
            ["Session reaper", status?.reaperConfigured],
            ["Environment checks", status?.environmentValid],
          ].map(([label, good]) => (
            <p key={String(label)} className="flex items-center justify-between gap-2">
              <span>{label as string}</span>
              <Badge variant={good ? "secondary" : "outline"} className="h-5 px-2 text-[10px]">
                {status ? (good ? "OK" : "Attention") : "…"}
              </Badge>
            </p>
          ))}
        </div>

        <div className="space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <p>
            Azure credentials:{" "}
            <span className="font-medium text-foreground">
              {!status?.azureConfigured
                ? "not configured"
                : status.azureAuthMode === "managed-identity"
                  ? "managed identity"
                  : "service principal"}
            </span>
          </p>
          <p>
            Key Vault credential: <span className="font-medium text-foreground">{status?.keyVaultAuthMode ?? "…"}</span>
          </p>
          <p>
            Readiness timeout:{" "}
            <span className="font-medium text-foreground">
              {status ? `${Math.round(status.readinessTimeoutMs / 60000)} min` : "…"}
            </span>
          </p>
          <p>
            Guacamole gateway:{" "}
            <span className="font-medium text-foreground">
              {status?.guacamoleConfigured ? "configured" : "not configured"}
            </span>
          </p>
          {status?.gateway?.configured ? (
            <p>
              Gateway health:{" "}
              <span className={status.gateway.reachable ? "font-medium text-foreground" : "font-medium text-destructive"}>
                {status.gateway.reachable ? "reachable" : "unreachable"}
              </span>{" "}
              — {status.gateway.detail}
            </p>
          ) : null}
          <p>
            Learner desktops are brokered per session: a dedicated RDP connection plus a scoped gateway account that is
            deleted when the session ends. RDP 3389 stays inside the private VNet.
          </p>
          <p className="pt-1">
            Provider implementations are selected on the server at runtime, so switching between mock, test and live
            infrastructure never requires a frontend change.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}