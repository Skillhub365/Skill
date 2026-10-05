import { ClientOnly } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Point } from "@/lib/admin-metrics";

const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 11 } as const;

function ChartFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="h-56 pt-2">
        <ClientOnly fallback={<div className="size-full animate-pulse rounded-lg bg-muted/60" />}>{children}</ClientOnly>
      </CardContent>
    </Card>
  );
}

const tooltipStyle = {
  contentStyle: {
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--popover)",
    color: "var(--popover-foreground)",
    fontSize: 12,
  },
} as const;

export function SessionsOverTimeChart({ data }: { data: Point[] }) {
  return (
    <ChartFrame title="Sessions over time" subtitle="Lab sessions started per day (last 7 days)">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="sessionsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} {...AXIS} />
          <YAxis tickLine={false} axisLine={false} width={40} {...AXIS} />
          <Tooltip {...tooltipStyle} />
          <Area type="monotone" dataKey="value" name="Sessions" stroke="var(--primary)" strokeWidth={2} fill="url(#sessionsFill)" />
          <Area type="monotone" dataKey="secondary" name="Failed" stroke="var(--destructive)" strokeWidth={1.5} fillOpacity={0} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function VmUsageChart({ data }: { data: Point[] }) {
  return (
    <ChartFrame title="VM usage" subtitle="Compute hours consumed per day">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} {...AXIS} />
          <YAxis tickLine={false} axisLine={false} width={40} {...AXIS} />
          <Tooltip {...tooltipStyle} cursor={{ opacity: 0.08 }} />
          <Bar dataKey="value" name="VM hours" radius={[6, 6, 0, 0]} fill="var(--primary)" />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function LabUsageChart({ data }: { data: Point[] }) {
  return (
    <ChartFrame title="Lab usage" subtitle="Sessions per published lab">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.25} />
          <XAxis type="number" tickLine={false} axisLine={false} {...AXIS} />
          <YAxis type="category" dataKey="label" width={150} tickLine={false} axisLine={false} {...AXIS} />
          <Tooltip {...tooltipStyle} cursor={{ opacity: 0.08 }} />
          <Bar dataKey="value" name="Sessions" radius={[0, 6, 6, 0]} fill="var(--accent-foreground)" />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function ActiveVmChart({ data }: { data: Point[] }) {
  return (
    <ChartFrame title="Active VM count" subtitle="Concurrent machines through the day">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={1} {...AXIS} />
          <YAxis tickLine={false} axisLine={false} width={40} {...AXIS} />
          <Tooltip {...tooltipStyle} />
          <Line type="monotone" dataKey="value" name="Running VMs" stroke="var(--primary)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
