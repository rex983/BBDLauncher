"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type DestStat = {
  id: string;
  name: string;
  kind: "app" | "link";
  launches: number;
  unique_users: number;
  last_launch: string;
};

type UserStat = {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  office: string | null;
  launches: number;
  last_launch: string;
  top_destination: string | null;
  top_destination_kind: "app" | "link" | null;
  top_destination_launches: number;
};

type RecentEvent = {
  created_at: string;
  email: string;
  name: string | null;
  destination: string;
  kind: "app" | "link";
};

type AnalyticsResponse = {
  range: string;
  totals: {
    launches: number;
    unique_users: number;
    unique_destinations: number;
    app_launches: number;
    link_clicks: number;
    top_destination: string | null;
    top_destination_kind: "app" | "link" | null;
    top_destination_launches: number;
  };
  apps: DestStat[];
  links: DestStat[];
  users: UserStat[];
  recent: RecentEvent[];
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

export default function AdminAnalyticsPage() {
  const [range, setRange] = useState("30d");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appQuery, setAppQuery] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/analytics?range=${range}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Failed to load");
        return r.json();
      })
      .then((json: AnalyticsResponse) => {
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
  }, [range]);

  const filteredApps = useMemo(() => {
    if (!data) return [];
    const q = appQuery.toLowerCase().trim();
    return q ? data.apps.filter((a) => a.name.toLowerCase().includes(q)) : data.apps;
  }, [data, appQuery]);

  const filteredLinks = useMemo(() => {
    if (!data) return [];
    const q = linkQuery.toLowerCase().trim();
    return q ? data.links.filter((l) => l.name.toLowerCase().includes(q)) : data.links;
  }, [data, linkQuery]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">App Analytics</h1>
          <p className="text-muted-foreground">
            Which users are launching which apps and clicking which links, and how often.
          </p>
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

      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total clicks"
          value={loading ? "…" : data?.totals.launches.toLocaleString() ?? "0"}
          subvalue={
            data
              ? `${data.totals.app_launches.toLocaleString()} apps · ${data.totals.link_clicks.toLocaleString()} links`
              : undefined
          }
        />
        <StatCard
          title="Active users"
          value={loading ? "…" : data?.totals.unique_users.toLocaleString() ?? "0"}
        />
        <StatCard
          title="Destinations used"
          value={loading ? "…" : data?.totals.unique_destinations.toLocaleString() ?? "0"}
        />
        <StatCard
          title="Most-clicked"
          value={loading ? "…" : data?.totals.top_destination ?? "—"}
          subvalue={
            data?.totals.top_destination_launches
              ? `${data.totals.top_destination_launches.toLocaleString()} ${
                  data.totals.top_destination_kind === "link" ? "clicks" : "launches"
                }`
              : undefined
          }
        />
      </div>

      <Tabs defaultValue="apps" className="space-y-4">
        <TabsList>
          <TabsTrigger value="apps">By App</TabsTrigger>
          <TabsTrigger value="links">By Link</TabsTrigger>
          <TabsTrigger value="users">By User</TabsTrigger>
          <TabsTrigger value="recent">Recent Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="apps" className="space-y-3">
          <Input
            placeholder="Filter apps by name…"
            value={appQuery}
            onChange={(e) => setAppQuery(e.target.value)}
            className="max-w-sm"
          />
          <DestinationTable
            rows={filteredApps}
            loading={loading}
            emptyMessage="No app launches in this range."
            countHeader="Launches"
          />
        </TabsContent>

        <TabsContent value="links" className="space-y-3">
          <Input
            placeholder="Filter links by name…"
            value={linkQuery}
            onChange={(e) => setLinkQuery(e.target.value)}
            className="max-w-sm"
          />
          <DestinationTable
            rows={filteredLinks}
            loading={loading}
            emptyMessage="No link clicks in this range."
            countHeader="Clicks"
          />
        </TabsContent>

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
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead>Top destination</TableHead>
                <TableHead>Last active</TableHead>
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
                    {u.launches.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {u.top_destination ? (
                      <div className="flex items-center gap-2">
                        <span>{u.top_destination}</span>
                        <KindBadge kind={u.top_destination_kind!} />
                        <span className="text-xs text-muted-foreground">
                          ({u.top_destination_launches})
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={formatDateTime(u.last_launch)}
                  >
                    {formatRelative(u.last_launch)}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No active users in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="recent" className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.recent ?? []).map((e, i) => (
                <TableRow key={`${e.created_at}-${i}`}>
                  <TableCell
                    className="text-muted-foreground"
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
                  <TableCell>{e.destination}</TableCell>
                  <TableCell>
                    <KindBadge kind={e.kind} />
                  </TableCell>
                </TableRow>
              ))}
              {!loading && (data?.recent.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No activity yet.
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

function DestinationTable({
  rows,
  loading,
  emptyMessage,
  countHeader,
}: {
  rows: DestStat[];
  loading: boolean;
  emptyMessage: string;
  countHeader: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">{countHeader}</TableHead>
          <TableHead className="text-right">Unique users</TableHead>
          <TableHead>Last used</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell className="text-right tabular-nums">
              {r.launches.toLocaleString()}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.unique_users.toLocaleString()}
            </TableCell>
            <TableCell
              className="text-muted-foreground"
              title={formatDateTime(r.last_launch)}
            >
              {formatRelative(r.last_launch)}
            </TableCell>
          </TableRow>
        ))}
        {!loading && rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
              {emptyMessage}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function KindBadge({ kind }: { kind: "app" | "link" }) {
  return (
    <Badge variant={kind === "app" ? "default" : "outline"} className="text-[10px]">
      {kind}
    </Badge>
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
