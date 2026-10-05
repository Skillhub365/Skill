/** Client-safe view of the production readiness report. */

export type ReadinessStatusView = "pass" | "warn" | "fail" | "skip";

export interface ReadinessCheckView {
  key: string;
  label: string;
  status: ReadinessStatusView;
  detail: string;
  required: boolean;
}

export interface IntegrationStatusView {
  key: string;
  label: string;
  connected: boolean;
  detail: string;
  fallback?: boolean;
}

export interface ReadinessReportView {
  environment: "development" | "staging" | "production";
  checkedAt: string;
  productionReady: boolean;
  degraded: boolean;
  degradedReasons: string[];
  emergencyFallbackActive: boolean;
  mockVmProviderActive: boolean;
  simulatedDesktopActive: boolean;
  integrations: IntegrationStatusView[];
  checks: ReadinessCheckView[];
  summary: string;
}

export async function fetchReadiness(headers: Record<string, string>): Promise<ReadinessReportView> {
  const res = await fetch("/api/admin/readiness", { headers });
  if (!res.ok) throw new Error("Readiness status is unavailable.");
  return (await res.json()) as ReadinessReportView;
}
