"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { use } from "react";
import { ArrowLeft } from "lucide-react";
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

type Destination = {
  id: string;
  name: string;
  url: string;
  sso_type?: string;
  status?: string;
};

type UserAgg = {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  office: string | null;
  clicks: number;
  first_click: string;
  last_click: string;
};

type AuditEntry = {
  id: string;
  created_at: string;
  user_id: string;
  email: string;
  name: string | null;
  ip_address: string | null;
  user_agent: string | null;
};

type Response = {
  kind: "apps" | "links";
  destination: Destination | null;
  range: string;
  totals: {
    clicks: number;
    unique_users: number;
    first_click: string | null;
    last_click: string | null;
  };
  users: UserAgg[];
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
  // Grab the leading browser token for readability.
  const m = ua.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/);
  if (m) return m[0];
  return ua.slice(0, 60) + (ua.length > 60 ? "…" : "");
}

export default function DestinationAnalyticsPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = use(params);
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
  const [userQuery, setUserQuery] = useState("");
  const [auditQuery, setAuditQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/analytics/${kind}/${id}?range=${range}`)
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
  }, [range, kind, id]);

  const filteredUsers = useMemo(() => {
    if (!data) return [];
    const q = userQuery.toLowerCase().trim();
    if (!q) return data.users;
    return data.users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.name?.toLowerCase().includes(q) ?? false)
    );
  }, [data, userQuery]);

  const filteredAudit = useMemo(() => {
    if (!data) return [];
    const q = auditQuery.toLowerCase().trim();
    if (!q) return data.audit_log;
    return data.audit_log.filter(
      (e) =>
        e.email.toLowerCase().includes(q) ||
        (e.name?.toLowerCase().includes(q) ?? false) ||
        (e.ip_address?.toLowerCase().includes(q) ?? false)
    );
  }, [data, auditQuery]);

  const kindLabel = kind === "apps" ? "App" : "Link";
  const clicksLabel = kind === "apps" ? "Launches" : "Clicks";

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
            <div className="flex items-center gap-2">
              <Badge variant={kind === "apps" ? "default" : "outline"}>
                {kindLabel}
              </Badge>
              <h1 className="text-2xl font-bold">
                {data?.destination?.name ?? (loading ? "…" : "Unknown")}
              </h1>
            </div>
            {data?.destination?.url && (
              <a
                href={data.destination.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-muted-foreground hover:underline break-all"
              >
                {data.destination.url}
              </a>
            )}
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
          title={`Total ${clicksLabel.toLowerCase()}`}
          value={loading ? "…" : data?.totals.clicks.toLocaleString() ?? "0"}
        />
        <StatCard
          title="Unique users"
          value={loading ? "…" : data?.totals.unique_users.toLocaleString() ?? "0"}
        />
        <StatCard
          title="First click"
          value={
            loading
              ? "…"
              : data?.totals.first_click
              ? formatRelative(data.totals.first_click)
              : "—"
          }
          subvalue={
            data?.totals.first_click ? formatDateTime(data.totals.first_click) : undefined
          }
        />
        <StatCard
          title="Last click"
          value={
            loading
              ? "…"
              : data?.totals.last_click
              ? formatRelative(data.totals.last_click)
              : "—"
          }
          subvalue={
            data?.totals.last_click ? formatDateTime(data.totals.last_click) : undefined
          }
        />
      </div>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users">By User</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-3">
          <Input
            placeholder="Filter users by name or email…"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            className="max-w-sm"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Office</TableHead>
                <TableHead className="text-right">{clicksLabel}</TableHead>
                <TableHead>First click</TableHead>
                <TableHead>Last click</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((u) => (
                <TableRow key={u.user_id}>
                  <TableCell>
                    <div className="font-medium">{u.name || u.email}</div>
                    {u.name && (
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{u.role}</Badge>
                  </TableCell>
                  <TableCell>
                    {u.office ? (
                      <Badge variant="outline">{u.office}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {u.clicks.toLocaleString()}
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={formatDateTime(u.first_click)}
                  >
                    {formatRelative(u.first_click)}
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={formatDateTime(u.last_click)}
                  >
                    {formatRelative(u.last_click)}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No users have {kind === "apps" ? "launched" : "clicked"} this in the selected range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="audit" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Input
              placeholder="Filter by user, email, or IP…"
              value={auditQuery}
              onChange={(e) => setAuditQuery(e.target.value)}
              className="max-w-sm"
            />
            {data?.audit_log_truncated && (
              <p className="text-xs text-muted-foreground">
                Showing latest 500 of {data.totals.clicks.toLocaleString()} events.
              </p>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>User</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Browser</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAudit.map((e) => (
                <TableRow key={e.id}>
                  <TableCell
                    className="text-muted-foreground whitespace-nowrap"
                    title={formatDateTime(e.created_at)}
                  >
                    {formatRelative(e.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{e.name || e.email}</div>
                    {e.name && (
                      <div className="text-xs text-muted-foreground">{e.email}</div>
                    )}
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
              ))}
              {!loading && filteredAudit.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
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
