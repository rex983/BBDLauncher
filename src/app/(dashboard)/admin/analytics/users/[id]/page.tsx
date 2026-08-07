"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { use } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type UserProfile = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  office: string | null;
};

type DestAgg = {
  id: string;
  name: string;
  kind: "app" | "link";
  count: number;
  first_used: string;
  last_used: string;
};

type AuditEntry = {
  id: string;
  created_at: string;
  destination_id: string | null;
  destination_name: string;
  kind: "app" | "link";
  ip_address: string | null;
  user_agent: string | null;
};

type Response = {
  user: UserProfile | null;
  user_id: string;
  range: string;
  totals: {
    events: number;
    unique_destinations: number;
    app_launches: number;
    link_clicks: number;
    first_event: string | null;
    last_event: string | null;
  };
  destinations: DestAgg[];
  audit_log: AuditEntry[];
  audit_log_truncated: boolean;
};

const RANGES = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDateTime(iso);
}

function shortenAgent(ua: string | null) {
  if (!ua) return "—";
  const m = ua.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/);
  if (m) return m[0];
  return ua.slice(0, 60) + (ua.length > 60 ? "…" : "");
}

export default function UserAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const initialRange = searchParams.get("range");
  const [range, setRange] = useState(
    initialRange && RANGES.some((r) => r.value === initialRange)
      ? initialRange
      : "30d"
  );
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [destQuery, setDestQuery] = useState("");
  const [auditQuery, setAuditQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/analytics/users/${id}?range=${range}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Failed to load");
        return r.json();
      })
      .then((json: Response) => {
        if (!cancelled) setData(json);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, id]);

  const filteredDests = useMemo(() => {
    if (!data) return [];
    const q = destQuery.toLowerCase().trim();
    return q
      ? data.destinations.filter((d) => d.name.toLowerCase().includes(q))
      : data.destinations;
  }, [data, destQuery]);

  const filteredAudit = useMemo(() => {
    if (!data) return [];
    const q = auditQuery.toLowerCase().trim();
    return q
      ? data.audit_log.filter((e) =>
          e.destination_name.toLowerCase().includes(q)
        )
      : data.audit_log;
  }, [data, auditQuery]);

  const displayName =
    data?.user?.name ?? data?.user?.email ?? (loading ? "…" : "Unknown user");

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/admin/analytics">
            <ArrowLeft className="h-4 w-4" />
            Back to analytics
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{displayName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {data?.user?.email && data.user.name && (
                <span className="text-sm text-muted-foreground">
                  {data.user.email}
                </span>
              )}
              {data?.user?.role && (
                <Badge variant="secondary">{data.user.role}</Badge>
              )}
              {data?.user?.office && (
                <Badge variant="outline">{data.user.office}</Badge>
              )}
              {!loading && !data?.user && (
                <span
                  className="font-mono text-xs text-muted-foreground"
                  title={data?.user_id ?? id}
                >
                  id: {(data?.user_id ?? id).slice(0, 12)}
                  {(data?.user_id ?? id).length > 12 && "…"}
                </span>
              )}
            </div>
          </div>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total events"
          value={loading ? "…" : data?.totals.events.toLocaleString() ?? "0"}
          subvalue={
            data
              ? `${data.totals.app_launches.toLocaleString()} launches · ${data.totals.link_clicks.toLocaleString()} clicks`
              : undefined
          }
        />
        <StatCard
          title="Destinations used"
          value={
            loading ? "…" : data?.totals.unique_destinations.toLocaleString() ?? "0"
          }
        />
        <StatCard
          title="First activity"
          value={
            loading
              ? "…"
              : data?.totals.first_event
              ? formatRelative(data.totals.first_event)
              : "—"
          }
          subvalue={
            data?.totals.first_event
              ? formatDateTime(data.totals.first_event)
              : undefined
          }
        />
        <StatCard
          title="Last activity"
          value={
            loading
              ? "…"
              : data?.totals.last_event
              ? formatRelative(data.totals.last_event)
              : "—"
          }
          subvalue={
            data?.totals.last_event
              ? formatDateTime(data.totals.last_event)
              : undefined
          }
        />
      </div>

      <Tabs defaultValue="destinations" className="space-y-4">
        <TabsList>
          <TabsTrigger value="destinations">By Destination</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="destinations" className="space-y-3">
          <Input
            placeholder="Filter destinations…"
            value={destQuery}
            onChange={(e) => setDestQuery(e.target.value)}
            className="max-w-sm"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destination</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead>First used</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDests.map((d) => {
                const href = `/admin/analytics/${d.kind === "app" ? "apps" : "links"}/${d.id}?range=${range}`;
                return (
                  <TableRow
                    key={`${d.kind}:${d.id}`}
                    className="group cursor-pointer transition-colors hover:bg-muted/50"
                  >
                    <TableCell className="font-medium">
                      <Link href={href} className="block hover:underline">
                        {d.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={d.kind === "app" ? "default" : "outline"}
                        className="text-[10px]"
                      >
                        {d.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Link href={href} className="block">
                        {d.count.toLocaleString()}
                      </Link>
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground"
                      title={formatDateTime(d.first_used)}
                    >
                      {formatRelative(d.first_used)}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground"
                      title={formatDateTime(d.last_used)}
                    >
                      {formatRelative(d.last_used)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <Link
                        href={href}
                        className="block"
                        aria-label={`View ${d.name} details`}
                      >
                        <ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && filteredDests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    This user has no activity in the selected range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="audit" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Input
              placeholder="Filter by destination…"
              value={auditQuery}
              onChange={(e) => setAuditQuery(e.target.value)}
              className="max-w-sm"
            />
            {data?.audit_log_truncated && (
              <p className="text-xs text-muted-foreground">
                Showing latest 500 of {data.totals.events.toLocaleString()} events.
              </p>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Browser</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAudit.map((e) => {
                const href = e.destination_id
                  ? `/admin/analytics/${e.kind === "app" ? "apps" : "links"}/${e.destination_id}?range=${range}`
                  : null;
                return (
                  <TableRow key={e.id}>
                    <TableCell
                      className="text-muted-foreground whitespace-nowrap"
                      title={formatDateTime(e.created_at)}
                    >
                      {formatRelative(e.created_at)}
                    </TableCell>
                    <TableCell>
                      {href ? (
                        <Link href={href} className="hover:underline">
                          {e.destination_name}
                        </Link>
                      ) : (
                        e.destination_name
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={e.kind === "app" ? "default" : "outline"}
                        className="text-[10px]"
                      >
                        {e.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {e.ip_address ?? "—"}
                    </TableCell>
                    <TableCell
                      className="text-xs text-muted-foreground"
                      title={e.user_agent ?? undefined}
                    >
                      {shortenAgent(e.user_agent)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && filteredAudit.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No events in the selected range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({
  title,
  value,
  subvalue,
}: {
  title: string;
  value: string;
  subvalue?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold truncate" title={value}>
          {value}
        </div>
        {subvalue && (
          <p className="mt-1 text-xs text-muted-foreground">{subvalue}</p>
        )}
      </CardContent>
    </Card>
  );
}
