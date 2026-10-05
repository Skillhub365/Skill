/**
 * Production cutover readiness.
 *
 * One place that answers "is this deployment actually running on real
 * infrastructure?". Every entry is a live probe or a durable database fact —
 * nothing is inferred from front-end state, and no credential value is ever
 * included in the output.
 *
 * Server-only.
 */

import { deploymentEnvironment, infraHealth, type DeploymentEnvironment } from "./runtime.server";

export type ReadinessStatus = "pass" | "warn" | "fail" | "skip";

export interface ReadinessCheck {
  key: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  /** Blocks a production cutover when it is not passing. */
  required: boolean;
}

export interface IntegrationStatus {
  key: string;
  label: string;
  connected: boolean;
  detail: string;
  /** True for entries that describe mock/simulated behaviour rather than a real integration. */
  fallback?: boolean;
}

export interface ReadinessReport {
  environment: DeploymentEnvironment;
  checkedAt: string;
  /** True when every required check passes and no emergency fallback is active. */
  productionReady: boolean;
  degraded: boolean;
  degradedReasons: string[];
  emergencyFallbackActive: boolean;
  mockVmProviderActive: boolean;
  simulatedDesktopActive: boolean;
  integrations: IntegrationStatus[];
  checks: ReadinessCheck[];
  summary: string;
}

function iso(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function ageHours(at: string | null, now: number): number | null {
  if (!at) return null;
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? (now - t) / 3_600_000 : null;
}

/** Builds the full readiness report for the admin console and health endpoint. */
export async function readinessReport(): Promise<ReadinessReport> {
  const now = Date.now();
  const environment = deploymentEnvironment();
  const live = environment !== "development";
  const health = await infraHealth();

  const checks: ReadinessCheck[] = [];
  const add = (
    key: string,
    label: string,
    status: ReadinessStatus,
    detail: string,
    required = live,
  ) => checks.push({ key, label, status, detail, required });

  /* ------------------------------------------------------------ database */
  let dbOk = false;
  let dbDetail = "The database could not be reached.";
  let sessionCount = 0;
  let recentSessions = 0;
  let liveConnections = 0;
  let eventGridSeenAt: string | null = null;
  let lastCleanup: { status: string; finishedAt: string | null; failures: number } | null = null;
  let realPoolVms = 0;
  let mockPoolVms = 0;
  let availablePoolVms = 0;

  try {
    const { db } = await import("@/lib/db/client.server");
    const supabase = await db();

    const { count, error } = await supabase.from("sessions").select("id", { count: "exact", head: true });
    if (error) throw error;
    dbOk = true;
    sessionCount = count ?? 0;
    dbDetail = `Connected. ${sessionCount} session record(s) stored.`;

    const since = new Date(now - 7 * 86_400_000).toISOString();
    const { count: recent } = await supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", since);
    recentSessions = recent ?? 0;

    const { data: connections } = await supabase
      .from("cloud_connections")
      .select("id, status, health, last_event_at, last_validated_at");
    for (const row of connections ?? []) {
      if (row.health === "healthy" || row.status === "connected" || row.status === "CONNECTED") liveConnections += 1;
      const at = iso(row.last_event_at);
      if (at && (!eventGridSeenAt || at > eventGridSeenAt)) eventGridSeenAt = at;
    }

    const { data: cleanup } = await supabase
      .from("cleanup_runs")
      .select("status, finished_at, failures")
      .order("started_at", { ascending: false })
      .limit(1);
    const run = cleanup?.[0];
    if (run) lastCleanup = { status: run.status, finishedAt: iso(run.finished_at), failures: run.failures ?? 0 };

    const { data: poolRows } = await supabase.from("vm_pool_entries").select("status, mock");
    for (const row of poolRows ?? []) {
      if (row.mock) mockPoolVms += 1;
      else realPoolVms += 1;
      if (!row.mock && (row.status === "AVAILABLE" || row.status === "READY" || row.status === "STOPPED")) {
        availablePoolVms += 1;
      }
    }
  } catch (error) {
    dbDetail = error instanceof Error ? error.message : "The database could not be reached.";
  }

  /* ------------------------------------------------------ remote desktop */
  let gateway = {
    configured: health.guacamoleConfigured,
    reachable: false,
    detail: "The gateway was not probed.",
    lastTestOk: null as boolean | null,
    lastTestAt: null as string | null,
    simulationActive: health.remoteDesktop === "simulated",
  };
  try {
    const { remoteDesktopHealth } = await import("@/lib/remote-desktop/health.server");
    const report = await remoteDesktopHealth();
    gateway = {
      configured: report.configured,
      reachable: report.reachable && report.authAccepted,
      detail: report.summary,
      lastTestOk: report.lastTest ? report.lastTest.ok : null,
      lastTestAt: report.lastTest?.at ?? null,
      simulationActive: report.simulationActive,
    };
  } catch {
    /* health probes must never take the console down */
  }

  const eventGridConfigured = await import("@/lib/cloud/events/status.server")
    .then((m) => m.eventGridConfigured())
    .catch(() => false);

  const realtimeConfigured = Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_PUBLISHABLE_KEY"]);
  const eventAgeHours = ageHours(eventGridSeenAt, now);
  const cleanupAgeHours = ageHours(lastCleanup?.finishedAt ?? null, now);

  /* --------------------------------------------------------- checklist */
  add("auth", "Authentication and signing key", health.signingKeyConfigured ? "pass" : "fail",
    health.signingKeyConfigured ? "Session signing key is available." : "No signing key is configured; tokens cannot be verified.");

  add("supabase", "Database connectivity", dbOk ? "pass" : "fail", dbDetail);

  add("realtime", "Realtime subscriptions", realtimeConfigured ? "pass" : live ? "fail" : "warn",
    realtimeConfigured
      ? "Realtime credentials are present; consoles subscribe to live table changes."
      : "Realtime credentials are missing; consoles fall back to polling.");

  add("keyvault", "Key Vault", health.keyVaultConfigured && health.keyVaultReachable ? "pass" : live ? "fail" : "warn",
    health.keyVaultConfigured
      ? health.keyVaultReachable
        ? `Reachable using ${health.keyVaultAuthMode}.`
        : "Configured but unreachable — secret reads will fail."
      : "Not configured; secrets fall back to environment variables.");

  add("azure", "Azure connection", health.azureConfigured && liveConnections > 0 ? "pass" : health.azureConfigured ? "warn" : "fail",
    health.azureConfigured
      ? liveConnections > 0
        ? `${liveConnections} healthy cloud connection(s) using ${health.azureAuthMode ?? "unknown"} credentials.`
        : "Azure credentials are present but no cloud connection reports healthy."
      : "Azure is not configured for this environment.");

  add("eventgrid", "Azure Event Grid", eventGridConfigured ? (eventAgeHours !== null && eventAgeHours < 24 ? "pass" : "warn") : live ? "fail" : "warn",
    eventGridConfigured
      ? eventGridSeenAt
        ? `Last Azure event received ${eventGridSeenAt}.`
        : "Configured, but no Azure event has been received yet."
      : "Event Grid delivery is not configured; state relies on polling and reconciliation.");

  add("guacamole", "Remote desktop gateway", gateway.configured && gateway.reachable ? "pass" : live ? "fail" : "warn", gateway.detail);

  add("vmpool", "VM pool capacity", realPoolVms > 0 ? (availablePoolVms > 0 ? "pass" : "warn") : "fail",
    realPoolVms > 0
      ? `${realPoolVms} real machine(s) registered, ${availablePoolVms} available for allocation.`
      : "No real Azure machines are registered in the pool.");

  add("rdptest", "Test RDP verified", gateway.lastTestOk === true ? "pass" : gateway.lastTestOk === false ? "fail" : "warn",
    gateway.lastTestAt
      ? `Last gateway test ${gateway.lastTestOk ? "succeeded" : "failed"} at ${gateway.lastTestAt}.`
      : "No Super Admin RDP test has been recorded for this deployment.");

  add("usage", "Usage reporting receiving data", recentSessions > 0 ? "pass" : "warn",
    recentSessions > 0
      ? `${recentSessions} session(s) recorded in the last 7 days.`
      : "No sessions recorded in the last 7 days — usage reports will be empty.", false);

  add("reaper", "Cleanup reaper", !health.reaperConfigured
    ? "fail"
    : lastCleanup
      ? lastCleanup.status === "completed" && lastCleanup.failures === 0 && (cleanupAgeHours ?? 99) < 24
        ? "pass"
        : "warn"
      : "warn",
    !health.reaperConfigured
      ? "The session reaper is disabled; expired sessions and orphaned machines will not be reclaimed."
      : lastCleanup
        ? `Last run ${lastCleanup.status}${lastCleanup.finishedAt ? ` at ${lastCleanup.finishedAt}` : ""} with ${lastCleanup.failures} failure(s).`
        : "The reaper has not recorded a run yet.");

  add("mock", "Mock fallback", health.emergencyFallbackActive ? "fail" : "pass",
    health.emergencyFallbackActive
      ? "ALLOW_MOCK_FALLBACK is enabled: simulated infrastructure can serve real users."
      : live
        ? "Emergency mock fallback is off; only real integrations can serve users."
        : "Development mode uses mock Azure and the simulated desktop by design.");

  add("mockdata", "Mock VM registrations", mockPoolVms === 0 ? "pass" : live ? "fail" : "warn",
    mockPoolVms === 0
      ? "No mock machines are registered."
      : `${mockPoolVms} mock machine(s) are registered in the pool.`);

  /* ------------------------------------------------------- integrations */
  const integrations: IntegrationStatus[] = [
    { key: "supabase", label: "Database", connected: dbOk, detail: dbDetail },
    {
      key: "realtime",
      label: "Realtime",
      connected: realtimeConfigured,
      detail: realtimeConfigured ? "Live table subscriptions enabled." : "Polling fallback only.",
    },
    {
      key: "azure",
      label: "Azure",
      connected: health.azureConfigured && liveConnections > 0,
      detail: health.azureConfigured ? `${liveConnections} healthy connection(s).` : "Not configured.",
    },
    {
      key: "eventgrid",
      label: "Azure Event Grid",
      connected: eventGridConfigured && Boolean(eventGridSeenAt),
      detail: eventGridConfigured
        ? eventGridSeenAt
          ? `Last event ${eventGridSeenAt}.`
          : "Configured, awaiting first event."
        : "Not configured.",
    },
    {
      key: "keyvault",
      label: "Key Vault",
      connected: health.keyVaultConfigured && health.keyVaultReachable,
      detail: health.keyVaultConfigured ? `Auth: ${health.keyVaultAuthMode}.` : "Not configured.",
    },
    { key: "guacamole", label: "Guacamole gateway", connected: gateway.configured && gateway.reachable, detail: gateway.detail },
    {
      key: "vmpool",
      label: "VM pool capacity",
      connected: realPoolVms > 0 && availablePoolVms > 0,
      detail: `${realPoolVms} real machine(s), ${availablePoolVms} available, ${mockPoolVms} mock.`,
    },
    {
      key: "mockfallback",
      label: "Mock fallback",
      connected: health.emergencyFallbackActive,
      fallback: true,
      detail: health.emergencyFallbackActive ? "ACTIVE — emergency flag is enabled." : "Inactive.",
    },
    {
      key: "simulateddesktop",
      label: "Simulated desktop",
      connected: gateway.simulationActive,
      fallback: true,
      detail: gateway.simulationActive
        ? live
          ? "ACTIVE in a live environment — learners are seeing a simulation."
          : "Active (development)."
        : "Inactive; learners get a brokered RDP desktop.",
    },
  ];

  const blocking = checks.filter((c) => c.required && c.status === "fail");
  const productionReady = blocking.length === 0 && !health.emergencyFallbackActive;

  return {
    environment,
    checkedAt: new Date(now).toISOString(),
    productionReady,
    degraded: health.degraded,
    degradedReasons: health.degradedReasons,
    emergencyFallbackActive: health.emergencyFallbackActive,
    mockVmProviderActive: health.vm === "mock",
    simulatedDesktopActive: gateway.simulationActive,
    integrations,
    checks,
    summary: productionReady
      ? `All required integrations are live for the ${environment} environment.`
      : blocking.length
        ? `${blocking.length} required check(s) are failing: ${blocking.map((c) => c.label).join(", ")}.`
        : "Emergency mock fallback is enabled; this deployment is not production ready.",
  };
}
