"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
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
import { formatDuration, STATUS_LABEL, type LiveState } from "@/lib/timesheets/state";
import type { Department, Office } from "@/types/auth";

interface Row {
  profile: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    office: Office | null;
    department: Department | null;
  };
  state: LiveState;
}

const ALL = "__all__";
const offices: Office[] = ["Harbor", "Marion", "BST", "RnD"];
const departments: Department[] = ["SALES TEAM", "BST", "RnD"];

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  working: "default",
  on_lunch: "secondary",
  on_break: "outline",
  clocked_out: "outline",
};

export default function TimesheetsTodayPage() {
  const { data: session } = useSession();
  const viewerRole = session?.user?.role;
  const viewerDepartment = session?.user?.department ?? null;
  const viewerOffice = session?.user?.office ?? null;
  // Only admins can pick a department/office here. Manager-tier viewers are
  // locked to their own on both axes server-side; the UI reflects that with
  // read-only badges.
  const isAdmin = viewerRole === "admin";

  const [rows, setRows] = useState<Row[]>([]);
  const [office, setOffice] = useState<string>(ALL);
  const [department, setDepartment] = useState<string>(ALL);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams();
    if (isAdmin && office !== ALL) params.set("office", office);
    if (isAdmin && department !== ALL) params.set("department", department);
    setLoading(true);
    fetch(`/api/management/timesheets/today?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [office, department, isAdmin]);

  // Tick every 30s so open sessions keep counting.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const displayRows = useMemo(() => {
    // Recompute durations locally based on wall clock without another fetch.
    const now = Date.now();
    return rows.map((row) => {
      const openStart = row.state.current_span_started_at
        ? new Date(row.state.current_span_started_at).getTime()
        : null;
      const asOfServer = row.state.last_event_at
        ? new Date(row.state.last_event_at).getTime()
        : now;
      const drift = Math.max(0, now - asOfServer);
      // Only add drift to whatever bucket is currently open.
      let worked = row.state.worked_ms;
      let lunch = row.state.lunch_ms;
      let brk = row.state.break_ms;
      if (openStart) {
        if (row.state.status === "working") worked += drift;
        else if (row.state.status === "on_lunch") lunch += drift;
        else if (row.state.status === "on_break") brk += drift;
      }
      return { row, worked, lunch, brk };
    });
  }, [rows, tick]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Timesheets — Today</h1>
        <p className="text-muted-foreground">
          Live status and today&rsquo;s totals for everyone in your scope.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Office</span>
          {isAdmin ? (
            <Select value={office} onValueChange={setOffice}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {offices.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
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
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline">{viewerDepartment ?? "—"}</Badge>
          )}
        </div>
        <div className="ml-auto flex gap-3 text-sm">
          <Link href="/management/timesheets/schedules" className="text-primary hover:underline">
            Schedules
          </Link>
          <Link href="/management/timeoff" className="text-primary hover:underline">
            Time-off queue
          </Link>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Office</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Worked</TableHead>
            <TableHead>Lunch</TableHead>
            <TableHead>Breaks</TableHead>
            <TableHead>Since</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          )}
          {!loading && displayRows.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                Nobody matches this filter yet.
              </TableCell>
            </TableRow>
          )}
          {!loading && displayRows.map(({ row, worked, lunch, brk }) => (
            <TableRow key={row.profile.id}>
              <TableCell className="font-medium">
                {row.profile.name || row.profile.email}
                <div className="text-xs text-muted-foreground">{row.profile.email}</div>
              </TableCell>
              <TableCell>
                {row.profile.office
                  ? <Badge variant="outline">{row.profile.office}</Badge>
                  : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant[row.state.status] || "outline"}>
                  {STATUS_LABEL[row.state.status]}
                </Badge>
              </TableCell>
              <TableCell>{formatDuration(worked)}</TableCell>
              <TableCell>{formatDuration(lunch)}</TableCell>
              <TableCell>{formatDuration(brk)}</TableCell>
              <TableCell className="text-muted-foreground">
                {row.state.current_span_started_at
                  ? new Date(row.state.current_span_started_at).toLocaleTimeString([], {
                      hour: "numeric", minute: "2-digit",
                    })
                  : "—"}
              </TableCell>
              <TableCell>
                <Link
                  href={`/management/timesheets/${row.profile.id}`}
                  className="text-sm text-primary hover:underline"
                >
                  Details
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
