/**
 * Alert evaluation.
 *
 * There is no paging system wired up, so alerts are evaluated on demand from
 * durable metric rollups and surfaced in the admin operations console. Each
 * rule states a plain-language condition and a suggested first action, so an
 * operator can act without reading the code.
 *
 * TODO(monitoring): forward FIRING alerts to Azure Monitor action groups /
 * PagerDuty once an alerting destination is configured.
 */

import { rollupMetrics, type MetricRollup } from "@/lib/db/metrics.repo.server";
import { METRIC } from "./metrics.server";

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertState = "firing" | "ok";

export interface Alert {
  id: string;
  title: string;
  severity: AlertSeverity;
  state: AlertState;
  detail: string;
  action: string;
  observed: number;
  threshold: number;
}

function rollup(rollups: MetricRollup[], metric: string) {
  return rollups.find((entry) => entry.metric === metric);
}

function total(rollups: MetricRollup[], metric: string) {
  return rollup(rollups, metric)?.total ?? 0;
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

/** Thresholds are conservative defaults; each is overridable by environment. */
function threshold(name: string, fallback: number) {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function evaluateAlerts(windowHours = 6): Promise<{ windowHours: number; alerts: Alert[] }> {
  const rollups = await rollupMetrics(windowHours);

  const launches = total(rollups, METRIC.launchRequested);
  const failures = total(rollups, METRIC.launchFailed);
  const failureRate = ratio(failures, launches);
  const readyP95 = rollup(rollups, METRIC.vmReadyMs)?.p95 ?? 0;
  const orphans = total(rollups, METRIC.orphanDetected);
  const reclaimed = total(rollups, METRIC.orphanReclaimed);
  const cleanupFailures = total(rollups, METRIC.cleanupFailure);
  const gatewayFailures = total(rollups, METRIC.gatewayConnectFailed);
  const gatewayTotal = gatewayFailures + total(rollups, METRIC.gatewayConnectSucceeded);
  const azureFailures = total(rollups, METRIC.azureApiFailure);
  const keyVaultFailures = total(rollups, METRIC.keyVaultFailure);
  const authzDenied = total(rollups, METRIC.authorizationDenied);

  const failureRateThreshold = threshold("ALERT_LAUNCH_FAILURE_RATE", 0.1);
  const readyMsThreshold = threshold("ALERT_VM_READY_P95_MS", 300_000);
  const orphanThreshold = threshold("ALERT_ORPHAN_COUNT", 3);
  const gatewayRateThreshold = threshold("ALERT_GATEWAY_FAILURE_RATE", 0.1);
  const authzThreshold = threshold("ALERT_AUTHZ_DENIED", 25);

  const alerts: Alert[] = [
    {
      id: "launch-failure-rate",
      title: "Lab start failure rate",
      severity: "critical",
      state: launches >= 5 && failureRate > failureRateThreshold ? "firing" : "ok",
      detail: `${failures} of ${launches} lab starts failed in the last ${windowHours}h.`,
      action: "Check the cloud connection health panel and the failed-VM-start runbook.",
      observed: Number((failureRate * 100).toFixed(1)),
      threshold: failureRateThreshold * 100,
    },
    {
      id: "vm-ready-slow",
      title: "Machines slow to become ready",
      severity: "warning",
      state: readyP95 > readyMsThreshold ? "firing" : "ok",
      detail: `95% of machines were ready within ${(readyP95 / 1000).toFixed(0)}s.`,
      action: "Check pool warm capacity and image size; consider pre-warming more machines.",
      observed: Math.round(readyP95 / 1000),
      threshold: Math.round(readyMsThreshold / 1000),
    },
    {
      id: "orphaned-vms",
      title: "Orphaned machines",
      severity: "critical",
      state: orphans - reclaimed > orphanThreshold ? "firing" : "ok",
      detail: `${orphans} orphaned machines detected, ${reclaimed} reclaimed.`,
      action: "Run a manual sweep on the orphan console; costs accrue while machines stay allocated.",
      observed: Math.max(0, orphans - reclaimed),
      threshold: orphanThreshold,
    },
    {
      id: "cleanup-failures",
      title: "Session cleanup failures",
      severity: "critical",
      state: cleanupFailures > 0 ? "firing" : "ok",
      detail: `${cleanupFailures} sessions failed to release their machine or gateway connection.`,
      action: "Follow the stuck-session runbook and release the affected machines manually.",
      observed: cleanupFailures,
      threshold: 0,
    },
    {
      id: "gateway-failures",
      title: "Remote desktop connection failures",
      severity: "warning",
      state: gatewayTotal >= 5 && ratio(gatewayFailures, gatewayTotal) > gatewayRateThreshold ? "firing" : "ok",
      detail: `${gatewayFailures} of ${gatewayTotal} desktop connections failed.`,
      action: "Check gateway reachability and the remote-desktop runbook.",
      observed: Number((ratio(gatewayFailures, gatewayTotal) * 100).toFixed(1)),
      threshold: gatewayRateThreshold * 100,
    },
    {
      id: "cloud-api-failures",
      title: "Cloud API failures",
      severity: "warning",
      state: azureFailures > 0 ? "firing" : "ok",
      detail: `${azureFailures} cloud API calls failed.`,
      action: "Check subscription quota, credential expiry and provider status.",
      observed: azureFailures,
      threshold: 0,
    },
    {
      id: "secret-store-failures",
      title: "Secret store failures",
      severity: "critical",
      state: keyVaultFailures > 0 ? "firing" : "ok",
      detail: `${keyVaultFailures} secret lookups failed.`,
      action: "Verify the managed identity has access to the vault; see the secret-rotation runbook.",
      observed: keyVaultFailures,
      threshold: 0,
    },
    {
      id: "authorization-denials",
      title: "Unusual access denials",
      severity: "warning",
      state: authzDenied > authzThreshold ? "firing" : "ok",
      detail: `${authzDenied} requests were denied by the authorisation chain.`,
      action: "Review the security audit log for a repeated principal or workspace.",
      observed: authzDenied,
      threshold: authzThreshold,
    },
  ];

  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  alerts.sort(
    (a, b) =>
      Number(b.state === "firing") - Number(a.state === "firing") || order[a.severity] - order[b.severity],
  );
  return { windowHours, alerts };
}
