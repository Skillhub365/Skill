/**
 * Structured, JSON-friendly server logging.
 *
 * One line per event, machine-parseable, with a correlation id so a launch can
 * be reconstructed across modules. Redaction is enforced here rather than
 * trusted to call sites: secret-shaped keys are dropped, and secret-shaped
 * values (bearer tokens, connection strings, private IPs) are masked even when
 * they arrive inside a message string. Never log a token, password, secret,
 * service-role key, OAuth code, RDP credential or VM private IP.
 */

import type { CorrelationKind } from "./correlation";
import { newCorrelationId } from "./correlation";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  /** Dot-separated event name, e.g. "lab.launch.failed". */
  event: string;
  correlationId?: string | null;
  tenantId?: string | null;
  workspaceId?: string | null;
  labId?: string | null;
  sessionId?: string | null;
  vmId?: string | null;
  userId?: string | null;
  connectionId?: string | null;
  provider?: string | null;
  durationMs?: number | null;
  outcome?: "success" | "failure" | null;
  errorCode?: string | null;
  message?: string;
  [key: string]: unknown;
}

/** Keys whose values never reach a log, whatever they contain. */
const FORBIDDEN_KEY =
  /(token|password|passwd|secret|credential|apikey|api_key|authorization|cookie|private_?ip|ip_?address|client_secret|service_role|oauth|_code$)/i;

const MASK = "[redacted]";

/** Value-level masking for secrets that slipped into a free-text message. */
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer ${MASK}`],
  [/\beyJ[A-Za-z0-9._-]{20,}/g, MASK], // JWT-shaped
  [/\bsb_(secret|publishable)_[A-Za-z0-9._-]{10,}/g, MASK],
  [/\bAccountKey=[^;]+/gi, `AccountKey=${MASK}`],
  [/\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, MASK], // private IPv4
  [/\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g, MASK],
  [/\b192\.168\.\d{1,3}\.\d{1,3}\b/g, MASK],
];

export function redactText(input: string): string {
  return VALUE_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), input);
}

function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return redactText(value.message);
  if (depth >= 3) return undefined;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !FORBIDDEN_KEY.test(key))
        .map(([key, item]) => [key, redactValue(item, depth + 1)]),
    );
  }
  return undefined;
}

/** Build the log record without emitting it — used by tests and by `log`. */
export function buildLogRecord(level: LogLevel, fields: LogFields): Record<string, unknown> {
  const clean = redactValue(fields) as Record<string, unknown>;
  return {
    ts: new Date().toISOString(),
    level,
    service: "skilltrack",
    ...clean,
  };
}

function emit(level: LogLevel, fields: LogFields) {
  const record = buildLogRecord(level, fields);
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (fields: LogFields) => {
    if ((process.env["LOG_LEVEL"] ?? "info").toLowerCase() === "debug") emit("debug", fields);
  },
  info: (fields: LogFields) => emit("info", fields),
  warn: (fields: LogFields) => emit("warn", fields),
  error: (fields: LogFields) => emit("error", fields),
};

/**
 * A logger bound to one correlation id and a set of stable dimensions, so a
 * lifecycle path does not have to repeat them on every call.
 */
export interface BoundLogger {
  correlationId: string;
  info: (fields: Omit<LogFields, "correlationId">) => void;
  warn: (fields: Omit<LogFields, "correlationId">) => void;
  error: (fields: Omit<LogFields, "correlationId">) => void;
  child: (extra: Partial<LogFields>) => BoundLogger;
}

export function bindLogger(
  kind: CorrelationKind,
  base: Partial<LogFields> & { correlationId?: string | null } = {},
): BoundLogger {
  const correlationId = base.correlationId ?? newCorrelationId(kind);
  const context = { ...base, correlationId };
  const call = (level: Exclude<LogLevel, "debug">) => (fields: Omit<LogFields, "correlationId">) =>
    log[level]({ ...context, ...fields } as LogFields);
  return {
    correlationId,
    info: call("info"),
    warn: call("warn"),
    error: call("error"),
    child: (extra) => bindLogger(kind, { ...context, ...extra }),
  };
}

/** Normalise an unknown thrown value into a safe, redacted message. */
export function safeMessage(error: unknown, fallback = "Unexpected error."): string {
  if (error instanceof Error && error.message) return redactText(error.message);
  if (typeof error === "string" && error) return redactText(error);
  return fallback;
}
