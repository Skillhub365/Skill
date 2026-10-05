import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import * as cloud from "@/lib/cloud/connections/client";
import { CLOUD_AUDIT_ACTION_LABEL, type CloudAuditEntry } from "@/lib/cloud/audit/types";

const outcomeTone: Record<string, string> = {
  success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  failure: "bg-destructive/10 text-destructive border-destructive/30",
  denied: "bg-amber-500/10 text-amber-700 border-amber-500/30",
};

const outcomeIcon = {
  success: ShieldCheck,
  failure: ShieldX,
  denied: ShieldAlert,
} as const;

/**
 * Audit trail for cloud connection and VM operations: who did what, against
 * which subscription, and the normalized code when it failed.
 */
export function CloudAuditLog({
  connectionId,
  workspaceId,
  onSchedule,
}: {
  connectionId?: string | undefined;
  workspaceId?: string | undefined;
  onSchedule?: (schedule: cloud.RefreshSchedule) => void;
}) {
  const [entries, setEntries] = useState<CloudAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [outcome, setOutcome] = useState("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await cloud.fetchAudit({ connectionId, workspaceId });
      setEntries(data.entries);
      onSchedule?.(data.schedule);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
    // onSchedule is a render-stable callback in practice; excluded to avoid refetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, workspaceId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries
      .filter((e) => outcome === "all" || e.outcome === outcome)
      .filter(
        (e) =>
          !needle ||
          [e.actorName, e.connectionName, e.target, e.errorCode, CLOUD_AUDIT_ACTION_LABEL[e.action]]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(needle)),
      );
  }, [entries, outcome, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search actor, connection, VM or error code"
          className="max-w-xs"
        />
        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failure">Failure</SelectItem>
            <SelectItem value="denied">Denied</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
          Reload
        </Button>
        <span className="text-xs text-muted-foreground">{visible.length} events</span>
      </div>

      {visible.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead className="text-right">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((entry) => {
              const Icon = outcomeIcon[entry.outcome];
              return (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(entry.at).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium">{CLOUD_AUDIT_ACTION_LABEL[entry.action]}</TableCell>
                  <TableCell className="text-sm">
                    {entry.actorName}
                    <span className="ml-1 text-xs text-muted-foreground">({entry.actorRole})</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{entry.target ?? entry.connectionName ?? "—"}</div>
                    {entry.resourceGroup ? (
                      <div className="text-xs text-muted-foreground">{entry.resourceGroup}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={outcomeTone[entry.outcome]}>
                      <Icon className="mr-1 h-3 w-3" />
                      {entry.errorCode ?? entry.outcome}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{entry.durationMs} ms</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {loading ? "Loading audit events…" : "No cloud activity recorded yet."}
        </p>
      )}
    </div>
  );
}
