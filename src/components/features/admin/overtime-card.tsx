"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration } from "@/lib/timesheets/state";

interface Row {
  profile: {
    id: string;
    email: string;
    name: string | null;
    office: string | null;
    department: string | null;
  };
  weekly: {
    worked_ms: number;
    overtime_ms: number;
    is_overtime: boolean;
  };
}

// Admin/manager widget listing everyone in scope who has crossed 40h this
// week. Server-side scope keeps a manager's view to their (office ∩ dept).
export function OvertimeCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/management/hours/weekly?onlyOvertime=1")
      .then((r) => (r.ok ? r.json() : { rows: [], week_start: null }))
      .then((data) => {
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setWeekStart(data.week_start ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  const weekLabel = weekStart
    ? `week of ${new Date(weekStart).toLocaleDateString([], {
        month: "short",
        day: "numeric",
      })}`
    : "this week";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Overtime this week</CardTitle>
        <span className="text-xs text-muted-foreground">{weekLabel} · &gt;40h</span>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No employees in overtime this week.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Office</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Worked</TableHead>
                <TableHead>Overtime</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ profile, weekly }) => (
                <TableRow key={profile.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/management/timesheets/${profile.id}`}
                      className="hover:underline"
                    >
                      {profile.name || profile.email}
                    </Link>
                    <div className="text-xs text-muted-foreground">{profile.email}</div>
                  </TableCell>
                  <TableCell>
                    {profile.office ? (
                      <Badge variant="outline">{profile.office}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {profile.department ? (
                      <Badge variant="outline">{profile.department}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{formatDuration(weekly.worked_ms)}</TableCell>
                  <TableCell>
                    <Badge variant="destructive">
                      +{formatDuration(weekly.overtime_ms)}
                    </Badge>
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
