import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fetchReadiness, type ReadinessReportView } from "@/lib/infra/readiness-client";

/**
 * Always-visible warning for administrators when a live deployment is running
 * on simulated infrastructure. Silence here would be the actual danger.
 */
export function DegradedModeBanner() {
  const { user, authHeaders } = useAuth();
  const [report, setReport] = useState<ReadinessReportView | null>(null);

  useEffect(() => {
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) return;
    let cancelled = false;
    fetchReadiness(authHeaders())
      .then((r) => !cancelled && setReport(r))
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [user, authHeaders]);

  if (!report || report.environment === "development") return null;
  const degraded = report.emergencyFallbackActive || report.simulatedDesktopActive || report.mockVmProviderActive || report.degraded;
  if (!degraded) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-semibold">
          {report.emergencyFallbackActive ? "Emergency fallback active" : "Degraded infrastructure"} —{" "}
          {report.environment}
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
          {report.mockVmProviderActive ? <li>Mock Azure provider is serving VM requests.</li> : null}
          {report.simulatedDesktopActive ? <li>Learners are being shown the simulated desktop.</li> : null}
          {report.degradedReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
