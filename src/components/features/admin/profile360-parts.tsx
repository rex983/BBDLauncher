// Per-tab and small display sub-components for UserProfile360Shell. Kept
// here (rather than inline in the shell file) so the shell stays focused
// on state + orchestration, and each tab can be reasoned about locally.

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TimePunch } from "@/lib/timesheets/state";
import {
  requestDays,
  TIME_OFF_TYPE_LABEL,
  TIME_OFF_TYPES,
  type TimeOffType,
} from "@/lib/timeoff/types";
import {
  formatIncidentNumber,
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_STATUS_LABEL,
  type IncidentStatus,
} from "@/lib/incidents/types";
import type { IncidentSummary } from "@/components/features/incidents/IncidentPanel";
import type { WindowTimeOffRow, YtdBreakdown } from "@/lib/timesheets/detail";
import {
  EVENT_LABEL,
  SEVERITY_VARIANT,
  fmtDate,
  fmtDateTime,
  fmtDays,
  fmtRelative,
  shortenAgent,
  type AnalyticsPayload,
} from "./profile360-helpers";

export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className="text-lg font-semibold mt-1 truncate" title={value}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className="text-base font-semibold mt-0.5">{value}</div>
    </div>
  );
}

export function PunchesTab({
  punches,
  days,
  onDaysChange,
  loading,
}: {
  punches: TimePunch[];
  days: number;
  onDaysChange: (n: number) => void;
  loading: boolean;
}) {
  const sorted = useMemo(
    () => [...punches].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1)),
    [punches],
  );
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Time punches</CardTitle>
        <Select value={String(days)} onValueChange={(v) => onDaysChange(Number(v))}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 1 day</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No punches in the selected window.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap">
                    <div className="text-sm">{fmtDateTime(p.occurred_at)}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtRelative(p.occurred_at)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{EVENT_LABEL[p.event_type]}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.source}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.note ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function TimeOffTab({
  windowRows,
  ytd,
}: {
  windowRows: WindowTimeOffRow[];
  ytd: YtdBreakdown;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            YTD breakdown — {new Date().getFullYear()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-6">
            {TIME_OFF_TYPES.map((t) => (
              <MiniStat
                key={t.value}
                label={TIME_OFF_TYPE_LABEL[t.value]}
                value={`${fmtDays(ytd[t.value as TimeOffType] || 0)} d`}
              />
            ))}
            <MiniStat label="Total" value={`${fmtDays(ytd.total)} d`} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Requests in window</CardTitle>
        </CardHeader>
        <CardContent>
          {windowRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No time-off requests in this window.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dates</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Length</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {windowRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {fmtDate(r.start_date + "T00:00:00")}
                      {r.start_date !== r.end_date && (
                        <> – {fmtDate(r.end_date + "T00:00:00")}</>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="w-fit">
                        {TIME_OFF_TYPE_LABEL[r.type]}
                      </Badge>
                      {r.subcategory && (
                        <div className="text-xs text-muted-foreground">
                          {r.subcategory}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.full_day
                        ? `${fmtDays(requestDays(r))} d`
                        : `${r.hours}h`}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "approved"
                            ? "default"
                            : r.status === "denied"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs">
                      {r.reason || r.decided_note || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function IncidentsTab({ incidents }: { incidents: IncidentSummary[] }) {
  if (incidents.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No incident reports on file.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Filed</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attachments</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {incidents.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {formatIncidentNumber(r.number)}
                </TableCell>
                <TableCell className="text-sm">{fmtDate(r.created_at)}</TableCell>
                <TableCell>
                  <Link
                    href={`/management/incidents?open=${r.id}`}
                    className="font-medium hover:underline"
                  >
                    {r.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {INCIDENT_CATEGORY_LABEL[r.category]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={SEVERITY_VARIANT[r.severity]}>
                    {INCIDENT_SEVERITY_LABEL[r.severity]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      (r.status as IncidentStatus) === "awaiting_employee_sig" ||
                      (r.status as IncidentStatus) === "awaiting_manager_sig"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {INCIDENT_STATUS_LABEL[r.status as IncidentStatus]}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.attachments && r.attachments.length > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <Paperclip className="h-3 w-3" />
                      {r.attachments.length}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function AppsTab({
  analytics,
  loading,
  range,
}: {
  analytics: AnalyticsPayload | null;
  loading: boolean;
  range: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const rows = analytics?.destinations ?? [];
    const q = query.toLowerCase().trim();
    return q ? rows.filter((d) => d.name.toLowerCase().includes(q)) : rows;
  }, [analytics, query]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Apps &amp; links used</CardTitle>
          <Input
            placeholder="Filter destinations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-xs"
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No launcher activity in the selected range.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destination</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead>First used</TableHead>
                <TableHead>Last used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((d) => {
                const href = `/admin/analytics/${d.kind === "app" ? "apps" : "links"}/${d.id}?range=${range}`;
                return (
                  <TableRow key={`${d.kind}:${d.id}`} className="hover:bg-muted/50">
                    <TableCell className="font-medium">
                      <Link href={href} className="hover:underline">
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
                      {d.count.toLocaleString()}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground text-sm"
                      title={fmtDateTime(d.first_used)}
                    >
                      {fmtRelative(d.first_used)}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground text-sm"
                      title={fmtDateTime(d.last_used)}
                    >
                      {fmtRelative(d.last_used)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function AuditTab({
  analytics,
  loading,
  range,
}: {
  analytics: AnalyticsPayload | null;
  loading: boolean;
  range: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const rows = analytics?.audit_log ?? [];
    const q = query.toLowerCase().trim();
    return q ? rows.filter((e) => e.destination_name.toLowerCase().includes(q)) : rows;
  }, [analytics, query]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Recent events</CardTitle>
          <Input
            placeholder="Filter by destination…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-xs"
          />
        </div>
        {analytics?.audit_log_truncated && (
          <p className="text-xs text-muted-foreground">
            Showing latest 500 of {analytics.totals.events.toLocaleString()} events.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No events in the selected range.
          </p>
        ) : (
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
              {filtered.map((e) => {
                const href = e.destination_id
                  ? `/admin/analytics/${e.kind === "app" ? "apps" : "links"}/${e.destination_id}?range=${range}`
                  : null;
                return (
                  <TableRow key={e.id}>
                    <TableCell
                      className="text-muted-foreground whitespace-nowrap"
                      title={fmtDateTime(e.created_at)}
                    >
                      {fmtRelative(e.created_at)}
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
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
