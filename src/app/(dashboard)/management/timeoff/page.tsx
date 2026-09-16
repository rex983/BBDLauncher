"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canEditTimeData } from "@/lib/auth/permissions";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import { TimeOffCalendar } from "@/components/features/timeoff/TimeOffCalendar";
import { TimeOffSummary } from "@/components/features/timeoff/TimeOffSummary";
import { TIME_OFF_TYPE_LABEL, type TimeOffType, type TimeOffStatus } from "@/lib/timeoff/types";
import { Check, X } from "lucide-react";

interface Row {
  id: string;
  profile_id: string;
  profile?: { email: string; name: string | null; office: string | null };
  type: TimeOffType;
  subcategory: string | null;
  start_date: string;
  end_date: string;
  full_day: boolean;
  hours: number | null;
  reason: string | null;
  status: TimeOffStatus;
  decided_note: string | null;
  created_at: string;
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export default function TimeOffManagementPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm text-muted-foreground">
          <Link href="/management/timesheets" className="hover:underline">
            ← Timesheets
          </Link>
        </div>
        <h1 className="text-2xl font-bold">Time Off</h1>
        <p className="text-muted-foreground">
          Review requests, see who&rsquo;s off on a shared calendar, and check totals per employee.
        </p>
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Requests</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="mt-4">
          <RequestsQueue />
        </TabsContent>
        <TabsContent value="calendar" className="mt-4">
          <TimeOffCalendar />
        </TabsContent>
        <TabsContent value="summary" className="mt-4">
          <TimeOffSummary />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RequestsQueue() {
  const { data: session } = useSession();
  const canDecide = canEditTimeData(session?.user?.role);
  const { viewAsOffice } = useRolePreview();

  const [status, setStatus] = useState<TimeOffStatus>("pending");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status });
    if (viewAsOffice) params.set("office", viewAsOffice);
    const res = await fetch(`/api/management/timeoff?${params.toString()}`);
    setRows(res.ok ? await res.json() : []);
    setLoading(false);
  }, [status, viewAsOffice]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, next: "approved" | "denied") => {
    const note = next === "denied" ? window.prompt("Reason for denial (optional):") || "" : "";
    const res = await fetch(`/api/management/timeoff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next, decided_note: note || undefined }),
    });
    if (!res.ok) { alert("Failed"); return; }
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <span className="text-sm text-muted-foreground">Status</span>
        <Select value={status} onValueChange={(v) => setStatus(v as TimeOffStatus)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="denied">Denied</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Dates</TableHead>
            <TableHead>Length</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
          )}
          {!loading && rows.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No {status} requests.</TableCell></TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <div className="font-medium">{r.profile?.name || r.profile?.email}</div>
                <div className="text-xs text-muted-foreground">{r.profile?.email}</div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <Badge variant="outline" className="w-fit">{TIME_OFF_TYPE_LABEL[r.type]}</Badge>
                  {r.subcategory && (
                    <span className="text-xs text-muted-foreground">{r.subcategory}</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {fmtDate(r.start_date)}
                {r.start_date !== r.end_date && <> – {fmtDate(r.end_date)}</>}
              </TableCell>
              <TableCell>
                {r.full_day ? "Full day" : `${r.hours}h`}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground max-w-xs">{r.reason || "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(r.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell>
                {status === "pending" && canDecide ? (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => decide(r.id, "approved")}>
                      <Check className="h-4 w-4 mr-1" />Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide(r.id, "denied")}>
                      <X className="h-4 w-4 mr-1" />Deny
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {r.decided_note || (status !== "pending" ? status : "—")}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
