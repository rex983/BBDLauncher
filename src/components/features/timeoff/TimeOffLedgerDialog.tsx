"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import {
  requestDays,
  TIME_OFF_TYPE_LABEL,
  type TimeOffStatus,
  type TimeOffType,
} from "@/lib/timeoff/types";

interface LedgerProfile {
  id: string;
  email: string;
  name: string | null;
  office: string | null;
  department: string | null;
}

interface LedgerRequest {
  id: string;
  type: TimeOffType;
  subcategory: string | null;
  start_date: string;
  end_date: string;
  full_day: boolean;
  hours: number | null;
  status: TimeOffStatus;
  reason: string | null;
  decided_note: string | null;
  decided_at: string | null;
  created_at: string;
}

interface Props {
  profile: LedgerProfile | null;
  initialFrom: string;
  initialTo: string;
  onClose: () => void;
}

function fmtRange(start: string, end: string) {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const sameDay = start === end;
  const sameYear = s.getFullYear() === e.getFullYear();
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  if (sameDay) return s.toLocaleDateString([], opts);
  const startFmt = sameYear
    ? s.toLocaleDateString([], { month: "short", day: "numeric" })
    : s.toLocaleDateString([], opts);
  return `${startFmt} – ${e.toLocaleDateString([], opts)}`;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_VARIANT: Record<TimeOffStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  approved: "default",
  denied: "destructive",
  cancelled: "secondary",
};

export function TimeOffLedgerDialog({ profile, initialFrom, initialTo, onClose }: Props) {
  const { viewAsOffice } = useRolePreview();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [requests, setRequests] = useState<LedgerRequest[]>([]);
  const [loading, setLoading] = useState(false);

  // Reset filters whenever a new profile is opened so the dialog picks up
  // the summary's current range instead of stale values from the last view.
  useEffect(() => {
    if (profile) {
      setFrom(initialFrom);
      setTo(initialTo);
    }
  }, [profile?.id, initialFrom, initialTo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const params = new URLSearchParams({
        from,
        to,
        statuses: "approved,pending,denied,cancelled",
        profile_id: profile.id,
      });
      if (viewAsOffice) params.set("office", viewAsOffice);
      const res = await fetch(`/api/management/timeoff/range?${params.toString()}`);
      if (cancelled) return;
      if (res.ok) {
        const body = await res.json();
        setRequests((body.requests || []) as LedgerRequest[]);
      } else {
        setRequests([]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.id, from, to, viewAsOffice]);

  const sorted = useMemo(
    () => [...requests].sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [requests],
  );

  const totals = useMemo(() => {
    let approved = 0;
    let pending = 0;
    let denied = 0;
    for (const r of sorted) {
      const d = requestDays(r);
      if (r.status === "approved") approved += d;
      else if (r.status === "pending") pending += d;
      else if (r.status === "denied") denied += d;
    }
    return { approved, pending, denied };
  }, [sorted]);

  return (
    <Dialog open={!!profile} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{profile?.name || profile?.email || "Ledger"}</DialogTitle>
          <DialogDescription>
            {profile?.email}
            {profile?.office ? ` · ${profile.office}` : ""}
            {profile?.department ? ` · ${profile.department}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="ledger-from" className="text-xs">From</Label>
            <Input
              id="ledger-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ledger-to" className="text-xs">To</Label>
            <Input
              id="ledger-to"
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFrom(initialFrom); setTo(initialTo); }}
          >
            Reset
          </Button>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span><span className="font-medium tabular-nums">{totals.approved.toFixed(1)}</span> approved</span>
            <span className="text-muted-foreground">·</span>
            <span><span className="font-medium tabular-nums">{totals.pending.toFixed(1)}</span> pending</span>
            <span className="text-muted-foreground">·</span>
            <span><span className="font-medium tabular-nums">{totals.denied.toFixed(1)}</span> denied</span>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No time-off records in this range.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dates</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Decided</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">
                    {fmtRange(r.start_date, r.end_date)}
                    {!r.full_day && r.hours && (
                      <div className="text-xs text-muted-foreground">
                        {r.hours} hour{r.hours === 1 ? "" : "s"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div>{TIME_OFF_TYPE_LABEL[r.type]}</div>
                    {r.subcategory && (
                      <div className="text-xs text-muted-foreground">{r.subcategory}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {requestDays(r).toFixed(1)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDateTime(r.decided_at) || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-md">
                    {r.reason || r.decided_note ? (
                      <div className="space-y-1">
                        {r.reason && <div className="whitespace-pre-wrap">{r.reason}</div>}
                        {r.decided_note && (
                          <div className="whitespace-pre-wrap italic">↳ {r.decided_note}</div>
                        )}
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
