"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import {
  requestDays,
  TIME_OFF_TYPE_LABEL,
  type TimeOffStatus,
  type TimeOffType,
} from "@/lib/timeoff/types";

interface Profile {
  id: string;
  email: string;
  name: string | null;
  office: string | null;
  department: string | null;
}

interface Request {
  id: string;
  profile_id: string;
  type: TimeOffType;
  subcategory: string | null;
  start_date: string;
  end_date: string;
  full_day: boolean;
  hours: number | null;
  status: TimeOffStatus;
  reason: string | null;
}

const TYPES: TimeOffType[] = ["vacation", "sick", "personal", "parental", "other"];

interface EmployeeRow {
  profile: Profile;
  approvedByType: Record<TimeOffType, number>;
  pending: number;
  denied: number;
  totalApproved: number;
  latestReasons: string[];
}

export function TimeOffSummary({
  refreshKey = 0,
  active = true,
}: { refreshKey?: number; active?: boolean } = {}) {
  const { viewAsOffice } = useRolePreview();

  const currentYear = new Date().getFullYear();
  const defaultFrom = `${currentYear}-01-01`;
  const defaultTo = `${currentYear}-12-31`;

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Skip fetching when the containing tab isn't active — see TimeOffCalendar
    // for the same guard. Both live inside multi-tab pages that mount all
    // tab contents simultaneously.
    if (!active) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const params = new URLSearchParams({ from, to, statuses: "approved,pending,denied" });
      if (viewAsOffice) params.set("office", viewAsOffice);
      const res = await fetch(`/api/management/timeoff/range?${params.toString()}`);
      if (cancelled) return;
      if (res.ok) {
        const body = await res.json();
        setProfiles(body.profiles || []);
        setRequests(body.requests || []);
      } else {
        setProfiles([]);
        setRequests([]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [active, from, to, viewAsOffice, refreshKey]);

  const rows: EmployeeRow[] = useMemo(() => {
    const byId = new Map<string, EmployeeRow>();
    for (const p of profiles) {
      byId.set(p.id, {
        profile: p,
        approvedByType: { vacation: 0, sick: 0, personal: 0, parental: 0, other: 0 },
        pending: 0,
        denied: 0,
        totalApproved: 0,
        latestReasons: [],
      });
    }
    // Sort by created_at desc for "latest reasons"; the range API already
    // returns start_date asc, so we walk the array and lift the last few
    // notes per person.
    const sortedByDate = [...requests].sort((a, b) =>
      b.start_date.localeCompare(a.start_date),
    );
    for (const r of sortedByDate) {
      const row = byId.get(r.profile_id);
      if (!row) continue;
      const days = requestDays(r);
      if (r.status === "approved") {
        row.approvedByType[r.type] += days;
        row.totalApproved += days;
      } else if (r.status === "pending") {
        row.pending += days;
      } else if (r.status === "denied") {
        row.denied += days;
      }
      const note = r.reason?.trim();
      if (note && row.latestReasons.length < 3 && !row.latestReasons.includes(note)) {
        row.latestReasons.push(note);
      }
    }
    return [...byId.values()]
      .filter((r) => r.totalApproved > 0 || r.pending > 0 || r.denied > 0)
      .sort((a, b) => b.totalApproved - a.totalApproved);
  }, [profiles, requests]);

  const totals = useMemo(() => {
    let approved = 0, pending = 0, denied = 0;
    const byType: Record<TimeOffType, number> = {
      vacation: 0, sick: 0, personal: 0, parental: 0, other: 0,
    };
    for (const r of rows) {
      approved += r.totalApproved;
      pending += r.pending;
      denied += r.denied;
      for (const t of TYPES) byType[t] += r.approvedByType[t];
    }
    return { approved, pending, denied, byType };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="from" className="text-xs">From</Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to" className="text-xs">To</Label>
          <Input
            id="to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setFrom(defaultFrom); setTo(defaultTo); }}
        >
          Reset ({currentYear})
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <TotalCard label="Approved days" value={totals.approved} />
        <TotalCard label="Pending days" value={totals.pending} />
        <TotalCard label="Denied days" value={totals.denied} />
        <TotalCard
          label="Approved · sick"
          value={totals.byType.sick}
          sub={`Vacation ${totals.byType.vacation.toFixed(1)} · Personal ${totals.byType.personal.toFixed(1)}`}
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No time-off activity in this range.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="text-right">Vacation</TableHead>
              <TableHead className="text-right">Sick</TableHead>
              <TableHead className="text-right">Personal</TableHead>
              <TableHead className="text-right">Parental</TableHead>
              <TableHead className="text-right">Other</TableHead>
              <TableHead className="text-right">Approved</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead>Recent notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.profile.id}>
                <TableCell>
                  <div className="font-medium">{r.profile.name || r.profile.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.profile.office}{r.profile.department ? ` · ${r.profile.department}` : ""}
                  </div>
                </TableCell>
                {TYPES.map((t) => (
                  <TableCell key={t} className="text-right tabular-nums">
                    {r.approvedByType[t] > 0 ? r.approvedByType[t].toFixed(1) : "—"}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium tabular-nums">
                  {r.totalApproved.toFixed(1)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.pending > 0 ? (
                    <Badge variant="outline">{r.pending.toFixed(1)}</Badge>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-md">
                  {r.latestReasons.length === 0
                    ? "—"
                    : r.latestReasons.slice(0, 2).join(" · ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        Days = business days (Mon–Fri) for full-day requests; partial days credit hours ÷ 8.
      </p>
    </div>
  );
}

function TotalCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">
        {typeof value === "number" ? value.toFixed(1) : value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export function abbrevType(t: TimeOffType) {
  return TIME_OFF_TYPE_LABEL[t];
}
