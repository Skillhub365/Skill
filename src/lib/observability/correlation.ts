/**
 * Correlation identifiers.
 *
 * Every operation that crosses a process, a provider or a queue carries one of
 * these so a launch can be followed end to end: auth -> launch -> session ->
 * VM -> Azure call -> gateway call -> reaper cleanup. They are opaque, contain
 * no personal data and are safe to log and to return to the browser.
 */

export type CorrelationKind =
  | "auth"
  | "launch"
  | "session"
  | "vm"
  | "cloud"
  | "azure"
  | "gateway"
  | "reaper"
  | "metric"
  | "mcp";

const PREFIX: Record<CorrelationKind, string> = {
  auth: "aut",
  launch: "lnc",
  session: "ses",
  vm: "vmo",
  cloud: "cld",
  azure: "azr",
  gateway: "gwy",
  reaper: "rpr",
  metric: "mtr",
  mcp: "mcp",
};

/** `lnc_1a2b3c4d5e6f` — sortable enough for logs, unguessable enough for URLs. */
export function newCorrelationId(kind: CorrelationKind): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${PREFIX[kind]}_${random}`;
}

/** Reuse an inbound correlation id when it looks like ours, otherwise mint one. */
export function correlationFrom(kind: CorrelationKind, candidate: string | null | undefined): string {
  if (candidate && /^[a-z]{3}_[a-z0-9]{6,32}$/i.test(candidate)) return candidate;
  return newCorrelationId(kind);
}

/** Read a correlation id a caller passed in (proxy, webhook, retry). */
export function correlationFromRequest(kind: CorrelationKind, request: Request): string {
  return correlationFrom(kind, request.headers.get("x-correlation-id"));
}
