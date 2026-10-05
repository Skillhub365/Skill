import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bot, CheckCircle2, CircleAlert, Copy, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorNotice } from "@/components/layout/ErrorNotice";
import { useAuth } from "@/lib/auth";
import type { McpToolInfo } from "@/lib/mcp/manifest";

export const Route = createFileRoute("/admin/mcp")({
  head: () => ({
    meta: [
      { title: "Agent Integrations — SkillTrack Labs" },
      {
        name: "description",
        content: "Configure and monitor the SkillTrack Labs MCP server: tool routing, authentication and agent activity.",
      },
      { property: "og:title", content: "Agent Integrations — SkillTrack Labs" },
      { property: "og:description", content: "MCP endpoints, tool routing and agent audit trail for SkillTrack Labs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: McpPage,
});

interface McpStatus {
  generatedAt: string;
  endpoint: string;
  metadataEndpoint: string;
  authMode: string;
  groups: Array<{ group: string; enabled: boolean }>;
  mutationsAllowed: boolean;
  rateLimit: { calls: number; windowSeconds: number };
  mode: string;
  integrations: Record<string, boolean>;
  tools: McpToolInfo[];
  recent: Array<{
    id: string;
    action: string;
    detail: string | null;
    actor: string | null;
    outcome: string;
    errorCode: string | null;
    at: string;
  }>;
  callsLast24h: number;
}

const ENV_GUIDE = [
  ["MCP_TOOL_GROUPS", "all", "Comma-separated groups to route: catalog, session, lifecycle, diagnostics."],
  ["MCP_ALLOW_MUTATIONS", "true", "Set false to make the agent surface strictly read-only."],
  ["MCP_RATE_LIMIT", "60", "Maximum tool calls per user per window."],
  ["MCP_RATE_WINDOW_SECONDS", "60", "Length of the rate-limit window in seconds."],
];

function McpPage() {
  const { authHeaders } = useAuth();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/mcp-status", { headers: await authHeaders() });
        const data = (await res.json()) as McpStatus & { detail?: string };
        if (!alive) return;
        if (!res.ok) throw new Error(data.detail ?? "Could not load agent integration status.");
        setStatus(data);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Could not load agent integration status.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [authHeaders]);

  function copy(value: string) {
    void navigator.clipboard.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Bot className="h-6 w-6 text-primary" aria-hidden /> Agent integrations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI assistants connect over MCP and act as a signed-in SkillTrack Labs user — never with a shared key.
          </p>
        </div>
        {status ? (
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {status.authMode}
          </Badge>
        ) : null}
      </header>

      {error ? <ErrorNotice error={error} /> : null}

      {status ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Endpoints</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {[
                  ["MCP endpoint", status.endpoint],
                  ["OAuth metadata", status.metadataEndpoint],
                ].map(([label, value]) => (
                  <div key={label} className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded-md border border-border bg-muted/60 px-2 py-1 text-xs">
                        {value}
                      </code>
                      <Button size="sm" variant="outline" onClick={() => copy(value!)}>
                        <Copy className="h-3.5 w-3.5" aria-hidden />
                        <span className="sr-only">Copy {label}</span>
                      </Button>
                    </div>
                    {copied === value ? <p className="text-[11px] text-muted-foreground">Copied.</p> : null}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Credentials are never configured here: an assistant signs the user in through SkillTrack Labs and the
                  approval screen records their consent.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Routing &amp; posture</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  {status.groups.map((group) => (
                    <Badge key={group.group} variant={group.enabled ? "default" : "outline"}>
                      {group.group}
                      {group.enabled ? "" : " · off"}
                    </Badge>
                  ))}
                </div>
                <p className="text-muted-foreground">
                  Mutating tools are <strong>{status.mutationsAllowed ? "enabled" : "disabled"}</strong>. Limit:{" "}
                  {status.rateLimit.calls} calls per {status.rateLimit.windowSeconds}s per user. Cloud mode:{" "}
                  {status.mode}.
                </p>
                <ul className="grid gap-1.5">
                  {Object.entries(status.integrations).map(([key, configured]) => (
                    <li key={key} className="flex items-center gap-2">
                      {configured ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                      ) : (
                        <CircleAlert className="h-4 w-4 text-amber-600" aria-hidden />
                      )}
                      <span className="capitalize">{key}</span>
                      <span className="text-muted-foreground">{configured ? "configured" : "not configured"}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Published tools</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead>Effect</TableHead>
                    <TableHead>What it does</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.tools.map((tool) => (
                    <TableRow key={tool.name}>
                      <TableCell className="font-medium">{tool.title}</TableCell>
                      <TableCell className="text-muted-foreground">{tool.group}</TableCell>
                      <TableCell>
                        <Badge variant={tool.mutates ? "default" : "outline"}>
                          {tool.mutates ? "Changes state" : "Read only"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{tool.summary}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Routing is environment-driven, so a staging deployment can expose a read-only subset. Set these as
                  backend environment variables (see <code>.env.example</code>).
                </p>
                <ul className="space-y-2">
                  {ENV_GUIDE.map(([name, value, note]) => (
                    <li key={name} className="rounded-md border border-border p-2">
                      <code className="text-xs font-semibold">
                        {name}={value}
                      </code>
                      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent agent activity</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.recent.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                          No agent tool calls recorded yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      status.recent.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {new Date(entry.at).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-sm">{entry.actor ?? "Agent"}</TableCell>
                          <TableCell>
                            <Badge variant={entry.outcome === "success" ? "outline" : "destructive"}>
                              {entry.errorCode ?? entry.outcome}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{entry.detail}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
