"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatDuration } from "@/lib/timesheets/state";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import type { Department, Office } from "@/types/auth";

interface WeekTotal {
  week_start: string;
  worked_ms: number;
  overtime_ms: number;
}

interface Row {
  profile: {
    id: string;
    email: string;
    name: string | null;
    office: Office | null;
    department: Department | null;
    is_active: boolean;
  };
  total_ms: number;
  overtime_ms: number;
  weeks: WeekTotal[];
}

interface Summary {
  employee_count: number;
  working_employee_count: number;
  total_ms: number;
  total_overtime_ms: number;
  in_overtime_count: number;
  avg_ms_per_working_employee: number;
}

interface Response {
  range: { from: string; to: string; weeks: number };
  week_starts: string[];
  rows: Row[];
  summary: Summary;
}

const ALL = "__all__";
const RANGE_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "This week" },
  { value: 2, label: "Last 2 weeks" },
  { value: 4, label: "Last 4 weeks" },
  { value: 12, label: "Last 12 weeks" },
];
const OFFICES: Office[] = ["Harbor", "Marion", "BST", "RnD"];
const DEPARTMENTS: Department[] = ["SALES TEAM", "BST", "RnD"];

type SortKey = "total" | "overtime" | "name";

function fmtWeekLabel(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

// Time-data analytics widget. Rendered inside /admin/analytics as its own
// tab; sources data from /api/management/analytics/time. Scope is enforced
// server-side (admin sees all, managers see their office ∩ department).
export function TimeAnalytics({ active = true }: { active?: boolean } = {}) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const viewerOffice = session?.user?.office ?? null;
  const viewerDepartment = session?.user?.department ?? null;
  const { viewAsOffice } = useRolePreview();

  const [weeks, setWeeks] = useState(4);
  const [office, setOffice] = useState<string>(ALL);
  const [department, setDepartment] = useState<string>(ALL);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [sort, setSort] = useState<SortKey>("total");
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAdmin && viewAsOffice) setOffice(viewAsOffice);
  }, [isAdmin, viewAsOffice]);

  useEffect(() => {
    // Wait until the tab is actually visible before hitting the API.
    // /admin/analytics mounts every tab, and this one aggregates the last
    // 4 weeks of time punches — not something to burn round-trips on
    // when the user is browsing the Apps or Users tab.
    if (!active) return;
    const params = new URLSearchParams({ weeks: String(weeks) });
    if (isAdmin && office !== ALL) params.set("office", office);
    if (isAdmin && department !== ALL) params.set("department", department);
    if (isAdmin && includeInactive) params.set("includeInactive", "1");
    setLoading(true);
    fetch(`/api/management/analytics/time?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setData(json))
      .finally(() => setLoading(false));
  }, [active, weeks, office, department, includeInactive, isAdmin]);

  const rows = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.rows];
    if (sort === "total") sorted.sort((a, b) => b.total_ms - a.total_ms);
    else if (sort === "overtime") sorted.sort((a, b) => b.overtime_ms - a.overtime_ms);
    else if (sort === "name")
      sorted.sort((a, b) =>
        (a.profile.name || a.profile.email).localeCompare(b.profile.name || b.profile.email),
      );
    return sorted;
  }, [data, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(weeks)} onValueChange={(v) => setWeeks(Number(v))}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((r) => (
              <SelectItem key={r.value} value={String(r.value)}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Office</span>
          {isAdmin ? (
            <Select value={office} onValueChange={setOffice}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {OFFICES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline">{viewerOffice ?? "—"}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Department</span>
          {isAdmin ? (
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline">{viewerDepartment ?? "—"}</Badge>
          )}
        </div>
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Include inactive
          </label>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Total hours"
          value={loading || !data ? "…" : formatDuration(data.summary.total_ms)}
          sub={data ? `${data.summary.working_employee_count} employees on the clock` : undefined}
        />
        <Stat
          label="Avg per employee"
          value={loading || !data ? "…" : formatDuration(data.summary.avg_ms_per_working_employee)}
        />
        <Stat
          label="Overtime hours"
          value={loading || !data ? "…" : formatDuration(data.summary.total_overtime_ms)}
          sub={data ? `${data.summary.in_overtime_count} over 40h/wk` : undefined}
          highlight={!!data && data.summary.in_overtime_count > 0}
        />
        <Stat
          label="Employees in scope"
          value={loading || !data ? "…" : String(data.summary.employee_count)}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Per-employee hours</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Sort</span>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="w-[140px] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="total">Total hours</SelectItem>
                <SelectItem value="overtime">Overtime</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nobody in your scope yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Office</TableHead>
                  <TableHead>Dept</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Overtime</TableHead>
                  {weeks > 1 &&
                    data?.week_starts.map((iso) => (
                      <TableHead key={iso}>Wk {fmtWeekLabel(iso)}</TableHead>
                    ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.profile.id}
                    className={row.profile.is_active === false ? "opacity-60" : undefined}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/management/timesheets/${row.profile.id}`}
                        className="hover:underline"
                      >
                        {row.profile.name || row.profile.email}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {row.profile.email}
                        {row.profile.is_active === false && (
                          <Badge variant="destructive" className="ml-2">Inactive</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.profile.office ? (
                        <Badge variant="outline">{row.profile.office}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.profile.department ? (
                        <Badge variant="outline">{row.profile.department}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{formatDuration(row.total_ms)}</TableCell>
                    <TableCell>
                      {row.overtime_ms > 0 ? (
                        <Badge variant="destructive">+{formatDuration(row.overtime_ms)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {weeks > 1 &&
                      row.weeks.map((w) => (
                        <TableCell key={w.week_start} className="text-sm">
                          <span className="flex items-center gap-1">
                            {w.worked_ms > 0 ? (
                              formatDuration(w.worked_ms)
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {w.overtime_ms > 0 && <Badge variant="destructive">OT</Badge>}
                          </span>
                        </TableCell>
                      ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Weeks run Sunday–Saturday, ET. Overtime is any time past 40 hours in a week.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border bg-card p-4 ${
        highlight ? "border-destructive/60 bg-destructive/5" : ""
      }`}
    >
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
