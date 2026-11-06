"use client";

import { orgLabel, type OrgItem } from "@/lib/org/constants";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
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
import { ExportMenu } from "@/components/ui/export-menu";
import { SortHeader } from "@/components/ui/sort-header";
import { useSortableRows, type SortState } from "@/lib/hooks/use-sortable-rows";
import type { ExportColumn } from "@/lib/export/csv";
import type { AnalyticsData } from "@/lib/analytics/server";
import { ANALYTICS_RANGE_OPTIONS, type AnalyticsRange } from "@/lib/analytics/ranges";
import { fmtDateTimeUS as formatDateTime, fmtRelative } from "@/components/shared/format";
import { KindBadge } from "./kind-badge";
import { UsageOverview } from "./usage-overview";
import { fmtMinutes } from "./usage-charts";

// Lazy-load the three heavy tabs so the initial /admin/analytics bundle
// doesn't ship the calendar grid, aggregation table, or dialog with the
// first paint. Managers who land on the default Apps tab pay nothing for
// tabs they never open.
const TimeAnalytics = dynamic(
  () => import("@/components/features/admin/time-analytics").then((m) => m.TimeAnalytics),
  { ssr: false, loading: () => <TabLoading /> },
);
const TimeOffCalendar = dynamic(
  () => import("@/components/features/timeoff/TimeOffCalendar").then((m) => m.TimeOffCalendar),
  { ssr: false, loading: () => <TabLoading /> },
);
const TimeOffSummary = dynamic(
  () => import("@/components/features/timeoff/TimeOffSummary").then((m) => m.TimeOffSummary),
  { ssr: false, loading: () => <TabLoading /> },
);

function TabLoading() {
  return (
    <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

// Launcher clicks merged with time in the apps (data.usage, migration 063).
// People is everyone who used or opened it; an app nobody opened from the
// launcher (bookmarked) still shows.
type UsageCols = { minutes: number; visits: number; visit_minutes: number; people: number; last_used: string };
type DestStat = AnalyticsData["apps"][number] & UsageCols;
type UserStat = AnalyticsData["users"][number] & {
  minutes: number;
  visits: number;
  visit_minutes: number;
  days: number;
  top_app: string | null;
  last_active: string;
};
type RecentEvent = AnalyticsData["recent"][number];

const formatRelative = (iso: string) => fmtRelative(iso, formatDateTime);
const later = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b);
const avgVisit = (r: { visits: number; visit_minutes: number }) => (r.visits ? r.visit_minutes / r.visits : 0);
const NO_USAGE = { minutes: 0, visits: 0, visit_minutes: 0 };

function appRows(data: AnalyticsData): DestStat[] {
  const rows = new Map<string, DestStat>(
    data.apps.map((a) => [a.id, { ...a, ...NO_USAGE, people: a.unique_users, last_used: a.last_launch }]),
  );
  for (const u of data.usage?.apps ?? []) {
    const used = { minutes: u.minutes, visits: u.visits, visit_minutes: u.visit_minutes };
    const row = rows.get(u.app_id);
    if (row) Object.assign(row, used, { people: Math.max(row.people, u.people), last_used: later(row.last_used, u.last_seen) });
    else
      rows.set(u.app_id, {
        id: u.app_id,
        name: u.name,
        kind: "app",
        launches: 0,
        unique_users: 0,
        last_launch: u.last_seen,
        ...used,
        people: u.people,
        last_used: u.last_seen,
      });
  }
  return [...rows.values()];
}

const linkRows = (data: AnalyticsData): DestStat[] =>
  data.links.map((l) => ({ ...l, ...NO_USAGE, people: l.unique_users, last_used: l.last_launch }));

function userRows(data: AnalyticsData): UserStat[] {
  const rows = new Map<string, UserStat>(
    data.users.map((u) => [u.user_id, { ...u, ...NO_USAGE, days: 0, top_app: null, last_active: u.last_launch }]),
  );
  for (const u of data.usage?.users ?? []) {
    const used = { minutes: u.minutes, visits: u.visits, visit_minutes: u.visit_minutes, days: u.days, top_app: u.top_app };
    const row = rows.get(u.profile_id);
    if (row) Object.assign(row, used, { last_active: later(row.last_active, u.last_seen) });
    else
      rows.set(u.profile_id, {
        user_id: u.profile_id,
        email: u.email,
        name: u.name,
        role: u.role,
        office: u.office,
        launches: 0,
        last_launch: u.last_seen,
        top_destination: null,
        top_destination_kind: null,
        top_destination_launches: 0,
        ...used,
        last_active: u.last_seen,
      });
  }
  return [...rows.values()];
}

// Export column sets — kept next to the shell so the labels here match
// what the user sees in the on-screen table (any relabel touches both).
const DEST_COLUMNS = (
  countLabel: string,
  usage = false,
): ExportColumn<DestStat>[] => [
  { key: "name", label: "Name", get: (r) => r.name },
  ...(usage
    ? ([
        { key: "minutes", label: "Minutes in app", get: (r) => r.minutes },
        { key: "visits", label: "Visits", get: (r) => r.visits },
        { key: "avg", label: "Average visit (min)", get: (r) => Math.round(avgVisit(r)) },
        { key: "people", label: "People", get: (r) => r.people },
      ] satisfies ExportColumn<DestStat>[])
    : []),
  { key: "count", label: countLabel, get: (r) => r.launches },
  { key: "unique_users", label: usage ? "Opened by" : "Unique users", get: (r) => r.unique_users },
  { key: "last_used", label: "Last used", get: (r) => new Date(r.last_used) },
];

const USER_COLUMNS: ExportColumn<UserStat>[] = [
  { key: "name", label: "Name", get: (u) => u.name ?? "" },
  { key: "email", label: "Email", get: (u) => u.email },
  { key: "role", label: "Role", get: (u) => u.role },
  { key: "office", label: "Office", get: (u) => u.office ?? "" },
  { key: "minutes", label: "Minutes in apps", get: (u) => u.minutes },
  { key: "visits", label: "Visits", get: (u) => u.visits },
  { key: "avg", label: "Average visit (min)", get: (u) => Math.round(avgVisit(u)) },
  { key: "days", label: "Days active", get: (u) => u.days },
  { key: "top_app", label: "Most-used app", get: (u) => u.top_app ?? "" },
  { key: "clicks", label: "Launcher clicks", get: (u) => u.launches },
  { key: "top_destination", label: "Top destination", get: (u) => u.top_destination ?? "" },
  {
    key: "top_destination_kind",
    label: "Top type",
    get: (u) => u.top_destination_kind ?? "",
  },
  {
    key: "top_destination_launches",
    label: "Top clicks",
    get: (u) => u.top_destination_launches ?? 0,
  },
  { key: "last_active", label: "Last active", get: (u) => new Date(u.last_active) },
];

const RECENT_COLUMNS: ExportColumn<RecentEvent>[] = [
  { key: "when", label: "When", get: (e) => new Date(e.created_at) },
  { key: "name", label: "Name", get: (e) => e.name ?? "" },
  { key: "email", label: "Email", get: (e) => e.email },
  { key: "destination", label: "Destination", get: (e) => e.destination },
  { key: "type", label: "Type", get: (e) => e.kind },
];

type DestSortKey = "name" | "minutes" | "visits" | "avg" | "people" | "count" | "unique_users" | "last_used";
// Sort getters live at module scope so useSortableRows' memo stays stable.
const DEST_SORT = {
  name: (r: DestStat) => r.name.toLowerCase(),
  minutes: (r: DestStat) => r.minutes,
  visits: (r: DestStat) => r.visits,
  avg: (r: DestStat) => avgVisit(r),
  people: (r: DestStat) => r.people,
  count: (r: DestStat) => r.launches,
  unique_users: (r: DestStat) => r.unique_users,
  last_used: (r: DestStat) => new Date(r.last_used),
};
type UserSortKey = "name" | "role" | "office" | "minutes" | "visits" | "avg" | "days" | "clicks" | "top" | "last_active";
type RecentSortKey = "when" | "name" | "destination" | "type";
const USER_SORT = {
  name: (u: UserStat) => (u.name || u.email).toLowerCase(),
  role: (u: UserStat) => u.role,
  office: (u: UserStat) => u.office ?? "",
  minutes: (u: UserStat) => u.minutes,
  visits: (u: UserStat) => u.visits,
  avg: (u: UserStat) => avgVisit(u),
  days: (u: UserStat) => u.days,
  clicks: (u: UserStat) => u.launches,
  top: (u: UserStat) => (u.top_app ?? u.top_destination ?? "").toLowerCase(),
  last_active: (u: UserStat) => new Date(u.last_active),
};
const RECENT_SORT = {
  when: (e: RecentEvent) => new Date(e.created_at),
  name: (e: RecentEvent) => (e.name || e.email).toLowerCase(),
  destination: (e: RecentEvent) => e.destination.toLowerCase(),
  type: (e: RecentEvent) => e.kind,
};
const NO_RECENT: RecentEvent[] = [];

export default function AnalyticsShell({
  initialData,
  initialRange,
  initialError,
  offices,
  departments,
}: {
  initialData: AnalyticsData | null;
  initialRange: AnalyticsRange;
  initialError: string | null;
  offices: OrgItem[];
  departments: OrgItem[];
}) {
  const [range, setRange] = useState<AnalyticsRange>(initialRange);
  const [data, setData] = useState<AnalyticsData | null>(initialData);
  const [loading, setLoading] = useState(initialData === null && initialError === null);
  const [error, setError] = useState<string | null>(initialError);
  const [appQuery, setAppQuery] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  // Controlled tab value so heavy children (TimeAnalytics, TimeOffSummary,
  // TimeOffCalendar) can skip their fetch effects until their tab is active.
  const [tab, setTab] = useState<
    "apps" | "links" | "users" | "recent" | "time" | "timeoff"
  >("apps");

  // Skip the initial fetch when the server already provided data or an error.
  // Client-side range changes still trigger a fresh fetch as before.
  const skipInitialFetchRef = useRef(initialData !== null || initialError !== null);

  useEffect(() => {
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/analytics?range=${range}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Failed to load");
        return r.json();
      })
      .then((json: AnalyticsData) => {
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

  const apps = useMemo(() => (data ? appRows(data) : []), [data]);
  const links = useMemo(() => (data ? linkRows(data) : []), [data]);
  const users = useMemo(() => (data ? userRows(data) : []), [data]);
  const hasUsage = !!data?.usage;

  const filteredApps = useMemo(() => {
    const q = appQuery.toLowerCase().trim();
    return q ? apps.filter((a) => a.name.toLowerCase().includes(q)) : apps;
  }, [apps, appQuery]);

  const filteredLinks = useMemo(() => {
    const q = linkQuery.toLowerCase().trim();
    return q ? links.filter((l) => l.name.toLowerCase().includes(q)) : links;
  }, [links, linkQuery]);

  const filteredUsers = useMemo(() => {
    const q = userQuery.toLowerCase().trim();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.name?.toLowerCase().includes(q) ?? false)
    );
  }, [users, userQuery]);

  const appSort = useSortableRows<DestStat, DestSortKey>(filteredApps, DEST_SORT, {
    key: initialData?.usage ? "minutes" : "count",
    direction: "desc",
  });
  const linkSort = useSortableRows<DestStat, DestSortKey>(filteredLinks, DEST_SORT, {
    key: "count",
    direction: "desc",
  });

  const userSort = useSortableRows<UserStat, UserSortKey>(filteredUsers, USER_SORT, {
    key: initialData?.usage ? "minutes" : "clicks",
    direction: "desc",
  });
  const recentSort = useSortableRows<RecentEvent, RecentSortKey>(
    data?.recent ?? NO_RECENT,
    RECENT_SORT,
    { key: "when", direction: "desc" },
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">App Analytics</h1>
          <p className="text-muted-foreground">
            Who uses which apps, how often they come back, how long they stay and when — plus what they open from the
            launcher.
          </p>
        </div>
        <Select value={range} onValueChange={(v) => setRange(v as AnalyticsRange)}>
          <SelectTrigger className="w-[180px] print:hidden">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ANALYTICS_RANGE_OPTIONS.map((r) => (
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

      <UsageOverview data={data} people={users.length} loading={loading} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="space-y-4">
        <TabsList className="print:hidden">
          <TabsTrigger value="apps">By App</TabsTrigger>
          <TabsTrigger value="links">By Link</TabsTrigger>
          <TabsTrigger value="users">By User</TabsTrigger>
          <TabsTrigger value="recent">Recent Activity</TabsTrigger>
          <TabsTrigger value="time">Time &amp; Hours</TabsTrigger>
          <TabsTrigger value="timeoff">Time Off</TabsTrigger>
        </TabsList>

        <TabsContent value="apps" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Input
              placeholder="Filter apps by name…"
              value={appQuery}
              onChange={(e) => setAppQuery(e.target.value)}
              className="max-w-sm print:hidden"
            />
            <ExportMenu
              filename={`analytics-apps-${range}`}
              rows={appSort.sorted}
              columns={DEST_COLUMNS("Launcher opens", hasUsage)}
            />
          </div>
          <DestinationTable
            rows={appSort.sorted}
            loading={loading}
            emptyMessage="No app use in this range."
            countHeader="Launcher opens"
            showUsage={hasUsage}
            hrefKind="apps"
            range={range}
            sort={appSort.sort}
            onToggle={appSort.toggle}
          />
        </TabsContent>

        <TabsContent value="links" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Input
              placeholder="Filter links by name…"
              value={linkQuery}
              onChange={(e) => setLinkQuery(e.target.value)}
              className="max-w-sm print:hidden"
            />
            <ExportMenu
              filename={`analytics-links-${range}`}
              rows={linkSort.sorted}
              columns={DEST_COLUMNS("Clicks")}
            />
          </div>
          <DestinationTable
            rows={linkSort.sorted}
            loading={loading}
            emptyMessage="No link clicks in this range."
            countHeader="Clicks"
            hrefKind="links"
            range={range}
            sort={linkSort.sort}
            onToggle={linkSort.toggle}
          />
        </TabsContent>

        <TabsContent value="users" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Input
              placeholder="Filter users by name or email…"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              className="max-w-sm print:hidden"
            />
            <ExportMenu
              filename={`analytics-users-${range}`}
              rows={userSort.sorted}
              columns={USER_COLUMNS}
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader
                  columnKey="name"
                  label="User"
                  sort={userSort.sort}
                  onToggle={userSort.toggle}
                />
                <SortHeader
                  columnKey="role"
                  label="Role"
                  sort={userSort.sort}
                  onToggle={userSort.toggle}
                />
                <SortHeader
                  columnKey="office"
                  label="Office"
                  sort={userSort.sort}
                  onToggle={userSort.toggle}
                />
                {hasUsage && (
                  <>
                    <SortHeader columnKey="minutes" label="Time" sort={userSort.sort} onToggle={userSort.toggle} align="right" />
                    <SortHeader columnKey="visits" label="Visits" sort={userSort.sort} onToggle={userSort.toggle} align="right" />
                    <SortHeader columnKey="avg" label="Avg visit" sort={userSort.sort} onToggle={userSort.toggle} align="right" />
                    <SortHeader columnKey="days" label="Days" sort={userSort.sort} onToggle={userSort.toggle} align="right" />
                  </>
                )}
                <SortHeader
                  columnKey="clicks"
                  label="Launcher clicks"
                  sort={userSort.sort}
                  onToggle={userSort.toggle}
                  align="right"
                />
                <SortHeader
                  columnKey="top"
                  label={hasUsage ? "Most-used app" : "Top destination"}
                  sort={userSort.sort}
                  onToggle={userSort.toggle}
                />
                <SortHeader
                  columnKey="last_active"
                  label="Last active"
                  sort={userSort.sort}
                  onToggle={userSort.toggle}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {userSort.sorted.map((u) => {
                const href = `/admin/analytics/users/${u.user_id}?range=${range}`;
                return (
                <TableRow
                  key={u.user_id}
                  className="group cursor-pointer transition-colors hover:bg-muted/50"
                >
                  <TableCell>
                    <Link href={href} className="block hover:underline">
                      <div className="font-medium">{u.name || u.email}</div>
                      {u.name && (
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={href} className="block">
                      <Badge variant="secondary">{u.role}</Badge>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={href} className="block">
                      {u.office ? (
                        <Badge variant="outline">{orgLabel(offices, u.office)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Link>
                  </TableCell>
                  {hasUsage && (
                    <>
                      <NumCell href={href} v={u.minutes} fmt={fmtMinutes} />
                      <NumCell href={href} v={u.visits} />
                      <NumCell href={href} v={avgVisit(u)} fmt={fmtMinutes} />
                      <NumCell href={href} v={u.days} />
                    </>
                  )}
                  <NumCell href={href} v={u.launches} />
                  <TableCell>
                    <Link href={href} className="block">
                      {hasUsage && u.top_app ? (
                        u.top_app
                      ) : u.top_destination ? (
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
                    </Link>
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={formatDateTime(u.last_active)}
                  >
                    <Link href={href} className="block">
                      {formatRelative(u.last_active)}
                    </Link>
                  </TableCell>
                </TableRow>
                );
              })}
              {!loading && userSort.sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={hasUsage ? 10 : 6} className="py-8 text-center text-muted-foreground">
                    No active users in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="recent" className="space-y-3">
          <div className="flex items-center justify-end">
            <ExportMenu
              filename={`analytics-recent-${range}`}
              rows={recentSort.sorted}
              columns={RECENT_COLUMNS}
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader
                  columnKey="when"
                  label="When"
                  sort={recentSort.sort}
                  onToggle={recentSort.toggle}
                />
                <SortHeader
                  columnKey="name"
                  label="User"
                  sort={recentSort.sort}
                  onToggle={recentSort.toggle}
                />
                <SortHeader
                  columnKey="destination"
                  label="Destination"
                  sort={recentSort.sort}
                  onToggle={recentSort.toggle}
                />
                <SortHeader
                  columnKey="type"
                  label="Type"
                  sort={recentSort.sort}
                  onToggle={recentSort.toggle}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentSort.sorted.map((e, i) => (
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
              {!loading && recentSort.sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No activity yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="time" className="space-y-3">
          <TimeAnalytics active={tab === "time"} offices={offices} departments={departments} />
        </TabsContent>

        <TabsContent value="timeoff" className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-1">Summary</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Per-employee approved days broken down by type, plus pending totals and recent notes.
            </p>
            <TimeOffSummary active={tab === "timeoff"} />
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-1">Calendar</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Who&rsquo;s off when — spot overlaps before approving new requests.
            </p>
            <TimeOffCalendar active={tab === "timeoff"} />
          </div>
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
  showUsage = false,
  hrefKind,
  range,
  sort,
  onToggle,
}: {
  rows: DestStat[];
  loading: boolean;
  emptyMessage: string;
  countHeader: string;
  /** Apps: time in the app, visits, average visit and people next to launcher opens. */
  showUsage?: boolean;
  hrefKind: "apps" | "links";
  range: string;
  sort: SortState<DestSortKey>;
  onToggle: (key: DestSortKey) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHeader
            columnKey="name"
            label="Name"
            sort={sort}
            onToggle={onToggle}
          />
          {showUsage && (
            <>
              <SortHeader columnKey="minutes" label="Time" sort={sort} onToggle={onToggle} align="right" />
              <SortHeader columnKey="visits" label="Visits" sort={sort} onToggle={onToggle} align="right" />
              <SortHeader columnKey="avg" label="Avg visit" sort={sort} onToggle={onToggle} align="right" />
              <SortHeader columnKey="people" label="People" sort={sort} onToggle={onToggle} align="right" />
            </>
          )}
          <SortHeader
            columnKey="count"
            label={countHeader}
            sort={sort}
            onToggle={onToggle}
            align="right"
          />
          <SortHeader
            columnKey="unique_users"
            label={showUsage ? "Opened by" : "Unique users"}
            sort={sort}
            onToggle={onToggle}
            align="right"
          />
          <SortHeader
            columnKey="last_used"
            label="Last used"
            sort={sort}
            onToggle={onToggle}
          />
          <TableHead className="w-8" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow
            key={r.id}
            className="group cursor-pointer transition-colors hover:bg-muted/50"
          >
            <TableCell className="font-medium">
              <Link
                href={`/admin/analytics/${hrefKind}/${r.id}?range=${range}`}
                className="block hover:underline"
              >
                {r.name}
              </Link>
            </TableCell>
            {showUsage && (
              <>
                <NumCell href={`/admin/analytics/${hrefKind}/${r.id}?range=${range}`} v={r.minutes} fmt={fmtMinutes} />
                <NumCell href={`/admin/analytics/${hrefKind}/${r.id}?range=${range}`} v={r.visits} />
                <NumCell href={`/admin/analytics/${hrefKind}/${r.id}?range=${range}`} v={avgVisit(r)} fmt={fmtMinutes} />
                <NumCell href={`/admin/analytics/${hrefKind}/${r.id}?range=${range}`} v={r.people} />
              </>
            )}
            <TableCell className="text-right tabular-nums">
              <Link
                href={`/admin/analytics/${hrefKind}/${r.id}?range=${range}`}
                className="block"
              >
                {r.launches.toLocaleString()}
              </Link>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <Link
                href={`/admin/analytics/${hrefKind}/${r.id}?range=${range}`}
                className="block"
              >
                {r.unique_users.toLocaleString()}
              </Link>
            </TableCell>
            <TableCell
              className="text-muted-foreground"
              title={formatDateTime(r.last_used)}
            >
              <Link
                href={`/admin/analytics/${hrefKind}/${r.id}?range=${range}`}
                className="block"
              >
                {formatRelative(r.last_used)}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">
              <Link
                href={`/admin/analytics/${hrefKind}/${r.id}?range=${range}`}
                className="block"
                aria-label={`View ${r.name} details`}
              >
                <ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </TableCell>
          </TableRow>
        ))}
        {!loading && rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={showUsage ? 9 : 5} className="py-8 text-center text-muted-foreground">
              {emptyMessage}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

/** A right-aligned number cell linking to the drill-down; 0 shows dimmed. */
function NumCell({ href, v, fmt = (n) => n.toLocaleString() }: { href: string; v: number; fmt?: (n: number) => string }) {
  return (
    <TableCell className={`text-right tabular-nums ${v ? "" : "text-muted-foreground/60"}`}>
      <Link href={href} className="block">
        {v ? fmt(v) : "—"}
      </Link>
    </TableCell>
  );
}
