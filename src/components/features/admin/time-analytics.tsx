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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ExportMenu } from "@/components/ui/export-menu";
import { SortHeader } from "@/components/ui/sort-header";
import { useSortableRows } from "@/lib/hooks/use-sortable-rows";
import type { ExportColumn } from "@/lib/export/csv";
import { formatDuration } from "@/lib/timesheets/state";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import { TIME_OFF_TYPE_LABEL, type TimeOffType } from "@/lib/timeoff/types";
import type { Department, Office } from "@/types/auth";

interface WeekTotal {
  week_start: string;
  worked_ms: number;
  overtime_ms: number;
}

type TimeOffBreakdown = Record<TimeOffType, number> & { total: number };

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
  overtime_weeks: number;
  lunch_ms: number;
  break_ms: number;
  ytd_worked_ms: number;
  ytd_overtime_ms: number;
  ytd_overtime_weeks: number;
  time_off: TimeOffBreakdown;
  weeks: WeekTotal[];
}

interface TeamWeek {
  week_start: string;
  worked_ms: number;
  overtime_ms: number;
  in_overtime_count: number;
}

interface Summary {
  employee_count: number;
  working_employee_count: number;
  total_ms: number;
  total_overtime_ms: number;
  total_lunch_ms: number;
  total_break_ms: number;
  in_overtime_count: number;
  ytd_overtime_ms: number;
  ytd_in_overtime_count: number;
  avg_ms_per_working_employee: number;
  time_off: TimeOffBreakdown;
  weekly: TeamWeek[];
}

interface Response {
  range: { from: string; to: string; weeks: number };
  ytd_from: string;
  week_starts: string[];
  rows: Row[];
  summary: Summary;
}

const TIME_OFF_TYPES_ORDERED: TimeOffType[] = [
  "sick",
  "vacation",
  "personal",
  "parental",
  "other",
];

function fmtDays(d: number): string {
  if (d === 0) return "0";
  return (Math.round(d * 10) / 10).toString();
}

// ms → hours as a plain number (2 decimals) — friendlier for spreadsheets
// than "5h 42m" strings when the user wants to sum or chart the column.
function msToHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 100) / 100;
}

const YTD_OVERTIME_COLUMNS: ExportColumn<Row>[] = [
  { key: "worked_hours_ytd", label: "Worked hours (YTD)", get: (r) => msToHours(r.ytd_worked_ms) },
  { key: "overtime_hours_ytd", label: "Overtime hours (YTD)", get: (r) => msToHours(r.ytd_overtime_ms) },
  { key: "overtime_weeks_ytd", label: "Weeks over 40h (YTD)", get: (r) => r.ytd_overtime_weeks },
];

const TIME_OFF_YTD_COLUMNS: ExportColumn<Row>[] = [
  { key: "sick_days_ytd", label: "Sick days (YTD)", get: (r) => r.time_off.sick },
  { key: "vacation_days_ytd", label: "Vacation days (YTD)", get: (r) => r.time_off.vacation },
  { key: "personal_days_ytd", label: "Personal days (YTD)", get: (r) => r.time_off.personal },
  { key: "parental_days_ytd", label: "Parental days (YTD)", get: (r) => r.time_off.parental },
  { key: "other_days_ytd", label: "Other days (YTD)", get: (r) => r.time_off.other },
  { key: "time_off_total_ytd", label: "Time off (YTD, days)", get: (r) => r.time_off.total },
];

const TEAM_WEEK_COLUMNS: ExportColumn<TeamWeek>[] = [
  { key: "week_start", label: "Week starting", get: (w) => w.week_start },
  { key: "worked_hours", label: "Team hours", get: (w) => msToHours(w.worked_ms) },
  { key: "overtime_hours", label: "Overtime hours", get: (w) => msToHours(w.overtime_ms) },
  { key: "in_overtime_count", label: "Employees over 40h", get: (w) => w.in_overtime_count },
];

const ALL = "__all__";
const RANGE_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "This week" },
  { value: 2, label: "Last 2 weeks" },
  { value: 4, label: "Last 4 weeks" },
  { value: 12, label: "Last 12 weeks" },
];
const OFFICES: Office[] = ["Harbor", "Marion", "BST", "RnD"];
const DEPARTMENTS: Department[] = ["SALES TEAM", "BST", "RnD"];

type SortKey =
  | "name" | "office" | "department" | "total" | "overtime" | "ytd_overtime"
  | "lunch" | "break" | "time_off";

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
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Row | null>(null);

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

  const rowSort = useSortableRows<Row, SortKey>(
    data?.rows ?? [],
    {
      name: (r) => (r.profile.name || r.profile.email).toLowerCase(),
      office: (r) => r.profile.office ?? "",
      department: (r) => r.profile.department ?? "",
      total: (r) => r.total_ms,
      overtime: (r) => r.overtime_ms,
      ytd_overtime: (r) => r.ytd_overtime_ms,
      lunch: (r) => r.lunch_ms,
      break: (r) => r.break_ms,
      time_off: (r) => r.time_off.total,
    },
    { key: "total", direction: "desc" },
  );

  // Filename baked from current filter selection so the download reflects
  // exactly what the manager is looking at.
  const filenameBase = useMemo(() => {
    const parts = ["time-analytics"];
    parts.push(office === ALL ? "all-offices" : office.toLowerCase());
    if (department !== ALL) parts.push(department.toLowerCase().replace(/\s+/g, "-"));
    parts.push(`${weeks}w`);
    return parts.join("-");
  }, [office, department, weeks]);

  const rowColumns = useMemo<ExportColumn<Row>[]>(() => {
    const base: ExportColumn<Row>[] = [
      { key: "name", label: "Name", get: (r) => r.profile.name ?? "" },
      { key: "email", label: "Email", get: (r) => r.profile.email },
      { key: "office", label: "Office", get: (r) => r.profile.office ?? "" },
      { key: "department", label: "Department", get: (r) => r.profile.department ?? "" },
      { key: "total_hours", label: "Total hours", get: (r) => msToHours(r.total_ms) },
      { key: "overtime_hours", label: "Overtime hours", get: (r) => msToHours(r.overtime_ms) },
      { key: "overtime_weeks", label: "Weeks over 40h", get: (r) => r.overtime_weeks },
      { key: "lunch_hours", label: "Lunch hours", get: (r) => msToHours(r.lunch_ms) },
      { key: "break_hours", label: "Break hours", get: (r) => msToHours(r.break_ms) },
      ...YTD_OVERTIME_COLUMNS,
      ...TIME_OFF_YTD_COLUMNS,
    ];
    for (const ws of data?.week_starts ?? []) {
      base.push({
        key: `wk_${ws}_hours`,
        label: `Wk ${fmtWeekLabel(ws)} hours`,
        get: (r) => msToHours(r.weeks.find((w) => w.week_start === ws)?.worked_ms ?? 0),
      });
      base.push({
        key: `wk_${ws}_overtime`,
        label: `Wk ${fmtWeekLabel(ws)} OT hours`,
        get: (r) => msToHours(r.weeks.find((w) => w.week_start === ws)?.overtime_ms ?? 0),
      });
    }
    return base;
  }, [data?.week_starts]);

  const rows = rowSort.sorted;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 print:hidden">
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
        <ExportMenu
          filename={filenameBase}
          rows={rows}
          columns={rowColumns}
          disabled={loading || rows.length === 0}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Total hours"
          value={loading || !data ? "…" : formatDuration(data.summary.total_ms)}
          sub={
            data
              ? `${data.summary.working_employee_count} of ${data.summary.employee_count} employees on the clock`
              : undefined
          }
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
          label="Overtime (YTD)"
          value={loading || !data ? "…" : formatDuration(data.summary.ytd_overtime_ms)}
          sub={data ? `${data.summary.ytd_in_overtime_count} employees this year` : undefined}
          highlight={!!data && data.summary.ytd_overtime_ms > 0}
        />
        <Stat
          label="Total lunch"
          value={loading || !data ? "…" : formatDuration(data.summary.total_lunch_ms)}
        />
        <Stat
          label="Total breaks"
          value={loading || !data ? "…" : formatDuration(data.summary.total_break_ms)}
        />
        <Stat
          label="Time off (YTD)"
          value={loading || !data ? "…" : `${fmtDays(data.summary.time_off.total)} d`}
          sub={data ? "approved days across scope" : undefined}
        />
        <Stat
          label="Sick days (YTD)"
          value={loading || !data ? "…" : `${fmtDays(data.summary.time_off.sick)} d`}
          sub={data ? `vs ${fmtDays(data.summary.time_off.vacation)} vac` : undefined}
        />
      </div>

      {data && data.summary.time_off.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Time off used — YTD</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {TIME_OFF_TYPES_ORDERED.map((t) => (
                <Stat
                  key={t}
                  label={TIME_OFF_TYPE_LABEL[t]}
                  value={`${fmtDays(data.summary.time_off[t])} d`}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Approved requests only. Partial-day requests count as hours ÷ 8.
            </p>
          </CardContent>
        </Card>
      )}

      {data && weeks > 1 && data.summary.weekly.some((w) => w.overtime_ms > 0) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Overtime by week</CardTitle>
            <ExportMenu
              filename={`${filenameBase}-overtime-by-week`}
              rows={data.summary.weekly}
              columns={TEAM_WEEK_COLUMNS}
              size="sm"
            />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week of</TableHead>
                  <TableHead>Team hours</TableHead>
                  <TableHead>Overtime</TableHead>
                  <TableHead>Employees over 40h</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.summary.weekly].reverse().map((w) => (
                  <TableRow key={w.week_start}>
                    <TableCell className="text-sm">{fmtWeekLabel(w.week_start)}</TableCell>
                    <TableCell>{formatDuration(w.worked_ms)}</TableCell>
                    <TableCell>
                      {w.overtime_ms > 0 ? (
                        <Badge variant="destructive">+{formatDuration(w.overtime_ms)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {w.in_overtime_count > 0 ? (
                        w.in_overtime_count
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Per-employee hours</CardTitle>
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
                  <SortHeader columnKey="name" label="Employee" sort={rowSort.sort} onToggle={rowSort.toggle} />
                  <SortHeader columnKey="office" label="Office" sort={rowSort.sort} onToggle={rowSort.toggle} />
                  <SortHeader columnKey="department" label="Dept" sort={rowSort.sort} onToggle={rowSort.toggle} />
                  <SortHeader columnKey="total" label="Total" sort={rowSort.sort} onToggle={rowSort.toggle} />
                  <SortHeader columnKey="overtime" label="Overtime" sort={rowSort.sort} onToggle={rowSort.toggle} />
                  <SortHeader columnKey="ytd_overtime" label="OT (YTD)" sort={rowSort.sort} onToggle={rowSort.toggle} />
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
                    onClick={() => setSelected(row)}
                    className={`cursor-pointer hover:bg-muted/40 ${
                      row.profile.is_active === false ? "opacity-60" : ""
                    }`}
                  >
                    <TableCell className="font-medium">
                      <div>{row.profile.name || row.profile.email}</div>
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
                        <div>
                          <Badge variant="destructive">+{formatDuration(row.overtime_ms)}</Badge>
                          {weeks > 1 && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {row.overtime_weeks} of {weeks} wk
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.ytd_overtime_ms > 0 ? (
                        <div>
                          <span className="font-medium text-destructive">
                            +{formatDuration(row.ytd_overtime_ms)}
                          </span>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {row.ytd_overtime_weeks} wk
                          </div>
                        </div>
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
                            {w.overtime_ms > 0 && (
                              <Badge variant="destructive">+{formatDuration(w.overtime_ms)}</Badge>
                            )}
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
        YTD counts every week since the one containing Jan 1, whatever range is selected.
      </p>

      <EmployeeTimeStatsDialog
        row={selected}
        weeks={weeks}
        weekStarts={data?.week_starts ?? []}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function EmployeeTimeStatsDialog({
  row,
  weeks,
  weekStarts,
  onClose,
}: {
  row: Row | null;
  weeks: number;
  weekStarts: string[];
  onClose: () => void;
}) {
  const open = row !== null;

  // Build a single-row summary export for the dialog (same shape a manager
  // would want on-screen). Weekly breakdown gets its own export below.
  const summaryColumns = useMemo<ExportColumn<Row>[]>(
    () => [
      { key: "name", label: "Name", get: (r) => r.profile.name ?? "" },
      { key: "email", label: "Email", get: (r) => r.profile.email },
      { key: "office", label: "Office", get: (r) => r.profile.office ?? "" },
      { key: "department", label: "Department", get: (r) => r.profile.department ?? "" },
      { key: "total_hours", label: "Total hours", get: (r) => msToHours(r.total_ms) },
      { key: "overtime_hours", label: "Overtime hours", get: (r) => msToHours(r.overtime_ms) },
      { key: "overtime_weeks", label: "Weeks over 40h", get: (r) => r.overtime_weeks },
      { key: "lunch_hours", label: "Lunch hours", get: (r) => msToHours(r.lunch_ms) },
      { key: "break_hours", label: "Break hours", get: (r) => msToHours(r.break_ms) },
      ...YTD_OVERTIME_COLUMNS,
      ...TIME_OFF_YTD_COLUMNS,
    ],
    [],
  );

  type WeekExportRow = { week_start: string; worked_ms: number; overtime_ms: number };
  const weekColumns = useMemo<ExportColumn<WeekExportRow>[]>(
    () => [
      { key: "week_start", label: "Week starting", get: (w) => w.week_start },
      { key: "worked_hours", label: "Worked hours", get: (w) => msToHours(w.worked_ms) },
      { key: "overtime_hours", label: "Overtime hours", get: (w) => msToHours(w.overtime_ms) },
    ],
    [],
  );

  const employeeSlug = row
    ? (row.profile.name || row.profile.email).toLowerCase().replace(/[^a-z0-9]+/g, "-")
    : "";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle>
                {row?.profile.name || row?.profile.email || "Employee stats"}
              </DialogTitle>
              {row && (
                <div className="text-sm text-muted-foreground flex flex-wrap gap-2 mt-1">
                  <span>{row.profile.email}</span>
                  {row.profile.office && (
                    <><span>·</span><Badge variant="outline">{row.profile.office}</Badge></>
                  )}
                  {row.profile.department && (
                    <><span>·</span><Badge variant="outline">{row.profile.department}</Badge></>
                  )}
                </div>
              )}
            </div>
            {row && (
              <ExportMenu
                filename={`time-stats-${employeeSlug}-${weeks}w`}
                rows={[row]}
                columns={summaryColumns}
              />
            )}
          </div>
        </DialogHeader>

        {row && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                Time on the clock — last {weeks === 1 ? "week" : `${weeks} weeks`}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Worked" value={formatDuration(row.total_ms)} />
                <Stat
                  label="Overtime"
                  value={formatDuration(row.overtime_ms)}
                  highlight={row.overtime_ms > 0}
                />
                <Stat label="Lunch" value={formatDuration(row.lunch_ms)} />
                <Stat label="Breaks" value={formatDuration(row.break_ms)} />
              </div>
            </div>

            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                Overtime — YTD
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Stat
                  label="Overtime"
                  value={formatDuration(row.ytd_overtime_ms)}
                  highlight={row.ytd_overtime_ms > 0}
                />
                <Stat label="Weeks over 40h" value={String(row.ytd_overtime_weeks)} />
                <Stat label="Worked" value={formatDuration(row.ytd_worked_ms)} />
              </div>
            </div>

            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                Time off — YTD
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {TIME_OFF_TYPES_ORDERED.map((t) => (
                  <Stat
                    key={t}
                    label={TIME_OFF_TYPE_LABEL[t]}
                    value={`${fmtDays(row.time_off[t])} d`}
                  />
                ))}
                <Stat label="Total" value={`${fmtDays(row.time_off.total)} d`} />
              </div>
            </div>

            {weeks > 1 && row.weeks.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Weekly breakdown
                  </div>
                  <ExportMenu
                    filename={`time-stats-${employeeSlug}-weekly`}
                    rows={row.weeks.map((w, i) => ({
                      week_start: weekStarts[i] ?? w.week_start,
                      worked_ms: w.worked_ms,
                      overtime_ms: w.overtime_ms,
                    }))}
                    columns={weekColumns}
                    size="sm"
                  />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Week of</TableHead>
                      <TableHead>Worked</TableHead>
                      <TableHead>Overtime</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {row.weeks.map((w, i) => (
                      <TableRow key={w.week_start}>
                        <TableCell className="text-sm">
                          {fmtWeekLabel(weekStarts[i] ?? w.week_start)}
                        </TableCell>
                        <TableCell>
                          {w.worked_ms > 0 ? formatDuration(w.worked_ms) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {w.overtime_ms > 0 ? (
                            <Badge variant="destructive">+{formatDuration(w.overtime_ms)}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="pt-2 border-t flex justify-end">
              <Link
                href={`/management/timesheets/${row.profile.id}`}
                className="text-sm text-primary hover:underline"
              >
                View full timesheet →
              </Link>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
