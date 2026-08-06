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

type AppStat = {
  app_id: string;
  app_name: string;
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
  top_app: string | null;
  top_app_launches: number;
};

type RecentEvent = {
  created_at: string;
  email: string;
  name: string | null;
  app_name: string;
};

type AnalyticsResponse = {
  range: string;
  totals: {
    launches: number;
    unique_users: number;
    unique_apps: number;
    top_app: string | null;
    top_app_launches: number;
  };
  apps: AppStat[];
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
    if (!q) return data.apps;
    return data.apps.filter((a) => a.app_name.toLowerCase().includes(q));
  }, [data, appQuery]);

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
            Which users are launching which apps, and how often.
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
          title="Total launches"
          value={loading ? "…" : data?.totals.launches.toLocaleString() ?? "0"}
        />
        <StatCard
          title="Active users"
          value={loading ? "…" : data?.totals.unique_users.toLocaleString() ?? "0"}
        />
        <StatCard
          title="Apps used"
          value={loading ? "…" : data?.totals.unique_apps.toLocaleString() ?? "0"}
        />
        <StatCard
          title="Most-launched app"
          value={loading ? "…" : data?.totals.top_app ?? "—"}
          subvalue={
            data?.totals.top_app_launches
              ? `${data.totals.top_app_launches.toLocaleString()} launches`
              : undefined
          }
        />
      </div>

      <Tabs defaultValue="apps" className="space-y-4">
        <TabsList>
          <TabsTrigger value="apps">By App</TabsTrigger>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead className="text-right">Launches</TableHead>
                <TableHead className="text-right">Unique users</TableHead>
                <TableHead>Last launched</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredApps.map((a) => (
                <TableRow key={a.app_id}>
                  <TableCell className="font-medium">{a.app_name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {a.launches.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {a.unique_users.toLocaleString()}
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={formatDateTime(a.last_launch)}
                  >
                    {formatRelative(a.last_launch)}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && filteredApps.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No launches in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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
                <TableHead className="text-right">Launches</TableHead>
                <TableHead>Top app</TableHead>
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
                    {u.top_app ? (
                      <>
                        <span>{u.top_app}</span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({u.top_app_launches})
                        </span>
                      </>
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
                <TableHead>App</TableHead>
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
                  <TableCell>{e.app_name}</TableCell>
                </TableRow>
              ))}
              {!loading && (data?.recent.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
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
